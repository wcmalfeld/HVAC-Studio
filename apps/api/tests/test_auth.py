from http.cookies import SimpleCookie

from sqlalchemy import text

from tests.conftest import CSRF, PASSWORD


def _reg_body(**kw):
    return {"name": "Carol", "email": "carol@example.com", "password": PASSWORD, "organizationName": "Org C", **kw}


def _set_cookie_attrs(resp) -> dict:
    raw = resp.headers.get("set-cookie")
    assert raw, "no Set-Cookie header"
    parts = [p.strip() for p in raw.split(";")]
    attrs = {p.split("=", 1)[0].lower(): (p.split("=", 1)[1] if "=" in p else True) for p in parts[1:]}
    c = SimpleCookie()
    c.load(raw)
    attrs["_name"] = next(iter(c.keys()))
    attrs["_value"] = c[attrs["_name"]].value
    return attrs


def test_health(make_client):
    r = make_client().get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.headers["x-request-id"]


def test_request_id_propagated(make_client):
    r = make_client().get("/api/v1/health", headers={"X-Request-Id": "abc-123"})
    assert r.headers["x-request-id"] == "abc-123"
    r = make_client().get("/api/v1/health", headers={"X-Request-Id": "bad id with spaces"})
    assert r.headers["x-request-id"] != "bad id with spaces"


def test_register_returns_me_and_sets_cookie(make_client):
    c = make_client()
    r = c.post("/api/v1/auth/register", json=_reg_body(email="Carol@Example.com"), headers=CSRF)
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body) == {"user", "organizations"}
    assert set(body["user"]) == {"id", "name", "email", "createdAt"}
    assert body["user"]["email"] == "carol@example.com"
    assert body["user"]["createdAt"].endswith("Z")
    assert len(body["organizations"]) == 1
    org = body["organizations"][0]
    assert set(org) == {"id", "name", "role", "createdAt"}
    assert org["role"] == "owner" and org["name"] == "Org C"

    attrs = _set_cookie_attrs(r)
    assert attrs["_name"] == "hvac_session"
    assert attrs["httponly"] is True
    assert attrs["samesite"].lower() == "lax"
    assert attrs["path"] == "/"
    assert int(attrs["max-age"]) == 7 * 24 * 3600
    assert "secure" not in attrs  # off in dev/test

    me = c.get("/api/v1/users/me")
    assert me.status_code == 200
    assert me.json() == body


def test_register_audit_logged(make_client, _schema):
    make_client().post("/api/v1/auth/register", json=_reg_body(), headers=CSRF)
    with _schema.connect() as conn:
        actions = [r[0] for r in conn.execute(text("SELECT action FROM audit_logs"))]
    assert "auth.register" in actions


def test_secure_cookie_flag_configurable(make_client, settings, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    r = make_client().post("/api/v1/auth/register", json=_reg_body(), headers=CSRF)
    assert r.status_code == 201
    assert _set_cookie_attrs(r).get("secure") is True


def test_duplicate_email_409_case_insensitive(make_client):
    c = make_client()
    assert c.post("/api/v1/auth/register", json=_reg_body(), headers=CSRF).status_code == 201
    r = make_client().post("/api/v1/auth/register", json=_reg_body(email="CAROL@example.com"), headers=CSRF)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


def test_register_validation(make_client):
    c = make_client()
    r = c.post("/api/v1/auth/register", json=_reg_body(password="short"), headers=CSRF)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert any(d["loc"] == ["password"] for d in err["details"])
    r = c.post("/api/v1/auth/register", json=_reg_body(email="not-an-email"), headers=CSRF)
    assert r.status_code == 422
    r = c.post("/api/v1/auth/register", json=_reg_body(organizationName=""), headers=CSRF)
    assert r.status_code == 422
    r = c.post("/api/v1/auth/register", json={**_reg_body(), "isAdmin": True}, headers=CSRF)
    assert r.status_code == 422


def test_login_success_and_failure(make_client, alice):
    c = make_client()
    r = c.post("/api/v1/auth/login", json={"email": "ALICE@example.com", "password": PASSWORD}, headers=CSRF)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "alice@example.com"
    assert _set_cookie_attrs(r)["_name"] == "hvac_session"
    assert c.get("/api/v1/users/me").status_code == 200

    c2 = make_client()
    r = c2.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "wrong-password!"}, headers=CSRF)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"
    assert "set-cookie" not in r.headers
    r = c2.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}, headers=CSRF)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_me_requires_auth(make_client):
    r = make_client().get("/api/v1/users/me")
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "unauthorized", "message": "Authentication required"}}


def test_tampered_or_foreign_token_rejected(make_client, alice):
    import jwt

    c = make_client()
    forged = jwt.encode(
        {"sub": alice.user_id, "exp": 4102444800, "typ": "session"},
        "wrong-key-but-long-enough-0123456789abcdef",
        algorithm="HS256",
    )
    c.cookies.set("hvac_session", forged)
    assert c.get("/api/v1/users/me").status_code == 401
    c.cookies.set("hvac_session", "garbage")
    assert c.get("/api/v1/users/me").status_code == 401


def test_expired_token_rejected(make_client, alice, settings):
    import jwt

    c = make_client()
    expired = jwt.encode(
        {"sub": alice.user_id, "exp": 1000, "iat": 0, "typ": "session"}, settings.secret_key, algorithm="HS256"
    )
    c.cookies.set("hvac_session", expired)
    assert c.get("/api/v1/users/me").status_code == 401


def test_logout_clears_cookie(alice):
    r = alice.post("/api/v1/auth/logout")
    assert r.status_code == 204
    raw = r.headers["set-cookie"]
    assert raw.startswith("hvac_session=")
    assert "Max-Age=0" in raw or "expires=" in raw.lower()
    assert alice.client.get("/api/v1/users/me").status_code == 401


def test_csrf_header_required_for_mutations(make_client, alice):
    c = make_client()
    r = c.post("/api/v1/auth/register", json=_reg_body())
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "csrf_failed"
    r = c.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": PASSWORD},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert r.status_code == 403

    # Authenticated mutation without header is rejected even with a valid session.
    r = alice.client.post("/api/v1/projects", json={"name": "x"}, headers={"X-Organization-Id": alice.org_id})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "csrf_failed"
    for method in ("PUT", "PATCH", "DELETE"):
        r = alice.client.request(method, "/api/v1/projects/abc", headers={"X-Organization-Id": alice.org_id})
        assert r.status_code == 403, method
    # Safe methods are allowed without it.
    r = alice.client.get("/api/v1/projects", headers={"X-Organization-Id": alice.org_id})
    assert r.status_code == 200


def test_login_rate_limited(make_client, alice):
    c = make_client()
    body = {"email": "alice@example.com", "password": "wrong-password!"}
    codes = [c.post("/api/v1/auth/login", json=body, headers=CSRF).status_code for _ in range(10)]
    assert codes == [401] * 10
    r = c.post("/api/v1/auth/login", json=body, headers=CSRF)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    # Even the right password is blocked while limited.
    r = c.post("/api/v1/auth/login", json={**body, "password": PASSWORD}, headers=CSRF)
    assert r.status_code == 429
    # A different email from the same IP is a different bucket.
    r = c.post("/api/v1/auth/login", json={"email": "other@example.com", "password": "x" * 12}, headers=CSRF)
    assert r.status_code == 401


def test_register_rate_limited(make_client):
    c = make_client()
    for _ in range(10):
        c.post("/api/v1/auth/register", json=_reg_body(), headers=CSRF)
    r = c.post("/api/v1/auth/register", json=_reg_body(), headers=CSRF)
    assert r.status_code == 429


def test_rate_limiter_window_expires():
    from app.core.security import InMemoryRateLimiter

    rl = InMemoryRateLimiter(2, 0.05)
    assert rl.hit("k") and rl.hit("k")
    assert not rl.hit("k")
    import time

    time.sleep(0.06)
    assert rl.hit("k")


def test_organizations_create_and_list(alice):
    r = alice.post("/api/v1/organizations", json={"name": "Second Co"})
    assert r.status_code == 201
    org = r.json()
    assert org["role"] == "owner" and org["name"] == "Second Co"
    r = alice.get("/api/v1/organizations")
    assert [o["name"] for o in r.json()] == ["Org A", "Second Co"]
    me = alice.get("/api/v1/users/me").json()
    assert len(me["organizations"]) == 2


def test_members_invite_and_list(alice, bob):
    r = alice.post(
        f"/api/v1/organizations/{alice.org_id}/members", json={"email": "bob@example.com", "role": "designer"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "designer"
    r = alice.get(f"/api/v1/organizations/{alice.org_id}/members")
    assert r.status_code == 200
    assert {(m["email"], m["role"]) for m in r.json()} == {
        ("alice@example.com", "owner"),
        ("bob@example.com", "designer"),
    }
    # Bob now sees both orgs.
    assert {o["name"] for o in bob.get("/api/v1/organizations").json()} == {"Org A", "Org B"}
    # Duplicate invite → 409; unknown user → 404 user_not_found.
    r = alice.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "bob@example.com", "role": "viewer"})
    assert r.status_code == 409
    r = alice.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "zed@example.com", "role": "viewer"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "user_not_found"


def test_members_requires_manage_role(alice, member_of, register):
    designer = member_of(alice, "designer")
    register("eve@example.com", "Eve Org", "Eve")
    r = designer.post(
        f"/api/v1/organizations/{alice.org_id}/members", json={"email": "eve@example.com", "role": "viewer"}
    )
    assert r.status_code == 403
    # Designers can still list members.
    assert designer.get(f"/api/v1/organizations/{alice.org_id}/members").status_code == 200
    # Admin can invite but not create owners.
    admin = member_of(alice, "admin")
    r = admin.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "eve@example.com", "role": "owner"})
    assert r.status_code == 403
    r = admin.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "eve@example.com", "role": "sales"})
    assert r.status_code == 201

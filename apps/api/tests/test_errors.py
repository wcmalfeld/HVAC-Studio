"""Uniform error envelope and no stack traces leaked."""


def test_unknown_route_404_envelope(make_client):
    r = make_client().get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_method_not_allowed_envelope(make_client):
    r = make_client().get("/api/v1/auth/login")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


def test_validation_envelope_lists_fields(alice):
    r = alice.post("/api/v1/projects", json={"name": 5, "projectType": "x"})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    locs = {tuple(d["loc"]) for d in err["details"]}
    assert ("name",) in locs and ("projectType",) in locs
    assert all({"loc", "msg", "type"} == set(d) for d in err["details"])


def test_unhandled_exception_500_no_leak(app, make_client):
    from fastapi import APIRouter

    router = APIRouter()

    @router.get("/api/v1/__boom")
    def boom():
        raise RuntimeError("secret internal detail /etc/passwd")

    app.include_router(router)
    try:
        r = make_client().get("/api/v1/__boom")
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/api/v1/__boom"]
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "An unexpected error occurred"}}
    assert "secret" not in r.text and "Traceback" not in r.text


def test_out_of_range_integers_are_422_not_500(alice):
    """Integers beyond Postgres INTEGER must be rejected at the edge, never reach the DB (500)."""
    pid = alice.create_project()["id"]
    huge = 2**40
    cases = [
        ("GET", f"/api/v1/projects/{pid}/building/revisions/{huge}", None),
        ("POST", f"/api/v1/projects/{pid}/building/revisions/{huge}/restore", None),
        ("GET", f"/api/v1/projects/{pid}/building/revisions?offset={2**63}", None),
        ("GET", f"/api/v1/projects?offset={2**63}", None),
        ("POST", f"/api/v1/projects/{pid}/floors?revision={huge}", {"name": "x"}),
        ("PUT", f"/api/v1/projects/{pid}/building", {"revision": huge, "model": {}}),
    ]
    for method, url, body in cases:
        r = alice.req(method, url, json=body) if body is not None else alice.req(method, url)
        assert r.status_code == 422, (method, url, r.status_code, r.text)


def test_non_local_environment_requires_secret_and_secure_cookie(monkeypatch):
    import pytest as _pytest

    from app.core import config

    for env in ("production", "prod", "staging"):
        monkeypatch.setenv("ENVIRONMENT", env)
        monkeypatch.delenv("SECRET_KEY", raising=False)
        config.get_settings.cache_clear()
        with _pytest.raises(RuntimeError):
            config.get_settings()
        monkeypatch.setenv("SECRET_KEY", "x" * 40)
        config.get_settings.cache_clear()
        s = config.get_settings()
        assert s.cookie_secure is True and not s.is_local
    config.get_settings.cache_clear()


def test_client_ip_uses_forwarded_for_only_from_trusted_proxy():
    from starlette.requests import Request

    from app.core.deps import client_ip

    def req(peer, xff=None):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "client": (peer, 1), "headers": headers})

    assert client_ip(req("127.0.0.1", "203.0.113.9")) == "203.0.113.9"
    assert client_ip(req("127.0.0.1", "1.1.1.1, 203.0.113.9, 127.0.0.1")) == "203.0.113.9"
    assert client_ip(req("198.51.100.4", "203.0.113.9")) == "198.51.100.4"  # untrusted peer: XFF ignored
    assert client_ip(req("127.0.0.1")) == "127.0.0.1"

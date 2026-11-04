"""ADR-004: a user in org B must never read or mutate org A's data, by any route."""

import pytest

from tests.conftest import room, sample_model, wall

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def world(alice, bob):
    """Alice (org A) owns a populated project; Bob (org B) has his own project."""
    p = alice.create_project(name="Secret A", customer={"name": "A Customer"})
    pid = p["id"]
    assert (
        alice.put(f"/api/v1/projects/{pid}/building", json={"revision": 0, "model": sample_model()}).status_code == 200
    )
    d = alice.post(f"/api/v1/projects/{pid}/drawings", files={"file": ("plan.png", PNG, "image/png")})
    assert d.status_code == 201, d.text
    bp = bob.create_project(name="Bob's")
    return {"pid": pid, "drawing": d.json()["id"], "bob_pid": bp["id"]}


def _assert_a_untouched(alice, world):
    pid = world["pid"]
    p = alice.get(f"/api/v1/projects/{pid}").json()
    assert p["name"] == "Secret A" and p["status"] == "draft"
    doc = alice.get(f"/api/v1/projects/{pid}/building").json()
    assert doc["revision"] == 1
    assert doc["model"]["rooms"][0]["name"] == "Living Room"
    assert {w["id"] for w in doc["model"]["walls"]} == {"w1", "w2", "w3", "w4"}
    assert alice.get("/api/v1/projects").json()["total"] == 1


def test_bob_list_excludes_a(bob, world):
    r = bob.get("/api/v1/projects").json()
    assert [p["name"] for p in r["items"]] == ["Bob's"]
    assert bob.get("/api/v1/projects", params={"q": "Secret"}).json()["total"] == 0
    assert bob.get("/api/v1/projects", params={"q": "A Customer"}).json()["total"] == 0


ROUTES = [
    ("GET", "/api/v1/projects/{pid}", None),
    ("PATCH", "/api/v1/projects/{pid}", {"name": "pwned"}),
    ("DELETE", "/api/v1/projects/{pid}", None),
    ("POST", "/api/v1/projects/{pid}/duplicate", None),
    ("POST", "/api/v1/projects/{pid}/archive", None),
    ("POST", "/api/v1/projects/{pid}/unarchive", None),
    ("GET", "/api/v1/projects/{pid}/building", None),
    ("PUT", "/api/v1/projects/{pid}/building", "MODEL"),
    ("GET", "/api/v1/projects/{pid}/building/revisions", None),
    ("GET", "/api/v1/projects/{pid}/building/revisions/1", None),
    ("POST", "/api/v1/projects/{pid}/building/revisions/0/restore", None),
    (
        "POST",
        "/api/v1/projects/{pid}/floors",
        {"name": "F2", "elevation": 120, "floorToFloorHeight": 120, "defaultCeilingHeight": 96},
    ),
    ("POST", "/api/v1/projects/{pid}/rooms", "ROOM"),
    ("POST", "/api/v1/projects/{pid}/components", "WALL"),
    ("PATCH", "/api/v1/rooms/r1", {"name": "pwned"}),
    ("DELETE", "/api/v1/rooms/r1", None),
    ("PATCH", "/api/v1/components/w1", {"thickness": 1}),
    ("PATCH", "/api/v1/components/win1", {"width": 1}),
    ("DELETE", "/api/v1/components/w1", None),
    ("DELETE", "/api/v1/components/door1", None),
    ("GET", "/api/v1/projects/{pid}/drawings", None),
    ("POST", "/api/v1/projects/{pid}/drawings", "UPLOAD"),
    ("GET", "/api/v1/drawings/{did}", None),
    ("GET", "/api/v1/drawings/{did}/file", None),
    ("POST", "/api/v1/drawings/{did}/analyze", None),
]


def _call(api, world, method, url, body, org=None):
    url = url.format(pid=world["pid"], did=world["drawing"])
    kw = {}
    if body == "MODEL":
        kw["json"] = {"revision": 1, "model": {**sample_model(), "rooms": []}}
    elif body == "ROOM":
        kw["json"] = room("r-evil")
    elif body == "WALL":
        kw["json"] = {"kind": "wall", "component": wall("w-evil", 0, 0, 1, 1)}
    elif body == "UPLOAD":
        kw["files"] = {"file": ("x.png", PNG, "image/png")}
    elif body is not None:
        kw["json"] = body
    return api.req(method, url, org=org, **kw)


@pytest.mark.parametrize(("method", "url", "body"), ROUTES, ids=[f"{m} {u}" for m, u, _ in ROUTES])
def test_bob_in_own_org_gets_404(alice, bob, world, method, url, body):
    r = _call(bob, world, method, url, body)
    assert r.status_code == 404, (method, url, r.status_code, r.text)
    assert r.json()["error"]["code"] == "not_found"
    _assert_a_untouched(alice, world)


@pytest.mark.parametrize(("method", "url", "body"), ROUTES, ids=[f"{m} {u}" for m, u, _ in ROUTES])
def test_bob_spoofing_org_a_header_gets_404(alice, bob, world, method, url, body):
    r = _call(bob, world, method, url, body, org=alice.org_id)
    assert r.status_code == 404, (method, url, r.status_code, r.text)
    _assert_a_untouched(alice, world)


def test_bob_cannot_list_or_join_org_a(alice, bob, world):
    assert bob.get(f"/api/v1/organizations/{alice.org_id}/members").status_code == 404
    r = bob.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "bob@example.com", "role": "owner"})
    assert r.status_code == 404
    assert bob.get("/api/v1/projects", org=alice.org_id).status_code == 404
    assert alice.org_id not in {o["id"] for o in bob.get("/api/v1/organizations").json()}


def test_bob_cannot_assign_a_project_to_himself_or_use_a_customer(alice, bob, world):
    r = bob.patch(f"/api/v1/projects/{world['bob_pid']}", json={"assignedToUserId": alice.user_id})
    assert r.status_code == 422


def test_shared_element_ids_resolve_to_own_org(alice, bob, world):
    """Bob creates a room with the same id as Alice's; his PATCH touches only his building."""
    bpid = world["bob_pid"]
    assert bob.post(f"/api/v1/projects/{bpid}/rooms", json=room("r1", name="Bob Room")).status_code == 201
    r = bob.patch("/api/v1/rooms/r1", json={"name": "Bob Renamed"})
    assert r.status_code == 200
    assert r.json()["projectId"] == bpid
    _assert_a_untouched(alice, world)
    # And the reverse: Alice editing r1 hits her own.
    r = alice.patch("/api/v1/rooms/r1", json={"occupants": 3})
    assert r.json()["projectId"] == world["pid"]
    assert bob.get(f"/api/v1/projects/{bpid}/building").json()["model"]["rooms"][0]["name"] == "Bob Renamed"


def test_multi_org_user_scoped_by_header(alice, bob, world):
    """When Bob joins org A as viewer, the header decides the scope and role."""
    alice.post(f"/api/v1/organizations/{alice.org_id}/members", json={"email": "bob@example.com", "role": "viewer"})
    assert bob.get(f"/api/v1/projects/{world['pid']}", org=alice.org_id).status_code == 200
    assert bob.get(f"/api/v1/projects/{world['pid']}").status_code == 404  # with his own org header
    assert bob.patch(f"/api/v1/projects/{world['pid']}", org=alice.org_id, json={"name": "x"}).status_code == 403
    assert bob.get(f"/api/v1/drawings/{world['drawing']}/file", org=alice.org_id).status_code == 200
    # Bob's own project is not visible under org A.
    assert bob.get(f"/api/v1/projects/{world['bob_pid']}", org=alice.org_id).status_code == 404

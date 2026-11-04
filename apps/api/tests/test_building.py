import copy

import pytest
from sqlalchemy import text

from tests.conftest import door, room, sample_model, wall, window


@pytest.fixture
def project(alice):
    return alice.create_project(name="Building Test")


def _put(api, pid, revision, model):
    return api.put(f"/api/v1/projects/{pid}/building", json={"revision": revision, "model": model})


def test_put_increments_revision_and_roundtrips(alice, project):
    pid = project["id"]
    m = sample_model()
    r = _put(alice, pid, 0, m)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["revision"] == 1
    assert doc["projectId"] == pid
    assert doc["updatedAt"].endswith("Z")
    # Defaults are filled in for nullable-default fields; values round-trip.
    assert doc["model"]["rooms"][0]["floorAssembly"] == {
        "constructionType": None,
        "insulation": None,
        "rValue": None,
        "uFactor": None,
        "adjacentSpace": "crawlspace",
    }
    assert doc["model"]["openings"][0]["props"]["shading"] is None
    assert doc["model"]["walls"][0]["provenance"] == {"source": "user"}  # optional keys omitted, not null
    assert doc["model"]["walls"] == m["walls"]
    assert alice.get(f"/api/v1/projects/{pid}/building").json() == doc

    r = _put(alice, pid, 1, doc["model"])
    assert r.json()["revision"] == 2
    # Project updatedAt bumped by building saves.
    assert alice.get(f"/api/v1/projects/{pid}").json()["updatedAt"] >= project["updatedAt"]


def test_put_stale_revision_conflict(alice, project):
    pid = project["id"]
    assert _put(alice, pid, 0, sample_model()).status_code == 200
    r = _put(alice, pid, 0, sample_model())
    assert r.status_code == 409
    assert r.json() == {
        "error": {
            "code": "revision_conflict",
            "message": "The building was modified elsewhere. Reload to get the latest revision.",
            "details": {"currentRevision": 1},
        }
    }
    r = _put(alice, pid, 7, sample_model())
    assert r.status_code == 409 and r.json()["error"]["details"] == {"currentRevision": 1}
    assert alice.get(f"/api/v1/projects/{pid}/building").json()["revision"] == 1


def test_put_audit_logged(alice, project, _schema):
    _put(alice, project["id"], 0, sample_model())
    with _schema.connect() as conn:
        row = conn.execute(text("SELECT metadata FROM audit_logs WHERE action = 'building.save'")).one()
    assert row[0] == {"revision": 1}


def _mut(fn):
    m = sample_model()
    fn(m)
    return m


INVALID_MODELS = {
    "extra top-level field": _mut(lambda m: m.update(area=1234)),
    "extra nested field": _mut(lambda m: m["walls"][0].update(color="red")),
    "derived area on room": _mut(lambda m: m["rooms"][0].update(area=300)),
    "negative thickness": _mut(lambda m: m["walls"][0].update(thickness=-1)),
    "zero height": _mut(lambda m: m["walls"][0].update(height=0)),
    "schema version 2": _mut(lambda m: m.update(schemaVersion=2)),
    "schema version missing": _mut(lambda m: m.pop("schemaVersion")),
    "north angle 360": _mut(lambda m: m.update(northAngleDeg=360)),
    "no floors": _mut(lambda m: m.update(floors=[])),
    "room with 2 points": _mut(lambda m: m["rooms"][0].update(boundary=[{"x": 0, "y": 0}, {"x": 1, "y": 1}])),
    "string number": _mut(lambda m: m["walls"][0].update(thickness="5.5")),
    "bad enum": _mut(lambda m: m["walls"][0].update(adjacentSpace="space")),
    "bad opening type": _mut(lambda m: m["openings"][0].update(type="skylight")),
    "window props on door": _mut(lambda m: m["openings"][1]["props"].update(shgc=0.3)),
    "shgc > 1": _mut(lambda m: m["openings"][0]["props"].update(shgc=1.5)),
    "panes 5": _mut(lambda m: m["openings"][0]["props"].update(panes=5)),
    "confidence > 1": _mut(lambda m: m["walls"][0]["provenance"].update(source="inferred", confidence=1.2)),
    "bad provenance source": _mut(lambda m: m["walls"][0]["provenance"].update(source="ai")),
    "empty id": _mut(lambda m: m["walls"][0].update(id="")),
    "id too long": _mut(lambda m: m["walls"][0].update(id="x" * 65)),
    "negative offset": _mut(lambda m: m["openings"][0].update(offset=-1)),
    "float order": _mut(lambda m: m["floors"][0].update(order=0.5)),
    "bool as number": _mut(lambda m: m["floors"][0].update(elevation=True)),
    "null required": _mut(lambda m: m["walls"][0].update(start=None)),
    "duplicate wall id": _mut(lambda m: m["walls"].append(copy.deepcopy(m["walls"][0]))),
    "wall/opening id collision": _mut(lambda m: m["openings"][0].update(id="w2")),
    "duplicate room id": _mut(lambda m: m["rooms"].append(copy.deepcopy(m["rooms"][0]))),
    "duplicate floor id": _mut(lambda m: m["floors"].append({**m["floors"][0], "order": 1})),
    "dangling wall floorId": _mut(lambda m: m["walls"][0].update(floorId="floor-9")),
    "dangling room floorId": _mut(lambda m: m["rooms"][0].update(floorId="floor-9")),
    "dangling opening wallId": _mut(lambda m: m["openings"][0].update(wallId="w9")),
}


@pytest.mark.parametrize("name", list(INVALID_MODELS))
def test_put_rejects_invalid_models(alice, project, name):
    r = _put(alice, project["id"], 0, INVALID_MODELS[name])
    assert r.status_code == 422, (name, r.text)
    err = r.json()["error"]
    assert err["code"] == "invalid_building_model"
    assert isinstance(err["details"], list) and err["details"]
    assert all(d["loc"][0] == "model" for d in err["details"])
    assert alice.get(f"/api/v1/projects/{project['id']}/building").json()["revision"] == 0


def test_error_details_point_at_field(alice, project):
    r = _put(alice, project["id"], 0, INVALID_MODELS["negative thickness"])
    assert r.json()["error"]["details"][0]["loc"] == ["model", "walls", 0, "thickness"]
    r = _put(alice, project["id"], 0, INVALID_MODELS["dangling opening wallId"])
    assert r.json()["error"]["details"][0]["loc"] == ["model", "openings", 0, "wallId"]


VALID_EDGE_MODELS = {
    "inferred without confidence (left to geometry validation)": _mut(
        lambda m: m["walls"][0]["provenance"].update(source="inferred")
    ),
    "room/wall id reuse across collections": _mut(lambda m: m["rooms"][0].update(id="w1")),
    "nullable fields null": _mut(lambda m: m["rooms"][0].update(ceilingHeight=None, occupants=None, zoneId=None)),
    "nullable-default fields omitted": _mut(
        lambda m: [m["rooms"][0].pop(k) for k in ("ceilingHeight", "conditioned", "occupants", "zoneId")]
    ),
    "empty assembly": _mut(lambda m: m["walls"][0].update(assembly={})),
    "metric display": _mut(lambda m: m.update(displayUnits="metric", northAngleDeg=359.9)),
    "multi-floor": _mut(
        lambda m: m["floors"].append(
            {
                "id": "floor-2",
                "name": "Second Floor",
                "elevation": 120,
                "floorToFloorHeight": 108,
                "defaultCeilingHeight": 96,
                "order": 1,
            }
        )
    ),
    "negative coordinates": _mut(lambda m: m["walls"][0].update(start={"x": -10.0625, "y": -3})),
}


@pytest.mark.parametrize("name", list(VALID_EDGE_MODELS))
def test_put_accepts_valid_edge_models(alice, project, name):
    r = _put(alice, project["id"], 0, VALID_EDGE_MODELS[name])
    assert r.status_code == 200, (name, r.text)


def test_put_body_shape_validation(alice, project):
    pid = project["id"]
    assert alice.put(f"/api/v1/projects/{pid}/building", json={"model": sample_model()}).status_code == 422
    assert (
        alice.put(f"/api/v1/projects/{pid}/building", json={"revision": -1, "model": sample_model()}).status_code == 422
    )
    assert alice.put(f"/api/v1/projects/{pid}/building", json={"revision": 0, "model": [1]}).status_code == 422
    r = alice.put(
        f"/api/v1/projects/{pid}/building", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422


def test_put_body_size_limit(alice, project):
    m = sample_model()
    m["walls"][0]["assembly"]["constructionType"] = "x" * 100
    big = {"revision": 0, "model": {**m, "pad": "x" * (5 * 1024 * 1024 + 10)}}
    r = alice.put(f"/api/v1/projects/{project['id']}/building", json=big)
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_put_body_size_limit_chunked(alice, project):
    def gen():
        yield b'{"revision":0,"model":{"pad":"'
        for _ in range(6):
            yield b"x" * (1024 * 1024)
        yield b'"}}'

    r = alice.put(
        f"/api/v1/projects/{project['id']}/building", content=gen(), headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


# ---------- revisions ----------


def test_revision_history_and_restore(alice, project):
    pid = project["id"]
    m1 = sample_model()
    _put(alice, pid, 0, m1)
    m2 = copy.deepcopy(m1)
    m2["rooms"][0]["name"] = "Great Room"
    _put(alice, pid, 1, m2)

    revs = alice.get(f"/api/v1/projects/{pid}/building/revisions").json()
    assert [r["revision"] for r in revs] == [2, 1, 0]
    assert "model" not in revs[0]
    assert revs[0]["createdBy"] == {"id": alice.user_id, "name": "Alice"}
    assert revs[2]["note"] == "Created"
    assert set(revs[0]) == {"revision", "schemaVersion", "note", "createdAt", "createdBy"}

    r1 = alice.get(f"/api/v1/projects/{pid}/building/revisions/1").json()
    assert r1["model"]["rooms"][0]["name"] == "Living Room"
    assert alice.get(f"/api/v1/projects/{pid}/building/revisions/99").status_code == 404

    r = alice.post(f"/api/v1/projects/{pid}/building/revisions/1/restore")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["revision"] == 3
    assert doc["model"]["rooms"][0]["name"] == "Living Room"
    revs = alice.get(f"/api/v1/projects/{pid}/building/revisions").json()
    assert revs[0]["revision"] == 3 and revs[0]["note"] == "Restored from revision 1"

    # Optional concurrency guard on restore.
    r = alice.post(f"/api/v1/projects/{pid}/building/revisions/0/restore", json={"revision": 1})
    assert r.status_code == 409 and r.json()["error"]["details"] == {"currentRevision": 3}
    r = alice.post(f"/api/v1/projects/{pid}/building/revisions/0/restore", json={"revision": 3})
    assert r.status_code == 200 and r.json()["model"]["walls"] == []


def test_revisions_pagination(alice, project):
    pid = project["id"]
    m = sample_model()
    for i in range(5):
        _put(alice, pid, i, m)
    page = alice.get(f"/api/v1/projects/{pid}/building/revisions", params={"limit": 2, "offset": 1}).json()
    assert [r["revision"] for r in page] == [4, 3]


# ---------- granular endpoints ----------


def test_add_floor(alice, project):
    pid = project["id"]
    r = alice.post(
        f"/api/v1/projects/{pid}/floors",
        json={"name": "Second Floor", "elevation": 120, "floorToFloorHeight": 108, "defaultCeilingHeight": 96},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["revision"] == 1
    assert body["item"]["id"].startswith("floor-") and body["item"]["order"] == 1
    assert len(alice.get(f"/api/v1/projects/{pid}/building").json()["model"]["floors"]) == 2
    bad = alice.post(f"/api/v1/projects/{pid}/floors", json={"name": "x", "elevation": 0})
    assert bad.status_code == 422
    dup = alice.post(
        f"/api/v1/projects/{pid}/floors",
        json={"id": "floor-1", "name": "Dup", "elevation": 0, "floorToFloorHeight": 1, "defaultCeilingHeight": 1},
    )
    assert dup.status_code == 422


def test_room_endpoints(alice, project):
    pid = project["id"]
    rm = room("r-kitchen", name="Kitchen", roomType="kitchen")
    r = alice.post(f"/api/v1/projects/{pid}/rooms", json=rm)
    assert r.status_code == 201, r.text
    assert r.json()["revision"] == 1
    assert r.json()["item"]["name"] == "Kitchen"
    # Server-generated id when omitted.
    rm2 = room("x")
    del rm2["id"]
    r = alice.post(f"/api/v1/projects/{pid}/rooms", json=rm2)
    assert r.status_code == 201 and r.json()["item"]["id"].startswith("room-")
    # Bad floor ref / duplicate id → 422.
    assert alice.post(f"/api/v1/projects/{pid}/rooms", json=room("r-x", floor="nope")).status_code == 422
    assert alice.post(f"/api/v1/projects/{pid}/rooms", json=rm).status_code == 422
    assert alice.post(f"/api/v1/projects/{pid}/rooms", json=[rm]).status_code == 422

    # PATCH: deep merge, nulls clear, re-validated.
    r = alice.patch(
        "/api/v1/rooms/r-kitchen", json={"name": "Big Kitchen", "ceilingHeight": 108, "ceilingAssembly": {"rValue": 49}}
    )
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert r.json()["revision"] == 3
    assert item["name"] == "Big Kitchen" and item["ceilingHeight"] == 108
    assert item["ceilingAssembly"]["rValue"] == 49 and item["ceilingAssembly"]["adjacentSpace"] == "attic"
    r = alice.patch("/api/v1/rooms/r-kitchen", json={"ceilingHeight": None})
    assert r.json()["item"]["ceilingHeight"] is None
    assert alice.patch("/api/v1/rooms/r-kitchen", json={"ceilingHeight": -5}).status_code == 422
    assert alice.patch("/api/v1/rooms/r-kitchen", json={"bogus": 1}).status_code == 422
    assert alice.patch("/api/v1/rooms/r-kitchen", json={"id": "other"}).status_code == 400
    assert alice.patch("/api/v1/rooms/does-not-exist", json={"name": "x"}).status_code == 404

    # Optional revision guard.
    cur = alice.get(f"/api/v1/projects/{pid}/building").json()["revision"]
    r = alice.patch("/api/v1/rooms/r-kitchen", params={"revision": cur - 1}, json={"name": "Stale"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "revision_conflict"
    assert alice.patch("/api/v1/rooms/r-kitchen", params={"revision": cur}, json={"name": "Fresh"}).status_code == 200

    r = alice.delete("/api/v1/rooms/r-kitchen")
    assert r.status_code == 200 and r.json()["deletedIds"] == ["r-kitchen"]
    assert alice.delete("/api/v1/rooms/r-kitchen").status_code == 404
    revs = alice.get(f"/api/v1/projects/{pid}/building/revisions").json()
    assert revs[0]["note"] == "Room deleted"


def test_component_endpoints(alice, project):
    pid = project["id"]
    r = alice.post(f"/api/v1/projects/{pid}/components", json={"kind": "wall", "component": wall("w-a", 0, 0, 240, 0)})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "wall" and r.json()["item"]["id"] == "w-a"
    r = alice.post(f"/api/v1/projects/{pid}/components", json={"kind": "opening", "component": window("win-a", "w-a")})
    assert r.status_code == 201
    r = alice.post(f"/api/v1/projects/{pid}/components", json={"kind": "opening", "component": door("door-a", "w-a")})
    assert r.status_code == 201 and r.json()["item"]["type"] == "door"
    # Dangling and invalid.
    assert (
        alice.post(
            f"/api/v1/projects/{pid}/components", json={"kind": "opening", "component": window("win-b", "w-nope")}
        ).status_code
        == 422
    )
    assert alice.post(f"/api/v1/projects/{pid}/components", json={"kind": "duct", "component": {}}).status_code == 422
    assert (
        alice.post(
            f"/api/v1/projects/{pid}/components",
            json={"kind": "wall", "component": wall("w-b", 0, 0, 1, 1, thickness=0)},
        ).status_code
        == 422
    )

    r = alice.patch("/api/v1/components/w-a", json={"thickness": 3.5, "assembly": {"rValue": 13}})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "wall"
    assert r.json()["item"]["thickness"] == 3.5 and r.json()["item"]["assembly"]["rValue"] == 13
    assert r.json()["item"]["assembly"]["constructionType"] == "2x6 wood frame"
    r = alice.patch("/api/v1/components/win-a", json={"props": {"shgc": 0.4}, "width": 48})
    assert r.status_code == 200 and r.json()["kind"] == "opening"
    assert r.json()["item"]["props"]["shgc"] == 0.4 and r.json()["item"]["props"]["uFactor"] == 0.3
    assert alice.patch("/api/v1/components/win-a", json={"wallId": "w-nope"}).status_code == 422
    assert alice.patch("/api/v1/components/nope", json={"width": 1}).status_code == 404

    # Deleting a wall cascades to its hosted openings.
    r = alice.delete("/api/v1/components/w-a")
    assert r.status_code == 200, r.text
    assert set(r.json()["deletedIds"]) == {"w-a", "win-a", "door-a"}
    model = alice.get(f"/api/v1/projects/{pid}/building").json()["model"]
    assert model["walls"] == [] and model["openings"] == []
    assert alice.delete("/api/v1/components/w-a").status_code == 404


def test_delete_opening_only(alice, project):
    pid = project["id"]
    _put(alice, pid, 0, sample_model())
    r = alice.delete("/api/v1/components/win1")
    assert r.status_code == 200 and r.json()["deletedIds"] == ["win1"]
    model = alice.get(f"/api/v1/projects/{pid}/building").json()["model"]
    assert len(model["walls"]) == 4 and [o["id"] for o in model["openings"]] == ["door1"]


def test_granular_endpoints_conflict_with_stale_put(alice, project):
    """A granular edit bumps the revision, so a client holding the old revision gets 409 on PUT."""
    pid = project["id"]
    alice.post(f"/api/v1/projects/{pid}/rooms", json=room("r1"))
    assert _put(alice, pid, 0, sample_model()).status_code == 409


def test_same_element_id_in_two_projects_requires_project_id(alice):
    """Element ids are only unique per building; ambiguous lookups are refused, projectId disambiguates."""
    p1 = alice.create_project(name="One")
    p2 = alice.create_project(name="Two")
    alice.post(f"/api/v1/projects/{p1['id']}/rooms", json=room("shared-id", name="In One"))
    alice.post(f"/api/v1/projects/{p2['id']}/rooms", json=room("shared-id", name="In Two"))
    # Ids are only unique per building: an ambiguous id is refused instead of guessing a project.
    r = alice.patch("/api/v1/rooms/shared-id", json={"occupants": 2})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ambiguous_element_id"
    assert alice.delete("/api/v1/rooms/shared-id").status_code == 409
    r = alice.patch("/api/v1/rooms/shared-id", params={"projectId": p1["id"]}, json={"occupants": 2})
    assert r.status_code == 200 and r.json()["projectId"] == p1["id"]
    two = alice.get(f"/api/v1/projects/{p2['id']}/building").json()["model"]["rooms"]
    assert next(x for x in two if x["id"] == "shared-id").get("occupants") is None
    assert alice.patch("/api/v1/rooms/shared-id", params={"projectId": "not-a-uuid"}, json={}).status_code == 422


def test_ambiguous_component_id_requires_project(alice):
    p1 = alice.create_project(name="A")
    p2 = alice.create_project(name="B")
    for p in (p1, p2):
        alice.post(
            f"/api/v1/projects/{p['id']}/components", json={"kind": "wall", "component": wall("w-dup", 0, 0, 120, 0)}
        )
    assert alice.patch("/api/v1/components/w-dup", json={"thickness": 8}).status_code == 409
    r = alice.patch("/api/v1/components/w-dup", params={"projectId": p2["id"]}, json={"thickness": 8})
    assert r.status_code == 200 and r.json()["projectId"] == p2["id"]


def test_building_of_deleted_project_not_patchable(alice, project):
    alice.post(f"/api/v1/projects/{project['id']}/rooms", json=room("r-del"))
    alice.delete(f"/api/v1/projects/{project['id']}")
    assert alice.patch("/api/v1/rooms/r-del", json={"name": "x"}).status_code == 404

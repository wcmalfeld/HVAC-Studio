import json

import pytest
from sqlalchemy import text

PROJECT_KEYS = {
    "id",
    "organizationId",
    "name",
    "address",
    "status",
    "projectType",
    "workflowStage",
    "customer",
    "assignedTo",
    "createdAt",
    "updatedAt",
}


def test_tenant_header_required(alice):
    r = alice.client.get("/api/v1/projects")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "organization_required"
    r = alice.get("/api/v1/projects", org="not-a-uuid")
    assert r.status_code == 400


def test_unknown_org_is_404(alice):
    r = alice.get("/api/v1/projects", org="00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_projects_require_auth(make_client, alice):
    c = make_client()
    r = c.get("/api/v1/projects", headers={"X-Organization-Id": alice.org_id})
    assert r.status_code == 401


def test_create_project_contract_shape(alice):
    p = alice.create_project(
        name="Smith Residence",
        address="123 Main St, Denver, CO",
        projectType="new_construction",
        customer={"name": "Jane Smith", "email": "jane@example.com", "phone": "303-555-0100"},
    )
    assert set(p) == PROJECT_KEYS
    assert p["organizationId"] == alice.org_id
    assert p["status"] == "draft"
    assert p["workflowStage"] == "building"
    assert p["projectType"] == "new_construction"
    assert p["customer"]["name"] == "Jane Smith"
    assert p["customer"]["address"] is None
    assert set(p["customer"]) == {"id", "name", "email", "phone", "address"}
    assert p["assignedTo"] is None
    assert p["createdAt"].endswith("Z")

    r = alice.get(f"/api/v1/projects/{p['id']}")
    assert r.status_code == 200 and r.json() == p


def test_create_project_creates_empty_building(alice):
    p = alice.create_project(name="Empty")
    r = alice.get(f"/api/v1/projects/{p['id']}/building")
    assert r.status_code == 200
    doc = r.json()
    assert set(doc) == {"projectId", "revision", "model", "updatedAt"}
    assert doc["revision"] == 0
    assert doc["projectId"] == p["id"]
    assert doc["model"] == {
        "schemaVersion": 1,
        "northAngleDeg": 0,
        "displayUnits": "imperial",
        "floors": [
            {
                "id": "floor-1",
                "name": "First Floor",
                "elevation": 0,
                "floorToFloorHeight": 120,
                "defaultCeilingHeight": 96,
                "order": 0,
            }
        ],
        "walls": [],
        "openings": [],
        "rooms": [],
    }


def test_create_project_defaults_and_validation(alice):
    p = alice.create_project(name="  Trimmed  ")
    assert p["name"] == "Trimmed"
    assert p["projectType"] == "replacement"
    assert p["customer"] is None and p["address"] is None
    assert alice.post("/api/v1/projects", json={"name": ""}).status_code == 422
    assert alice.post("/api/v1/projects", json={"name": "x" * 201}).status_code == 422
    assert alice.post("/api/v1/projects", json={"name": "x", "projectType": "bogus"}).status_code == 422
    assert (
        alice.post("/api/v1/projects", json={"name": "x", "customer": {"name": "", "email": None}}).status_code == 422
    )
    assert (
        alice.post("/api/v1/projects", json={"name": "x", "customer": {"name": "a", "email": "nope"}}).status_code
        == 422
    )
    r = alice.post("/api/v1/projects", json={"name": "x", "organizationId": "hack"})
    assert r.status_code == 422


def test_create_sample_project_with_fixture(alice, settings, monkeypatch, tmp_path):
    from tests.conftest import sample_model

    f = tmp_path / "sample-house.json"
    f.write_text(json.dumps(sample_model()))
    monkeypatch.setattr(settings, "sample_house_path", f)
    p = alice.create_project(name="Sample", sample=True)
    doc = alice.get(f"/api/v1/projects/{p['id']}/building").json()
    assert doc["revision"] == 0
    assert len(doc["model"]["walls"]) == 4 and len(doc["model"]["rooms"]) == 1


def test_create_sample_project_falls_back_when_missing_or_invalid(alice, settings, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "sample_house_path", tmp_path / "missing.json")
    p = alice.create_project(name="Sample", sample=True)
    assert alice.get(f"/api/v1/projects/{p['id']}/building").json()["model"]["walls"] == []
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schemaVersion": 1, "floors": "nope"}))
    monkeypatch.setattr(settings, "sample_house_path", bad)
    p = alice.create_project(name="Sample2", sample=True)
    assert alice.get(f"/api/v1/projects/{p['id']}/building").json()["model"]["walls"] == []


def test_list_search_filter_sort_paginate(alice):
    a = alice.create_project(name="Alpha Furnace Swap", address="1 Pine St, Boulder", customer={"name": "Ann Lee"})
    b = alice.create_project(name="Bravo Addition", address="22 Elm Ave, Golden", customer={"name": "Bob Ruiz"})
    c = alice.create_project(name="Charlie Remodel", address="9 Oak Ct, Denver")
    alice.patch(f"/api/v1/projects/{b['id']}", json={"status": "in_progress", "workflowStage": "loads"})

    r = alice.get("/api/v1/projects").json()
    assert r["total"] == 3
    assert [p["name"] for p in r["items"]] == ["Bravo Addition", "Charlie Remodel", "Alpha Furnace Swap"]

    assert [p["id"] for p in alice.get("/api/v1/projects", params={"q": "furnace"}).json()["items"]] == [a["id"]]
    assert [p["id"] for p in alice.get("/api/v1/projects", params={"q": "golden"}).json()["items"]] == [b["id"]]
    assert [p["id"] for p in alice.get("/api/v1/projects", params={"q": "ann lee"}).json()["items"]] == [a["id"]]
    assert alice.get("/api/v1/projects", params={"q": "%"}).json()["total"] == 0  # LIKE wildcards escaped
    assert alice.get("/api/v1/projects", params={"q": "zzz"}).json() == {"items": [], "total": 0}

    r = alice.get("/api/v1/projects", params={"status": "in_progress"}).json()
    assert [p["id"] for p in r["items"]] == [b["id"]]
    r = alice.get("/api/v1/projects", params={"stage": "building"}).json()
    assert {p["id"] for p in r["items"]} == {a["id"], c["id"]}
    assert alice.get("/api/v1/projects", params={"status": "bogus"}).status_code == 422

    r = alice.get("/api/v1/projects", params={"limit": 2, "offset": 0}).json()
    assert r["total"] == 3 and len(r["items"]) == 2
    r2 = alice.get("/api/v1/projects", params={"limit": 2, "offset": 2}).json()
    assert r2["total"] == 3 and len(r2["items"]) == 1
    assert alice.get("/api/v1/projects", params={"limit": 0}).status_code == 422
    assert alice.get("/api/v1/projects", params={"limit": 1000}).status_code == 422


def test_patch_project(alice, member_of):
    p = alice.create_project(name="Orig")
    designer = member_of(alice, "designer")
    r = alice.patch(
        f"/api/v1/projects/{p['id']}",
        json={
            "name": "Renamed",
            "address": "5 New Rd",
            "status": "awaiting_information",
            "projectType": "addition",
            "workflowStage": "equipment",
            "assignedToUserId": designer.user_id,
        },
    )
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["name"] == "Renamed" and u["address"] == "5 New Rd"
    assert u["status"] == "awaiting_information" and u["projectType"] == "addition"
    assert u["workflowStage"] == "equipment"
    assert u["assignedTo"] == {"id": designer.user_id, "name": "Designer"}
    assert u["updatedAt"] >= p["updatedAt"]
    # Clearing nullable fields.
    u = alice.patch(f"/api/v1/projects/{p['id']}", json={"address": None, "assignedToUserId": None}).json()
    assert u["address"] is None and u["assignedTo"] is None
    # Invalid values.
    assert alice.patch(f"/api/v1/projects/{p['id']}", json={"name": ""}).status_code == 422
    assert alice.patch(f"/api/v1/projects/{p['id']}", json={"status": "nope"}).status_code == 422
    assert alice.patch(f"/api/v1/projects/{p['id']}", json={"customerId": "x"}).status_code == 422


def test_assign_to_non_member_rejected(alice, bob):
    p = alice.create_project()
    r = alice.patch(f"/api/v1/projects/{p['id']}", json={"assignedToUserId": bob.user_id})
    assert r.status_code == 422
    r = alice.patch(f"/api/v1/projects/{p['id']}", json={"assignedToUserId": "garbage"})
    assert r.status_code == 422


def test_delete_project_soft(alice, _schema):
    p = alice.create_project()
    assert alice.delete(f"/api/v1/projects/{p['id']}").status_code == 204
    assert alice.get(f"/api/v1/projects/{p['id']}").status_code == 404
    assert alice.get(f"/api/v1/projects/{p['id']}/building").status_code == 404
    assert alice.get("/api/v1/projects").json()["total"] == 0
    assert alice.delete(f"/api/v1/projects/{p['id']}").status_code == 404
    with _schema.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM projects WHERE deleted_at IS NOT NULL")).scalar() == 1


def test_get_unknown_and_malformed_ids(alice):
    assert alice.get("/api/v1/projects/00000000-0000-0000-0000-000000000000").status_code == 404
    r = alice.get("/api/v1/projects/not-a-uuid")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_duplicate_project(alice):
    from tests.conftest import sample_model

    p = alice.create_project(name="Original", address="1 A St", customer={"name": "Cust"}, projectType="remodel")
    alice.patch(f"/api/v1/projects/{p['id']}", json={"status": "completed", "workflowStage": "proposal"})
    r = alice.put(f"/api/v1/projects/{p['id']}/building", json={"revision": 0, "model": sample_model()})
    assert r.status_code == 200
    r = alice.post(f"/api/v1/projects/{p['id']}/duplicate")
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["id"] != p["id"]
    assert d["name"] == "Copy of Original"
    assert d["customer"]["id"] == p["customer"]["id"]
    assert d["address"] == "1 A St" and d["projectType"] == "remodel"
    assert d["status"] == "draft" and d["workflowStage"] == "proposal"
    bd = alice.get(f"/api/v1/projects/{d['id']}/building").json()
    assert bd["revision"] == 0
    assert bd["model"] == alice.get(f"/api/v1/projects/{p['id']}/building").json()["model"]
    # Editing the copy does not affect the original.
    alice.put(f"/api/v1/projects/{d['id']}/building", json={"revision": 0, "model": {**bd["model"], "rooms": []}})
    assert len(alice.get(f"/api/v1/projects/{p['id']}/building").json()["model"]["rooms"]) == 1


def test_archive_unarchive(alice):
    p = alice.create_project()
    alice.patch(f"/api/v1/projects/{p['id']}", json={"status": "in_progress"})
    r = alice.post(f"/api/v1/projects/{p['id']}/archive")
    assert r.status_code == 200 and r.json()["status"] == "archived"
    assert alice.get("/api/v1/projects").json()["total"] == 0
    assert alice.get("/api/v1/projects", params={"includeArchived": "true"}).json()["total"] == 1
    assert alice.get("/api/v1/projects", params={"status": "archived"}).json()["total"] == 1
    assert alice.get(f"/api/v1/projects/{p['id']}").status_code == 200  # still readable directly
    r = alice.post(f"/api/v1/projects/{p['id']}/archive")  # idempotent
    assert r.status_code == 200
    r = alice.post(f"/api/v1/projects/{p['id']}/unarchive")
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert alice.get("/api/v1/projects").json()["total"] == 1


def test_archive_via_patch_status(alice):
    p = alice.create_project()
    assert alice.patch(f"/api/v1/projects/{p['id']}", json={"status": "archived"}).json()["status"] == "archived"
    assert alice.get("/api/v1/projects").json()["total"] == 0
    assert alice.patch(f"/api/v1/projects/{p['id']}", json={"status": "completed"}).json()["status"] == "completed"
    assert alice.get("/api/v1/projects").json()["total"] == 1


def test_project_audit_log(alice, _schema):
    p = alice.create_project()
    alice.patch(f"/api/v1/projects/{p['id']}", json={"name": "x"})
    alice.post(f"/api/v1/projects/{p['id']}/duplicate")
    alice.post(f"/api/v1/projects/{p['id']}/archive")
    alice.delete(f"/api/v1/projects/{p['id']}")
    with _schema.connect() as conn:
        rows = conn.execute(
            text("SELECT action, organization_id::text, user_id::text FROM audit_logs WHERE action LIKE 'project.%'")
        ).all()
    actions = [r[0] for r in rows]
    for a in ("project.create", "project.update", "project.duplicate", "project.archive", "project.delete"):
        assert a in actions
    assert all(r[1] == alice.org_id and r[2] == alice.user_id for r in rows)


# ---------- roles ----------


@pytest.mark.parametrize("role", ["sales", "designer", "admin"])
def test_writer_roles_can_write(alice, member_of, role):
    u = member_of(alice, role)
    p = u.create_project(name=f"{role} project")
    assert u.patch(f"/api/v1/projects/{p['id']}", json={"name": "y"}).status_code == 200
    assert u.post(f"/api/v1/projects/{p['id']}/duplicate").status_code == 201
    assert u.post(f"/api/v1/projects/{p['id']}/archive").status_code == 200


def test_viewer_is_read_only(alice, member_of):
    from tests.conftest import sample_model

    p = alice.create_project(name="Visible")
    v = member_of(alice, "viewer")
    assert v.get("/api/v1/projects").json()["total"] == 1
    assert v.get(f"/api/v1/projects/{p['id']}").status_code == 200
    assert v.get(f"/api/v1/projects/{p['id']}/building").status_code == 200
    for method, url, body in [
        ("POST", "/api/v1/projects", {"name": "nope"}),
        ("PATCH", f"/api/v1/projects/{p['id']}", {"name": "nope"}),
        ("DELETE", f"/api/v1/projects/{p['id']}", None),
        ("POST", f"/api/v1/projects/{p['id']}/duplicate", None),
        ("POST", f"/api/v1/projects/{p['id']}/archive", None),
        ("PUT", f"/api/v1/projects/{p['id']}/building", {"revision": 0, "model": sample_model()}),
        ("POST", f"/api/v1/projects/{p['id']}/rooms", sample_model()["rooms"][0]),
    ]:
        r = v.req(method, url, json=body)
        assert r.status_code == 403, (method, url, r.text)
        assert r.json()["error"]["code"] == "forbidden"
    assert alice.get(f"/api/v1/projects/{p['id']}").json()["name"] == "Visible"


@pytest.mark.parametrize("role", ["designer", "sales"])
def test_non_managers_cannot_delete(alice, member_of, role):
    p = alice.create_project()
    u = member_of(alice, role)
    assert u.delete(f"/api/v1/projects/{p['id']}").status_code == 403
    assert alice.get(f"/api/v1/projects/{p['id']}").status_code == 200


def test_admin_can_delete(alice, member_of):
    p = alice.create_project()
    assert member_of(alice, "admin").delete(f"/api/v1/projects/{p['id']}").status_code == 204

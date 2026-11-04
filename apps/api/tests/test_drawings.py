import hashlib

import pytest
from sqlalchemy import text

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 50
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 50


@pytest.fixture
def project(alice):
    return alice.create_project(name="Drawings")


def _upload(api, pid, name, data, ctype):
    return api.post(f"/api/v1/projects/{pid}/drawings", files={"file": (name, data, ctype)})


@pytest.mark.parametrize(
    ("name", "data", "ctype"),
    [
        ("plan.pdf", PDF, "application/pdf"),
        ("plan.png", PNG, "image/png"),
        ("plan.jpg", JPEG, "image/jpeg"),
        ("scan.jpeg", JPEG, "application/octet-stream"),  # generic type → sniffed
    ],
)
def test_upload_and_fetch(alice, project, name, data, ctype):
    r = _upload(alice, project["id"], name, data, ctype)
    assert r.status_code == 201, r.text
    d = r.json()
    assert set(d) == {
        "id",
        "projectId",
        "documentType",
        "filename",
        "contentType",
        "size",
        "sha256",
        "revision",
        "createdAt",
        "fileUrl",
    }
    assert d["projectId"] == project["id"] and d["documentType"] == "drawing"
    assert d["size"] == len(data)
    assert d["sha256"] == hashlib.sha256(data).hexdigest()
    assert d["filename"] == name and d["revision"] == 1
    assert d["fileUrl"] == f"/api/v1/drawings/{d['id']}/file"

    assert alice.get(f"/api/v1/drawings/{d['id']}").json() == d
    f = alice.get(d["fileUrl"])
    assert f.status_code == 200
    assert f.content == data
    assert f.headers["content-type"].startswith(d["contentType"])
    assert f.headers["x-content-type-options"] == "nosniff"
    assert f.headers["etag"] == f'"{d["sha256"]}"'


def test_list_and_revisioning(alice, project):
    pid = project["id"]
    a = _upload(alice, pid, "plan.pdf", PDF, "application/pdf").json()
    b = _upload(alice, pid, "plan.pdf", PDF + b"v2", "application/pdf").json()
    c = _upload(alice, pid, "other.png", PNG, "image/png").json()
    assert (a["revision"], b["revision"], c["revision"]) == (1, 2, 1)
    lst = alice.get(f"/api/v1/projects/{pid}/drawings").json()
    assert [d["id"] for d in lst] == [c["id"], b["id"], a["id"]]


def test_magic_bytes_enforced(alice, project):
    pid = project["id"]
    r = _upload(alice, pid, "evil.pdf", b"<html><script>alert(1)</script>", "application/pdf")
    assert r.status_code == 415
    r = _upload(alice, pid, "fake.png", PDF, "image/png")
    assert r.status_code == 415 and r.json()["error"]["code"] == "content_type_mismatch"
    r = _upload(alice, pid, "x.gif", b"GIF89a" + b"\x00" * 20, "image/gif")
    assert r.status_code == 415
    r = _upload(alice, pid, "x.svg", b"<svg/>", "image/svg+xml")
    assert r.status_code == 415
    r = _upload(alice, pid, "x.bin", b"\x00\x01\x02\x03" * 10, "application/octet-stream")
    assert r.status_code == 415
    r = _upload(alice, pid, "empty.pdf", b"", "application/pdf")
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_file"
    assert alice.get(f"/api/v1/projects/{pid}/drawings").json() == []


@pytest.mark.parametrize(
    ("name", "data", "ctype"),
    [
        ("plan.dxf", b"  0\nSECTION\n", "application/dxf"),
        ("plan.dwg", b"AC1032" + b"\x00" * 20, "application/octet-stream"),
        ("plan.bin", b"AC1027" + b"\x00" * 20, "application/octet-stream"),
        ("plan.DXF", b"  0\nSECTION\n", "text/plain"),
    ],
)
def test_dxf_dwg_planned_415(alice, project, name, data, ctype):
    r = _upload(alice, project["id"], name, data, ctype)
    assert r.status_code == 415
    err = r.json()["error"]
    assert err["code"] == "unsupported_media_type"
    assert "planned" in err["message"]


def test_size_limit(alice, project, settings, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 1024)
    r = _upload(alice, project["id"], "big.pdf", PDF + b"x" * 2000, "application/pdf")
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"
    assert _upload(alice, project["id"], "ok.pdf", PDF, "application/pdf").status_code == 201


def test_size_limit_real_25mb(alice, project):
    data = PDF + b"x" * (25 * 1024 * 1024)
    r = _upload(alice, project["id"], "huge.pdf", data, "application/pdf")
    assert r.status_code == 413


def test_filename_sanitized(alice, project):
    r = _upload(alice, project["id"], "../../etc/passwd<script>.pdf", PDF, "application/pdf")
    assert r.status_code == 201
    name = r.json()["filename"]
    assert "/" not in name and "<" not in name and ".." not in name.split(".")[0]
    assert name.endswith(".pdf")


def test_missing_file_field(alice, project):
    r = alice.post(f"/api/v1/projects/{project['id']}/drawings", files={"other": ("a.pdf", PDF, "application/pdf")})
    assert r.status_code == 422


def test_viewer_cannot_upload(alice, project, member_of):
    v = member_of(alice, "viewer")
    assert _upload(v, project["id"], "plan.pdf", PDF, "application/pdf").status_code == 403
    d = _upload(alice, project["id"], "plan.pdf", PDF, "application/pdf").json()
    assert v.get(f"/api/v1/drawings/{d['id']}/file").status_code == 200


def test_analysis_not_implemented(alice, project):
    d = _upload(alice, project["id"], "plan.pdf", PDF, "application/pdf").json()
    for method, suffix in [("POST", "analyze"), ("GET", "analysis"), ("POST", "approve")]:
        r = alice.req(method, f"/api/v1/drawings/{d['id']}/{suffix}")
        assert r.status_code == 501
        assert r.json()["error"]["code"] == "not_implemented"
    assert alice.post("/api/v1/drawings/00000000-0000-0000-0000-000000000000/analyze").status_code == 404


def test_upload_audit_and_storage_key(alice, project, _schema, settings):
    d = _upload(alice, project["id"], "plan.pdf", PDF, "application/pdf").json()
    with _schema.connect() as conn:
        key = conn.execute(text("SELECT storage_key FROM documents WHERE id = :id"), {"id": d["id"]}).scalar()
        actions = [r[0] for r in conn.execute(text("SELECT action FROM audit_logs"))]
    assert key.startswith(f"orgs/{alice.org_id}/projects/{project['id']}/drawings/")
    assert (settings.storage_dir / key).read_bytes() == PDF
    assert "drawing.upload" in actions


def test_deleted_project_drawings_hidden(alice, project):
    d = _upload(alice, project["id"], "plan.pdf", PDF, "application/pdf").json()
    alice.delete(f"/api/v1/projects/{project['id']}")
    assert alice.get(f"/api/v1/drawings/{d['id']}").status_code == 404
    assert alice.get(f"/api/v1/drawings/{d['id']}/file").status_code == 404


def test_local_storage_rejects_traversal(tmp_path):
    from app.services.storage import LocalDiskStorage

    s = LocalDiskStorage(tmp_path)
    for bad in ("../x", "a/../../x", "/etc/passwd", ""):
        with pytest.raises(ValueError):
            s.put(bad, b"x")
    s.put("a/b/c.pdf", b"ok")
    assert b"".join(s.open_stream("a/b/c.pdf")) == b"ok"

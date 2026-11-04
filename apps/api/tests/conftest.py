"""Test harness: hvac_studio_test DB, schema built via Alembic once per session, truncated per test."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Must be set before app modules read settings.
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/hvac_studio_test")
os.environ["DATABASE_URL"] = TEST_DB
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789abcdef0123456789")
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="hvac-test-storage-")

import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from alembic import command  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.security import get_auth_rate_limiter  # noqa: E402
from app.models import Base  # noqa: E402

API_ROOT = Path(__file__).resolve().parents[1]
CSRF = {"X-Requested-With": "hvac-studio"}
PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.attributes["url"] = TEST_DB
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def _clean(_schema):
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with _schema.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    get_auth_rate_limiter().reset()
    yield


@pytest.fixture
def app():
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def make_client(app):
    clients: list[TestClient] = []

    def _make() -> TestClient:
        c = TestClient(app, base_url="http://testserver", raise_server_exceptions=False)
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.close()


class Api:
    """Thin wrapper: a logged-in client bound to one active organization."""

    def __init__(self, client: TestClient, me: dict):
        self.client = client
        self.me = me
        self.org_id = me["organizations"][0]["id"] if me["organizations"] else None
        self.user_id = me["user"]["id"]

    def headers(self, org: str | None = None, csrf: bool = True) -> dict:
        h = dict(CSRF) if csrf else {}
        org = org if org is not None else self.org_id
        if org:
            h["X-Organization-Id"] = org
        return h

    def req(self, method: str, url: str, *, org: str | None = None, **kw):
        headers = {**self.headers(org), **kw.pop("headers", {})}
        return self.client.request(method, url, headers=headers, **kw)

    def get(self, url, **kw):
        return self.req("GET", url, **kw)

    def post(self, url, **kw):
        return self.req("POST", url, **kw)

    def put(self, url, **kw):
        return self.req("PUT", url, **kw)

    def patch(self, url, **kw):
        return self.req("PATCH", url, **kw)

    def delete(self, url, **kw):
        return self.req("DELETE", url, **kw)

    def create_project(self, **body) -> dict:
        body.setdefault("name", "Test Project")
        r = self.post("/api/v1/projects", json=body)
        assert r.status_code == 201, r.text
        return r.json()


@pytest.fixture
def register(make_client):
    def _register(email: str = "alice@example.com", org: str = "Org A", name: str = "Alice") -> Api:
        c = make_client()
        r = c.post(
            "/api/v1/auth/register",
            json={"name": name, "email": email, "password": PASSWORD, "organizationName": org},
            headers=CSRF,
        )
        assert r.status_code == 201, r.text
        return Api(c, r.json())

    return _register


@pytest.fixture
def alice(register) -> Api:
    return register("alice@example.com", "Org A", "Alice")


@pytest.fixture
def bob(register) -> Api:
    return register("bob@example.com", "Org B", "Bob")


@pytest.fixture
def member_of(register):
    """Create a new user and add them to `owner`'s org with the given role."""

    def _member(owner: Api, role: str, email: str | None = None) -> Api:
        email = email or f"{role}@example.com"
        u = register(email, f"{role} personal org", role.capitalize())
        r = owner.post(f"/api/v1/organizations/{owner.org_id}/members", json={"email": email, "role": role})
        assert r.status_code == 201, r.text
        u.org_id = owner.org_id
        return u

    return _member


# ---------- building model fixtures ----------


def wall(id_: str, sx, sy, ex, ey, floor="floor-1", **kw) -> dict:
    return {
        "id": id_,
        "floorId": floor,
        "start": {"x": sx, "y": sy},
        "end": {"x": ex, "y": ey},
        "thickness": 5.5,
        "height": 96,
        "kind": "exterior",
        "adjacentSpace": "outdoors",
        "assembly": {"constructionType": "2x6 wood frame", "insulation": "R-21 batt", "rValue": 21, "uFactor": None},
        "provenance": {"source": "user"},
        **kw,
    }


def room(id_: str, floor="floor-1", **kw) -> dict:
    return {
        "id": id_,
        "floorId": floor,
        "name": "Living Room",
        "roomType": "living",
        "boundary": [{"x": 0, "y": 0}, {"x": 240, "y": 0}, {"x": 240, "y": 180}, {"x": 0, "y": 180}],
        "ceilingHeight": None,
        "conditioned": True,
        "occupants": None,
        "zoneId": None,
        "floorAssembly": {"adjacentSpace": "crawlspace"},
        "ceilingAssembly": {"adjacentSpace": "attic"},
        "provenance": {"source": "user"},
        **kw,
    }


def window(id_: str, wall_id: str, **kw) -> dict:
    return {
        "id": id_,
        "wallId": wall_id,
        "type": "window",
        "offset": 60,
        "width": 36,
        "height": 48,
        "sillHeight": 30,
        "provenance": {"source": "user"},
        "props": {"uFactor": 0.3, "shgc": 0.25, "frameMaterial": "vinyl", "panes": 2},
        **kw,
    }


def door(id_: str, wall_id: str, **kw) -> dict:
    return {
        "id": id_,
        "wallId": wall_id,
        "type": "door",
        "offset": 150,
        "width": 36,
        "height": 80,
        "sillHeight": 0,
        "provenance": {"source": "user"},
        "props": {"construction": "insulated steel", "uFactor": None},
        **kw,
    }


def sample_model() -> dict:
    return {
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
        "walls": [
            wall("w1", 0, 0, 240, 0),
            wall("w2", 240, 0, 240, 180),
            wall("w3", 240, 180, 0, 180),
            wall("w4", 0, 180, 0, 0),
        ],
        "openings": [window("win1", "w1"), door("door1", "w3")],
        "rooms": [room("r1")],
    }


@pytest.fixture
def settings():
    return get_settings()

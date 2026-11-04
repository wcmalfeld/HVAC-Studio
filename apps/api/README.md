# HVAC Studio API

FastAPI + SQLAlchemy 2 (sync, psycopg 3) + Alembic + Postgres 16. Python ≥ 3.12 (developed on 3.13).

## Run locally

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env            # optional; defaults work against local Postgres (user postgres, no password)

.venv/bin/alembic upgrade head  # creates schema in DATABASE_URL (default: hvac_studio)
.venv/bin/python scripts/seed_demo.py   # optional demo data (idempotent)
.venv/bin/uvicorn app.main:app --reload --port 8000
```

- Health: `GET http://localhost:8000/api/v1/health`
- OpenAPI docs: `http://localhost:8000/api/v1/docs`
- Demo login: `demo@hvacstudio.dev` / `demo-password-123` (org "Front Range Heating & Air", 6 projects;
  the Hendricks project is seeded from `packages/shared-types/fixtures/sample-house.json` when present).

Docker: `docker compose up -d db api` from the repo root (`--profile web` adds the Next.js app).

## Tests

```bash
.venv/bin/pytest          # uses TEST_DATABASE_URL, default postgresql+psycopg://postgres@localhost:5432/hvac_studio_test
.venv/bin/ruff check .
```

The test session drops and recreates the `public` schema of the test DB, runs `alembic upgrade head`
(so migrations are exercised every run) and truncates all tables before each test.

## Layout

```
app/
  main.py               create_app(); middleware order: request-id → (CORS) → CSRF → body-size → routes
  core/  config.py      settings (env / .env)
         db.py          engine + get_db
         security.py    argon2, JWT session tokens, InMemoryRateLimiter (swappable RateLimiter protocol)
         deps.py        get_current_user, get_tenant → Tenant(user, org, role) + permission helpers
         errors.py      ApiError + uniform error envelope handlers
         middleware.py  RequestContext (X-Request-Id, access log), CSRF, body size limit
  models/               ORM models (all tenant tables have indexed organization_id)
  schemas/ building.py  Pydantic mirror of packages/shared-types/src/building.ts (strict, extra=forbid)
           api.py       Pydantic mirror of packages/shared-types/src/api.ts + API-only payloads
  services/             projects, buildings (document/revision logic), drawings, storage, audit
  api/v1/               routers: auth (+users, organizations), projects, building, drawings
alembic/versions/       migrations
scripts/seed_demo.py
tests/
```

## Frontend contract notes

**Session.** `POST /auth/register|login` set an httpOnly cookie `hvac_session` (JWT HS256, `SameSite=Lax`,
`Path=/`, `Max-Age=604800`, `Secure` when `COOKIE_SECURE=true`). The browser never reads it; use
`credentials: "include"` / same-origin via the Next `/api/*` rewrite. `POST /auth/logout` → 204, clears it.
Unauthenticated → `401 unauthorized`.

**CSRF.** Every non-GET/HEAD/OPTIONS request must send `X-Requested-With: hvac-studio`, including
login/register/logout, or it gets `403 csrf_failed`.

**Tenant.** Every project/building/drawing request needs `X-Organization-Id: <org uuid>` (from `Me.organizations`).
Missing/malformed → `400 organization_required`; not a member → `404 not_found`. Resources in other orgs are
always `404` (never 403).

**Roles.** viewer = read-only (`403 forbidden` on writes). sales/designer/admin/owner can create/edit/duplicate/
archive projects and edit buildings. Only owner/admin can delete projects or add members.

**Errors.** Always `{"error": {"code", "message", "details?"}}`. Codes:
`validation_error` (422, details = `[{loc, msg, type}]`, `loc` excludes "body"),
`invalid_building_model` (422, `loc` starts with `"model"`), `revision_conflict` (409, details `{currentRevision}`),
`email_taken` (409), `invalid_credentials` (401), `unauthorized` (401), `csrf_failed` (403), `forbidden` (403),
`not_found` (404), `organization_required` (400), `rate_limited` (429), `payload_too_large` (413),
`unsupported_media_type` / `content_type_mismatch` (415), `empty_file` (422), `not_implemented` (501),
`internal_error` (500). Every response carries `X-Request-Id`.

**Timestamps** are ISO-8601 UTC with `Z`. **Ids** are UUID strings (element ids inside the building model
are client-chosen strings, 1–64 chars).

## Endpoints (all under `/api/v1`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | |
| POST | `/auth/register` | `{name,email,password(≥10),organizationName}` → 201 `Me` + cookie; creates org with caller as owner |
| POST | `/auth/login` | `{email,password}` → `Me` + cookie. 10 attempts/min per IP+email → 429 |
| POST | `/auth/logout` | 204 |
| GET | `/users/me` | `Me` |
| GET/POST | `/organizations` | list mine (with role) / create (caller = owner) |
| GET/POST | `/organizations/{id}/members` | list / add existing user `{email, role}` (owner/admin) |
| GET | `/projects` | `q` (name/address/customer), `status`, `stage`, `includeArchived`, `limit` (≤200, default 50), `offset` → `{items,total}`, newest `updatedAt` first. Archived hidden unless `includeArchived=true` or `status=archived` |
| POST | `/projects` | `ProjectCreate` (+ optional `sample: true`) → 201 `Project`; creates building revision 0 |
| GET/PATCH/DELETE | `/projects/{id}` | PATCH = `ProjectUpdate`; DELETE is a soft delete → 204 |
| POST | `/projects/{id}/duplicate` | → 201 "Copy of …", same customer, building copied at current revision (as rev 0), status `draft` |
| POST | `/projects/{id}/archive`, `/unarchive` | idempotent; unarchive restores the previous status |
| GET | `/projects/{id}/building` | `BuildingDocument` |
| PUT | `/projects/{id}/building` | `{revision, model}` → `BuildingDocument` with revision+1; stale → 409 `revision_conflict`. Body ≤ 5 MB |
| GET | `/projects/{id}/building/revisions` | newest first, no model: `[{revision, schemaVersion, note, createdAt, createdBy}]` (`limit`, `offset`) |
| GET | `/projects/{id}/building/revisions/{rev}` | same + `model` |
| POST | `/projects/{id}/building/revisions/{rev}/restore` | optional body `{revision}` guard → `BuildingDocument` (new revision) |
| POST | `/projects/{id}/floors` | body = `Floor` (`id`, `order` optional) |
| POST | `/projects/{id}/rooms` | body = `Room` (`id` optional) |
| PATCH/DELETE | `/rooms/{roomId}` | PATCH body = partial `Room` (deep merge; `null` clears; `id` immutable) |
| POST | `/projects/{id}/components` | `{kind: "wall"|"opening", component: Wall|Opening}` |
| PATCH/DELETE | `/components/{componentId}` | wall or opening; deleting a wall also deletes its openings |
| POST | `/projects/{id}/drawings` | multipart field `file`; PDF/PNG/JPEG by magic bytes; ≤ 25 MB; DXF/DWG → 415 "planned" |
| GET | `/projects/{id}/drawings` | list (newest first) |
| GET | `/drawings/{id}` | metadata incl. `fileUrl` |
| GET | `/drawings/{id}/file` | streams bytes with stored content-type |
| POST/GET/POST | `/drawings/{id}/analyze`, `/analysis`, `/approve` | 501 `not_implemented` |

Granular endpoints return `{projectId, revision, updatedAt, item, kind?, deletedIds?}` (no full model) and
accept an optional `?revision=N` query guard (409 if stale). Each one bumps the building revision, so an
editor holding the old revision will get 409 on its next PUT and must reload.

## Validation boundary

The server enforces the **schema** (strict mirror of building.ts: unknown keys rejected, finite numbers, no
numeric strings/booleans, enum and range constraints, `schemaVersion: 1`) and **structural integrity**
(unique ids per collection, walls+openings share one id space, no dangling `floorId`/`wallId`).
Geometry quality (self-intersecting rooms, openings beyond wall length, `inferred` without `confidence`, …)
is the job of `@hvac/building-geometry` and is intentionally not duplicated.

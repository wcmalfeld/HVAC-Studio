# HVAC Studio

Residential HVAC design platform for contractors: building modeling → load analysis → equipment selection →
duct design → estimates & proposals, in one browser app.

**Status:** Phase 0 (foundation) and Phase 1 (Building Studio) are implemented. Load analysis, equipment,
ducts, estimating and reports are planned (see `docs/product/PRD.md` §28). Load results, when added, will
be labeled *Preliminary* and are not ACCA Manual J reports (see ADR-005).

## What works today
- Accounts, organizations, roles (owner/admin/designer/sales/viewer) and strict tenant isolation.
- Dashboard with search/filters, project cards, duplicate/archive/delete, sample-house projects.
- **Building Studio**: a 2D floor-plan editor with walls, rectangle/polygon/click-to-fill rooms, windows and
  doors on walls, multiple floors, snapping (grid, endpoints, angles), live dimensions, typed exact lengths,
  properties panels with full thermal assemblies, room area/volume/exposure by compass direction, model
  validation, undo/redo, copy/paste, autosave with conflict detection, version history, crash recovery, and
  PDF/PNG/JPG drawing import with two-point scale calibration.

## Repository layout
```
apps/web                    Next.js 16 + React 19 + Tailwind 4 + Konva  (Building Studio, dashboard)
apps/api                    FastAPI + SQLAlchemy 2 + Alembic + Postgres  (auth, tenancy, projects, building)
packages/shared-types       Zod contract for the building model and API payloads (mirrored in Pydantic)
packages/building-geometry  Pure TS geometry engine: units, polygons, room metrics, validation, snapping
docs/                       PRD, architecture decisions
```

## Quick start (local)
Requirements: Node 20+, pnpm 10, Python 3.12+, PostgreSQL 16.

```bash
pnpm install

# API
cd apps/api
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp ../../.env.example .env            # set SECRET_KEY and DATABASE_URL
createdb hvac_studio
.venv/bin/alembic upgrade head
.venv/bin/python scripts/seed_demo.py # demo@hvacstudio.dev / demo-password-123
.venv/bin/uvicorn app.main:app --port 8000

# Web (new terminal, repo root)
pnpm --filter @hvac/web dev           # http://localhost:3000
```

Or with Docker: `docker compose up` (Postgres, Redis, API; see `docker-compose.yml`).

## Deployment
Web on Vercel, API + Postgres on Render (`render.yaml`). Step-by-step: [`docs/deployment.md`](docs/deployment.md).

## Tests
```bash
pnpm --filter @hvac/building-geometry test   # geometry engine (vitest)
pnpm --filter @hvac/web test                 # editor store / autosave (vitest)
pnpm --filter @hvac/web e2e                  # Playwright end-to-end (needs API + web running)
cd apps/api && .venv/bin/pytest              # API incl. tenant-isolation suite (needs Postgres)
```
CI runs typecheck, unit tests, the web build, ruff, migrations and the API suite on every push.

## Engineering rules
Canonical units are inches with y-up plan coordinates; derived values are computed, never stored; missing
engineering inputs stay empty instead of being defaulted; every value carries provenance. See `CLAUDE.md`.

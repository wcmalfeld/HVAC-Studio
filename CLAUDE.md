# HVAC Studio — guide for Claude Code

Residential HVAC design SaaS (building modeling → loads → equipment → ducts → proposals).
Full PRD: `docs/product/PRD.md`. Architecture decisions: `docs/architecture/decisions.md`.

## Layout
- `apps/web` — Next.js (App Router) + TypeScript + Tailwind + Konva. Talks to the API only through `/api/*` (Next rewrites to FastAPI), so cookies are same-origin.
- `apps/api` — FastAPI + SQLAlchemy 2 + Alembic + Postgres. Python ≥3.12.
- `packages/shared-types` — **the contract.** Zod schemas for the building model and API payloads. Pydantic mirror lives in `apps/api/app/schemas/`.
- `packages/building-geometry` — pure TypeScript geometry engine (no React, no DOM). Units, polygons, room metrics, validation, snapping.
- `packages/engineering-engine` — (Phase 2) pure, deterministic calc engine. Not yet built.

## Non-negotiable rules
1. Canonical length unit is **inches**; plan coordinates are y-up. Never derive dimensions from screen pixels — convert at the renderer boundary only.
2. Derived values (area, volume, loads) are computed, never stored as authoritative inputs.
3. Missing engineering inputs are `null`, never silently defaulted. Every value carries `provenance`.
4. Every tenant-owned query filters by `organization_id` from a verified membership. Use the `tenant` dependency in the API; never query tenant tables without it.
5. No AI-generated engineering values. Do not claim ACCA Manual J/S/D compliance anywhere in UI or reports; load results are labeled "Preliminary".
6. Changing `packages/shared-types/src/building.ts` requires bumping `SCHEMA_VERSION`, updating the Pydantic mirror, and adding a migration note.

## Commands
```bash
pnpm install
pnpm --filter @hvac/building-geometry test   # geometry unit tests (vitest)
pnpm --filter @hvac/web dev                  # web on :3000
cd apps/api && source .venv/bin/activate
alembic upgrade head && uvicorn app.main:app --reload --port 8000
pytest                                        # API tests (needs Postgres; DATABASE_URL / TEST_DATABASE_URL)
```

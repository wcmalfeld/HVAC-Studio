# Architecture decisions

## ADR-001 Canonical units: inches, y-up plan coordinates
US residential dimensions are multiples of 1/16", which float64 represents exactly, so inches avoid
rounding drift from metric round-trips. Metric is a display concern. Renderers convert inches → pixels
with a single scale transform and flip y; nothing downstream reads pixel values.

## ADR-002 Building stored as a versioned document, not row-per-wall
The editor edits a whole floor plan with undo/redo and autosave. The building model is stored as one
JSONB document (`buildings.model`) with a monotonic `revision`:
- `PUT /projects/{id}/building` sends `{revision, model}`; the server rejects stale revisions with 409
  (conflict handling across tabs/devices).
- Every accepted save appends a row to `building_revisions` (version history, crash recovery).
- Granular endpoints (`POST /rooms`, `PATCH /components/{id}` …) are implemented server-side as
  document patches, so there is a single source of truth.
- The model is validated against the Pydantic mirror of `@hvac/shared-types` on every write.
A normalized projection (floors/rooms/components tables) can be added when queries need it (e.g.
cross-project analytics); the engineering engine consumes the document directly.

## ADR-003 Auth: server sessions in httpOnly cookies, same-origin via Next rewrites
The API issues a signed JWT in an httpOnly, SameSite=Lax cookie. The browser never sees the token.
Mutations require `X-Requested-With: hvac-studio` (CSRF defense in depth). Passwords hashed with
argon2. Login is rate-limited per IP+email.

## ADR-004 Tenancy: header-selected organization, membership verified per request
`X-Organization-Id` selects the active org; the `tenant` dependency loads the caller's membership or
returns 404 (not 403, to avoid leaking existence). All tenant queries go through it. Cross-tenant
access is covered by dedicated tests.

## ADR-005 Load method (Phase 2, planned): public heat-transfer fundamentals, labeled preliminary
ACCA Manual J tables/procedures are licensed. Until a licensed implementation is reviewed, the engine
will use published fundamentals (U·A·ΔT conduction, infiltration via ACH/CFM, solar gain via SHGC and
published irradiance), versioned as method `hvac-studio-fundamentals@0.x`, with every output labeled
"Preliminary — not a Manual J report". The method interface allows a licensed module to replace it.

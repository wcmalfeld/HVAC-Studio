# @hvac/building-geometry

Pure TypeScript geometry engine for the HVAC Studio building model (`@hvac/shared-types`). No React, no DOM.
It ships as source: `main`/`types`/`exports` point at `src/index.ts`, and Next.js transpiles it.

```bash
pnpm --filter @hvac/building-geometry test       # vitest
pnpm --filter @hvac/building-geometry typecheck
```

## Conventions
- **Units:** inches for every length, y-up plan coordinates, degrees for angles. Square and cubic feet only
  appear in the metric outputs (`*SqFt`, `*CuFt`, `*Ft`). Metric is for display only (`formatLength`, `parseLength`).
- **Tolerances:** `EPS = 1e-6"` for coordinate equality. Geometric matching tolerances are documented on each
  function: wall association 0.5° and `t/2 + 1"`, overlap > 1"; room overlap > 1 sq in; graph merge 0.5" and T-junction 1"
  in `roomFromWalls`.
- **Winding:** room boundaries may be stored either way. The engine normalizes them to CCW (`normalizeCCW`).
  `polygonSignedArea` is positive for CCW.
- **Compass:** `model.northAngleDeg` is the clockwise angle from plan +y to true north.
  `compassAzimuth(dir, north)` = bearing of `dir` from plan +y, minus `north`. For example, with north = 90 a plan +y
  normal faces W (270).
- **Derived values are never stored.** Call `computeRoomMetrics`, `computeFloorSummary` or `computeBuildingSummary` on
  demand. Per-model indexes are cached in a `WeakMap`, so treat models as immutable values (the usual React state
  pattern).

## Room ↔ wall association (see `src/metrics.ts`)
A wall belongs to a room edge when all of these hold:
- it is parallel (< 0.5°);
- its centerline is within `thickness/2 + 1"` of the edge line;
- its projection overlaps the edge by more than 1".

A wall is exposed when `kind === "exterior"` or `adjacentSpace !== "conditioned"`. Exposure length is the overlap.
Gross area is overlap × min(room ceiling, wall height). Openings count only for the part that lies inside the overlap.
Azimuth is taken from the edge's outward normal.

## Validation
`validateModel(model)` returns `ValidationIssue[]`. Each issue has a stable `id` of the form `CODE:entityIds`. Codes:
- WALL_ZERO_LENGTH
- ROOM_TOO_FEW_POINTS
- ROOM_SELF_INTERSECTING
- ROOM_ZERO_AREA
- ROOMS_OVERLAP
- DANGLING_FLOOR_REF
- DANGLING_WALL_REF
- DUPLICATE_ID
- OPENING_OUT_OF_WALL
- OPENINGS_OVERLAP
- OPENING_TALLER_THAN_WALL
- EXTERIOR_WALL_MISSING_R_OR_U
- WINDOW_MISSING_U
- WINDOW_MISSING_SHGC
- DOOR_MISSING_U
- ROOM_NO_EXPOSURE
- INFERRED_NEEDS_REVIEW
- INFERRED_MISSING_CONFIDENCE

## Sample project
`packages/shared-types/fixtures/sample-house.json` is a two-floor house:
- first floor: 1,400 ft²;
- second floor: 900 ft².

It validates with zero issues. `test/metrics.test.ts` has hand-computed metrics for every room.

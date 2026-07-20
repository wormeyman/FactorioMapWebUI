# elevation_island client render - design

Date: 2026-07-19
Status: approved design, pre-plan

## Goal

Render the "Island" map type client-side, the last unported elevation tree. Today
`elevationCtxFromPreset` marks island `supported: false`, so the client Preview tab
shows "not available for Island elevation". After this work, selecting Island renders
in the browser like Nauvis and Lakes already do, validated against the headless
Factorio oracle to the same f32 floor.

## Background: what elevation_island is

From `core/prototypes/noise-programs.lua` (Factorio 2.1.x):

```lua
-- elevation_lakes
finish_elevation{
  elevation = make_0_12like_lakes{
    x = x, y = y, bias = 20, terrain_octaves = 8,
    segmentation_multiplier = segmentation_multiplier },
  segmentation_multiplier = segmentation_multiplier }

-- elevation_island   (order = "z")
local_expressions = { segmentation_mult = "segmentation_multiplier / 4" }
finish_elevation{
  elevation = make_0_12like_lakes{
    x = x, y = y, bias = -1000, terrain_octaves = 8,
    segmentation_multiplier = segmentation_mult },
  segmentation_multiplier = segmentation_mult }
```

Island is `elevation_lakes` with exactly two deltas:

1. `bias = -1000` (vs 20).
2. `segmentation_multiplier / 4`, fed into **both** `make_0_12like_lakes` and
   `finish_elevation` (the game defines `segmentation_mult = segmentation_multiplier / 4`
   once and passes it to both).

`terrain_octaves` stays 8. No new noise primitive is required.

### The bias vs literal-20 subtlety (already anticipated)

Inside `make_0_12like_lakes` the two branches are:

```
max( bias + variable_persistence_multioctave_noise{seed1=1, octaves=terrain_octaves},
     20 + water_level - 0.1*segmentation_multiplier*distance
        + variable_persistence_multioctave_noise{seed1=2, octaves=6} )
```

Branch 1 uses the `bias` parameter; branch 2 uses a **literal 20**. At lakes they
coincide (bias == 20). At island bias == -1000 while branch 2's constant stays 20,
so branch 1 collapses far below branch 2 almost everywhere - which is what produces
"a large island surrounded by endless ocean". The existing port
(`src/noise/expressions/elevationLakes.ts:108-110`) already hard-codes the literal 20
in branch 2 with a NOTE, so threading a real `bias` param through branch 1 is the only
change needed to make the two trees share code correctly.

`distance` (branch 2) and `starting_lake_distance` / `starting_lake_positions`
(finish_elevation) do not depend on segmentation, so the seg/4 change flows purely
through `input_scale`, `offset_x`, branch 2's `-0.1*seg*distance` term, and
finish_elevation's `(elevation - water_level) / seg` term - all already parameterized
on `seg` in the existing port.

## Approach (chosen: A)

Parameterize the shared lakes builder with an optional `bias`, and add a thin island
wrapper. Rejected alternatives: (B) duplicate the ~100-line tree into a standalone
island file - pure duplication and drift risk; (C) apply bias/seg÷4 in the render
dispatch - leaks tree internals into the renderer.

### 1. `src/noise/expressions/elevationLakes.ts`

- Add `readonly bias?: number` to `ElevationLakesParams` (default 20).
- In `make0_12likeLakes`, `branch1 = bias + varPers1(...)` uses the param.
  Branch 2 keeps its literal 20 (unchanged). Update the NOTE to reference the island
  variant explicitly.
- No behavior change for existing lakes callers (default preserves bias 20).

### 2. `src/noise/expressions/elevationIsland.ts` (new)

Mirror the lakes file's structure:

```
export interface ElevationIslandParams { /* same fields as ElevationLakesParams sans bias */ }

export function makeElevationIsland(params): (x, y) => number {
  const seg = params.segmentationMultiplier ?? 1;
  return makeElevationLakes({
    ...params,
    bias: -1000,
    segmentationMultiplier: seg / 4,
  });
}

export function elevationIsland(ctx: EvalCtxInput): number { /* convenience, like lakes */ }
```

`makeElevationIsland` has the SAME signature as `makeElevationLakes` /
`makeElevationNauvis` (callers pass the raw user `segmentationMultiplier`; the /4 is
applied inside, matching where the game applies it). The `bias` param is island's only
extra input and is fixed at -1000, so it is not exposed on `ElevationIslandParams`.

### 3. Dispatch wiring

Widen the render map-type union from `"lakes" | "nauvis"` to include `"island"` in:

- `src/noise/preview/renderElevation.ts` - `RenderElevationOptions.mapType`, and turn
  the `mapType === "nauvis" ? makeElevationNauvis : makeElevationLakes` ternary into a
  3-way pick (`nauvis` -> nauvis, `island` -> island, else lakes).
- `src/noise/preview/elevationRenderRequest.ts` - the `mapType` field carried to the
  worker.
- `src/model/elevationPreviewCtx.ts` - `ElevationPreviewCtx.mapType`, and change
  `elevationCtxFromPreset` so `mt.id === "island"` yields `supported: true` and
  `mapType: "island"` (today island falls into the unsupported branch).

`ElevationPreviewCtx.ctx.segmentationMultiplier` stays the raw `control:water:frequency`
value; island's /4 lives inside `makeElevationIsland`, not in the ctx.

### 4. Oracle + tests (TDD)

- Add `captureElevationIsland()` to `test/oracle/capture.ts`, a clone of
  `captureElevationLakes()` that samples `"elevation_island"` (same position grid: a
  near-origin band, two far rings at r=2200/3300, one deep-field point; plus `distance`
  and capped `starting_lake_distance`). Register it under a `want("elevation-island")`
  gate. Write `test/fixtures/oracle-elevation-island.seed123456.json`.
- Regenerate the fixture against headless Factorio:
  `node --experimental-strip-types test/oracle/capture.ts elevation-island`.
- Add `test/elevationIsland.spec.ts`, mirroring `elevationLakes.spec.ts`:
  - has-parity-testable-points guard,
  - water mask (`elevation < 0`) on saturated (`startingLakeDistance >= 1024`)
    far-field points, skipping the coastline band (`|exp| < 1e-3`),
  - numeric parity to the f32 floor on saturated points,
  - near-spawn numeric parity (computed starting lakes) on the un-saturated band.

## Validation gate

The numeric parity test against the freshly captured island fixture must pass to the
same f32 coordinate floor as lakes (lakes calibrates worst < 8e-3). The exact island
bound is set from the observed worst error once the fixture is captured - calibrated
just above it, never loosened to force a pass. `bias = -1000` makes branch 1 dominate
`max()` far less often than at lakes; if that surfaces a divergence the lakes port did
not, it is a real finding to investigate, not a tolerance to relax.

## Out of scope

- Climate colors, resources, and other Milestone 2+ roadmap items.
- Any change to the `elevation_island` / lakes wire codec or map-type model
  (`mapType.ts` already emits `elevation_island`).
- Nauvis/lakes behavior (bias default preserves lakes exactly).

## Test plan

- `pnpm vp test test/elevationIsland.spec.ts` - new parity spec (green).
- `pnpm vp test test/elevationLakes.spec.ts test/renderElevation.spec.ts test/mapType.spec.ts`
  - unchanged existing specs still green (no regression from the bias param / union widen).
- `pnpm vp test` - full suite green.
- `pnpm vp check` - lint/format clean.
- Manual: `pnpm vp dev`, select map type Island, confirm the Preview tab renders an
  island-in-ocean instead of the "not available" message.

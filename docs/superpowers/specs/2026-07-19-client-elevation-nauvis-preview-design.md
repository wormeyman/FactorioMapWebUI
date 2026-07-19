# Client-side Nauvis elevation preview - design

Written 2026-07-19. Point-in-time design record (not a living doc). Follows the
`elevation_lakes` port (`2026-07-18-m1-elevation-lakes-preview-design.md`) and the
preview wiring (`2026-07-19-client-elevation-preview-design.md`) as templates.

## Goal

Render the **default Nauvis elevation** (`elevation_nauvis`) in the browser Preview
tab, matching the game's `elevation` to the noise floor (~1e-6, worst-case a bit
looser at the documented f32 floor). Today the Preview tab renders only
`elevation_lakes`; the Nauvis and Island map types show "Client preview is not
available for <label> yet." This makes **Nauvis** (the default map type) render.

## Key finding: no new primitive is required

The roadmap listed `Ridge` and `Terrace` as "small" TODOs and the resume brief
assumed `elevation_nauvis` needs them. It does not. There is no `ridge` or
`terrace` node anywhere in `core/prototypes/noise-programs.lua`, and none in the
`elevation_nauvis` dependency chain - every apparent "ridge" is the substring in
**b*ridge*** (`nauvis_bridges`, `nauvis_bridge_billows`, `nauvis_bridge_paths`).
`terrace` appears nowhere in the game data.

`elevation_nauvis = elevation_nauvis_function(nauvis_hills_plateaus)` depends only
on primitives already ported and validated:

| Node | Primitive | Module |
| --- | --- | --- |
| `nauvis_bridge_billows`, `nauvis_hills`, `nauvis_macro` (x2) | `multioctave_noise` | `multioctaveNoise.ts` |
| `nauvis_persistance` | `amplitude_corrected_multioctave_noise` | `variablePersistenceMultioctaveNoise.ts` |
| `nauvis_detail` | `variable_persistence_multioctave_noise` | `variablePersistenceMultioctaveNoise.ts` |
| `nauvis_hills_cliff_level` | `basis_noise` | `basisNoise.ts` / `eval/primitives.ts` |
| `starting_lake_noise` | `quick_multioctave_noise_persistence` | `quickMultioctaveNoise.ts` |
| `distance`, `starting_lake_distance` | `distance_from_nearest_point` | `distanceFromNearestPoint.ts` |
| lerp / clamp / min / max / abs / log2 | math | `eval/math.ts` |

So this is a **tree port + preview wiring** job. No reverse-engineering; `Ridge`
and `Terrace` stay as roadmap TODOs (unused by any elevation tree).

## The tree (from `core/prototypes/noise-programs.lua`, verbatim)

Scalars / vars:
- `map_seed` = `seed0`.
- `segmentation_multiplier` (`seg`) = `control:water:frequency` (the preset lever).
- `nauvis_segmentation_multiplier` = `1.5 * control:water:frequency` = `1.5 * seg`
  (a **distinct** internal scalar - do not conflate with `seg`).
- `water_level` = `10 * log2(control:water:size)`.
- `distance` = `distance_from_nearest_point{points = starting_positions}` (uncapped).
- `starting_lake_positions` = runtime spawn/lake points, reused from the lakes port
  (`startingLakes.ts`), capped at 1024 in `starting_lake_distance`.

Noise nodes (all at `seed0 = map_seed`):
- `nauvis_bridge_billows` = `abs(multioctave{seed1=700, octaves=4, persistence=0.5, input_scale=seg/150})`
- `nauvis_bridges` = `1 - 0.1*bb - 0.9*max(0, -0.1 + bb)` (bb = bridge_billows)
- `nauvis_persistance` = `clamp(amplitude_corrected_multioctave{seed1=500, octaves=5, input_scale=seg/2, offset_x=10000/seg, persistence=0.7, amplitude=0.5} + 0.55, 0.5, 0.65)`
- `nauvis_detail` = `variable_persistence_multioctave{seed1=600, input_scale=seg/14, output_scale=0.03, offset_x=10000/seg, octaves=5, persistence=nauvis_persistance}`
- `nauvis_macro` = `multioctave{seed1=1000, octaves=2, persistence=0.6, input_scale=seg/1600} * max(0, multioctave{seed1=1100, octaves=1, persistence=0.6, input_scale=seg/1600})`
- `nauvis_hills` = `abs(multioctave{seed1=900, octaves=4, persistence=0.5, input_scale=seg/90})`
- `nauvis_hills_cliff_level` = `clamp(0.65 + basis_noise{seed1=99584, input_scale=seg/500, output_scale=0.6}, 0.15, 1.15)`
- `nauvis_plateaus` = `0.5 + clamp((nauvis_hills - nauvis_hills_cliff_level)*10, -0.5, 0.5)`
- `nauvis_hills_plateaus` = `0.1*nauvis_hills + 0.8*nauvis_plateaus`

Function body, `added_cliff_elevation = nauvis_hills_plateaus`,
`elevation_magnitude = 20`, `wlc_amplitude = 2`:
- `nauvis_main` = `20 * (lerp(0.5*ace - 0.6, 1.9*ace + 1.6, 0.1 + 0.5*nauvis_bridges) + 0.25*nauvis_detail + 3*nauvis_macro*starting_macro_multiplier)`
- `starting_macro_multiplier` = `clamp(distance * nauvis_seg / 2000, 0, 1)` (nauvis_seg = 1.5*seg)
- `starting_island` = `nauvis_main + 20 * (2.5 - distance*seg/200)`
- `wlc_elevation` = `max(nauvis_main - water_level*2, starting_island)`
- `starting_lake_distance` = `distance_from_nearest_point{points=starting_lake_positions, maximum_distance=1024}`
- `starting_lake_noise` = `quick_multioctave_noise_persistence{seed1=14, input_scale=1/8, output_scale=0.8, octaves=4, octave_input_scale_multiplier=0.5, persistence=0.68}`
- `starting_lake` = `20 * (-3 + (starting_lake_distance + starting_lake_noise)/8) / 8`
- **result** = `min(wlc_elevation, starting_lake)`

`lerp(a, b, alpha) = a + (b - a)*alpha`. We render `elevation_nauvis` (with the
plateau/cliff term fed in), not `elevation_nauvis_no_cliff` - it is the game's
actual default and shows plateaus as raised land.

### Fidelity note (same as lakes)

The tree references `distance` (from `starting_positions`) and
`starting_lake_positions`, so it inherits the lakes port's near-spawn fidelity
story: faithful far from spawn, and near-spawn as good as the
`starting_lake_positions` RE (`startingLakes.ts`), which is reused unchanged. Far
from lakes, `starting_lake_distance` saturates at 1024, so `starting_lake`
(~+300) drops out of the `min` and `wlc_elevation` governs the coastline.

## Components

### 1. `makeMultioctaveNoise` (new, `src/noise/multioctaveNoise.ts`)

Plain `multioctave_noise` is called ~5x per pixel by the Nauvis tree but has no
table-hoisting `make*` variant. Add `makeMultioctaveNoise(params) -> (x, y) => number`
mirroring `makeQuickMultioctaveNoise`: derive the basis tables and per-octave
`{scale, amp}` once, and the RMS normalization once. Reuses the existing
`normalization`/`basisNoise` internals so it stays byte-identical to
`multioctaveNoise`.

- **Test** (`test/multioctaveNoise.spec.ts`, extend): `makeMultioctaveNoise(p)(x,y)`
  equals `multioctaveNoise(x,y,p)` across a grid and several param sets (same code
  path, no oracle needed). This locks the perf refactor to the validated function.

### 2. `makeElevationNauvis` (new, `src/noise/expressions/elevationNauvis.ts`)

`makeElevationNauvis(params: ElevationNauvisParams) -> (x, y) => number`, structured
node-for-node like the Lua, hoisting every basis table / octave closure once per
seed (the 96%-of-cost lesson from lakes). `ElevationNauvisParams` is identical in
shape to `ElevationLakesParams` (`seed0`, `waterLevel?`, `segmentationMultiplier?`,
`startingPositions?`, `startingLakePositions?`) so the render dispatch is a clean
switch. Hoisted once:
- `makeMultioctaveNoise` closures for seed1 = 700, 900, 1000, 1100.
- `makeVariablePersistenceMultioctaveNoise` for `nauvis_detail` (seed1=600).
- `amplitude_corrected` tables (seed1=500) for `nauvis_persistance`.
- `basisNoiseTablesFromSeed(seed0, 99584)` for `nauvis_hills_cliff_level`.
- `makeQuickMultioctaveNoisePersistence` for `starting_lake_noise` (seed1=14).
- `startingLakePositions` (default via `computeStartingLakes`, same as lakes).

Also expose a single-point `elevationNauvis(ctx: EvalCtxInput)` convenience mirroring
`elevationLakes`, for spec ergonomics.

- **Test** (`test/elevationNauvis.spec.ts`, new): oracle parity gate. Sample the
  game's default `elevation` on a grid for a few seeds via `test/oracle/`, assert
  agreement to the documented floor. Capture-once fixture like the lakes spec; gate
  on the local Factorio install. **Never loosen a tolerance to pass** - a mismatch
  is a real finding.

### 3. Render dispatch by map type

`elevation_lakes` and `elevation_nauvis` share the ctx fields, so the selector is a
small enum threaded end to end:

- **`elevationRenderRequest.ts`**: add `mapType: "lakes" | "nauvis"` to
  `ElevationRenderRequest`; `runRenderRequest` passes it to `renderElevation`.
- **`renderElevation.ts`**: pick the factory by `mapType`
  (`makeElevationNauvis` vs `makeElevationLakes`); the sweep loop, the
  `< 0 -> water` rule, and the `ctx` shape are unchanged. `RenderElevationOptions`
  gains `mapType`.
- **`elevationPreviewCtx.ts`**: return the resolved `mapType` and set
  `supported: true` for both `elevation_lakes` and `elevation_nauvis` (a map-type
  -> `"lakes" | "nauvis"` map; Nauvis is the default/absent elevation string).
  Island stays unsupported.
- **`ElevationPreviewPanel.vue`**: pass `mapType` from the ctx into
  `renderer.render({...})`. No other UI change; the toolbar/canvas already gate on
  `supported`.

## Data flow

```
Preset --elevationCtxFromPreset--> { supported, mapType, mapTypeLabel, ctx }
  panel.generate() --render(req{ mapType, seed0, window, ctx })--> Worker
    runRenderRequest --> renderElevation
      mapType==="nauvis" ? makeElevationNauvis : makeElevationLakes
      per-pixel elevation < 0 ? water : land --> RGBA --> canvas
```

## Testing strategy

1. `makeMultioctaveNoise` parity vs `multioctaveNoise` (pure, no oracle).
2. `elevationNauvis` vs the game oracle (the correctness gate; capture-once fixture).
3. `elevationPreviewCtx` unit: Nauvis (default/absent elevation) -> `supported:true,
   mapType:"nauvis"`; Island -> unsupported.
4. Render dispatch unit: a `runRenderRequest` with `mapType:"nauvis"` produces pixels
   consistent with `makeElevationNauvis` at a couple of sample points (mirrors the
   lakes render test).
5. Full suite green via `pnpm vp test`; `pnpm vp check --fix`; watch LSP `.ts`
   diagnostics (no `vue-tsc` gate).

## Out of scope

- `elevation_island` (trivial lakes variant, `bias=-1000`) - separate follow-up.
- `Ridge` / `Terrace` primitives - unused by any elevation tree; stay TODO.
- Climate colors, cliffs-as-cliffs, resources (later milestones).
- Any zoom/pan UI beyond the existing fixed spawn window.

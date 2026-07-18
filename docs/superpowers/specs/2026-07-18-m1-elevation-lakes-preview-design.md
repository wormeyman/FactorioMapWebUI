# M1: elevation_lakes client-side preview - design

Date: 2026-07-18
Status: approved design, ready for planning
Roadmap: `docs/noise/client-preview-ROADMAP.md` (this is Milestone 1)

## Goal

Render the Factorio 2.1.9 `elevation_lakes` map type to a canvas entirely in
TypeScript - no headless preview-service container - with land/water taken from
the sign of the computed elevation. This is the first end-to-end wiring of the
already-solved layer-1 noise primitives into a named noise expression.

Non-goals for M1:

- The Nauvis default tree (`elevation_nauvis`) is explicitly deferred to a
  follow-up. It needs a much larger free-var set (`nauvis_segmentation_multiplier`,
  hill/plateau layers, water-level-correction, starting-island logic).
- No DSL parser / op-AST interpreter. See "Evaluator shape" below.
- No wiring of climate/autoplace `control:*` constants (elevation_lakes references
  none - verified below).
- Deep/shallow water distinction. A single `elevation < 0 => water` binary mask is
  the M1 render (see N7 caveat).

## Background: the primitives are done, the tree is not

All layer-1 noise primitives the elevation_lakes tree needs are implemented and
oracle-validated (478 tests green through commit 55ce3a7):

- `variablePersistenceMultioctaveNoise` / `makeVariablePersistenceMultioctaveNoise`
  and `amplitudeCorrectedMultioctaveNoise` - `src/noise/variablePersistenceMultioctaveNoise.ts`
- `quickMultioctaveNoisePersistence` - `src/noise/quickMultioctaveNoise.ts`
- `basisNoise` / `basisNoiseTablesFromSeed` - `src/noise/basisNoise.ts`
- `distanceFromNearestPoint` - `src/noise/distanceFromNearestPoint.ts`

What does NOT yet exist: any named noise **tree** evaluated through these
primitives, and any oracle fixture for a tree (every committed fixture is a
single primitive). `elevation_lakes` today is only a string enum in
`src/model/mapType.ts`. M1 builds the tree evaluator and its first tree fixture.

## The tree, verified against the game Lua

Source of truth: `core/prototypes/noise-programs.lua`
(`/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data/`).
Every constant below was read directly from the file (line numbers cited); do not
re-derive.

### elevation_lakes (lines 244-252)

```
finish_elevation{
  elevation = make_0_12like_lakes{x, y, bias = 20, terrain_octaves = 8,
                                  segmentation_multiplier = segmentation_multiplier},
  segmentation_multiplier = segmentation_multiplier
}
```

### make_0_12like_lakes (noise-function, lines 137-175)

```
max(
  branch1 = bias + variable_persistence_multioctave_noise{
              seed0 = map_seed, seed1 = 1, input_scale = input_scale,
              output_scale = 0.125, offset_x = offset_x,
              octaves = terrain_octaves, persistence = persistence},
  branch2 = 20 + water_level - 0.1 * segmentation_multiplier * distance
              + variable_persistence_multioctave_noise{
                  seed0 = map_seed, seed1 = 2, input_scale = input_scale,
                  output_scale = 0.125, offset_x = offset_x,
                  octaves = 6, persistence = persistence}
)
```

local_expressions:
- `input_scale = segmentation_multiplier / 2`
- `offset_x = 10000 / segmentation_multiplier`
- `persistence = clamp(amplitude_corrected_multioctave_noise{seed0 = map_seed,
  seed1 = 1, octaves = terrain_octaves - 2, input_scale = input_scale,
  offset_x = offset_x, persistence = 0.7, amplitude = 0.5} + 0.3, 0.1, 0.9)`

Note (S5): branch2's leading term is the **literal `20`** plus `water_level`, NOT
the `bias` parameter. For elevation_lakes `bias == 20` so they coincide, but the
port MUST use the literal in branch2 - reusing the `bias` param would break the
future `elevation_island` port (`bias = -1000`) and is simply not what the Lua
says.

### finish_elevation (noise-function, lines 176-198)

```
min(
  term1 = (elevation - water_level) / segmentation_multiplier,
  term2 = basis_noise{seed0 = map_seed, seed1 = 123, input_scale = 1/8,
                      output_scale = 1.5} + starting_lake_distance / 4 - 4,
  term3 = -1 + (starting_lake_distance + starting_lake_noise) / 16,
  term4 = max(2, 2 + starting_lake_distance / 16 + starting_lake_noise / 2)
)
```

local_expressions:
- `starting_lake_distance = distance_from_nearest_point{points = starting_lake_positions,
  maximum_distance = 1024}`
- `starting_lake_noise = quick_multioctave_noise_persistence{seed0 = map_seed,
  seed1 = 14, input_scale = 1/8, output_scale = 1, octaves = 5,
  octave_input_scale_multiplier = 0.5, persistence = 0.75}`

### Free variables (lines 570-591)

- `distance = distance_from_nearest_point{points = starting_positions}` - line 571,
  passes **no** `maximum_distance`.
- `water_level = 10 * log2(control:water:size)` - line 586. Default `size = 1` =>
  `log2(1) = 0` => `water_level = 0`.
- `segmentation_multiplier = control:water:frequency` - line 591. Default => `1`.
- `map_seed = seed0`.

## Scope decisions (resolved)

1. **Far-from-spawn MVP**, modeled concretely as `startingPositions = [{x:0, y:0}]`
   and `startingLakePositions = []`. This gives `distance = hypot(x, y)` everywhere
   and makes `starting_lake_distance` saturate at its 1024 cap. See the "Two
   distance regimes" analysis below for why this matters and where it is/ isn't
   faithful.
2. **Thin-ctx hand-port** (not a DSL parser, not an op-AST interpreter). Each named
   noise expression becomes a plain TS function mirroring the game Lua 1:1;
   arithmetic is plain JS; `min`/`max`/`clamp`/`lerp`/`log2` are tiny helpers.
3. **Target = elevation_lakes only**, rendered to canvas.

## Two distance regimes, and why term collapse is not term omission

`make_0_12like_lakes = max(branch1, branch2)` where
`branch2 = 20 + water_level - 0.1 * seg * distance + varPers2`.

- Near spawn (`distance ~ 0`): branch2 sits near `20 + water_level` and **competes**
  with branch1.
- Far from spawn (`distance` large): the `-0.1 * seg * distance` term drives branch2
  strongly negative, so branch1 always wins the `max`.

Consequence for the oracle (C1): the value of `elevation_lakes` in the starting
area depends on what the game actually supplies for `starting_positions`. This does
**not** "resolve itself" - it must be pinned down at capture time (see Task 0).

Separately, in `finish_elevation` with `startingLakePositions = []` so
`starting_lake_distance = 1024`:
- term2 ~= `basis (in [-1.5, 1.5]) + 1024/4 - 4` ~= 252
- term3 ~= `-1 + (1024 + noise)/16` ~= 63
- term4 ~= `max(2, 2 + 1024/16 + noise/2)` ~= 66-90
- term1 ~= `(elevation - 0)/1` ~= elevation

The water mask (`elevation < 0`) is set by term1 near its zero crossing, where
terms 2-4 are ~60-250 and never selected by the `min` - so the coastline is
faithful. BUT `make_0_12like_lakes` peaks can exceed term4 (~40-90) in
high-persistence regions, where term4 clips the elevation. Therefore (S2): **the
port always computes all four terms** exactly as the Lua does. "Collapse" only
explains why terms 2-4 do not move the coastline; it is NOT a license to omit them
- omitting them would fail numeric oracle parity on high-elevation tiles.

## Module layout

```
src/noise/eval/
  ctx.ts         EvalCtx type + defaults; derived `distance` accessor
  math.ts        clamp, lerp, varargs min/max, log2 (match the game's log2)
  primitives.ts  expression-form adapters wrapping the existing param-object
                 primitives so an expression calls them with (ctx-ish, params)
src/noise/expressions/
  elevationLakes.ts   make_0_12like_lakes, finish_elevation, elevationLakes(ctx)
src/noise/preview/
  renderElevation.ts  sample a grid -> ImageData (elevation < 0 => water, else land)
```

### EvalCtx (ctx.ts)

```ts
interface EvalCtx {
  x: number; y: number;
  seed0: number;                    // = map_seed
  waterLevel: number;               // default 0  (10*log2(control:water:size), size=1)
  segmentationMultiplier: number;   // default 1  (control:water:frequency, default 1)
  startingPositions: Point[];       // default [{x:0,y:0}] -> distance = hypot(x,y)
  startingLakePositions: Point[];   // default []          -> saturates at 1024
}
```

`distance` is DERIVED (not stored) via `distanceFromNearestPoint(x, y, startingPositions)`
- single source of truth. `EvalCtx` covers every free var elevation_lakes
references; no `control:*` constant is referenced directly, so none are plumbed.

### primitives.ts - the expression-form adapters (S3)

The named-expression code should not juggle the raw param-object primitives
directly for every call. `primitives.ts` provides thin adapters. Two the module
list must not forget:

- **basis_noise adapter** (finish_elevation term2). `basisNoise(x, y, tables)` has
  NO built-in input/output scale or offset. The adapter applies them:
  `output_scale * basisNoise((x + offset_x) * input_scale, y * input_scale, tables)`
  with `tables = basisNoiseTablesFromSeed(seed0, 123)`, `input_scale = 1/8`,
  `output_scale = 1.5`, `offset_x = 0`.
- **starting_lake_noise adapter** wrapping `quickMultioctaveNoisePersistence`
  (seed1 = 14, octaves = 5, oism = 0.5, output_scale = 1, persistence = 0.75).

### Performance (N6)

Per render (one seed, whole grid), derive each primitive's basis tables ONCE and
reuse them across pixels - do NOT call the per-call param-object primitives per
pixel, which re-derive tables every call (a large hit over a full grid). Concretely:

- The two varPers branches use `makeVariablePersistenceMultioctaveNoise` (its closure
  keeps taking `(x, y, persistence)` since persistence varies per tile).
- The term2 basis adapter derives `basisNoiseTablesFromSeed(seed0, 123)` once.
- `starting_lake_noise` uses `quickMultioctaveNoisePersistence`, which has no `make*`
  closure form today. Options for the plan to weigh: hoist its table derivation
  (small refactor to expose a closure form), or accept a per-pixel call (it is called
  once per pixel, not per octave-and-pixel, so measure before optimizing).

The persistence field is computed per pixel first and fed to both varPers branches.

### Seed handling (N9)

The store models "random each new map" as `seed = null` (encodes to wire 0). The
preview needs a concrete `seed0`. M1 decision: the render takes an explicit
`seed0: number`; the UI layer that eventually calls it resolves `null` to a chosen
concrete seed (e.g. the same value the game would roll, or a fixed preview seed).
Resolving `null` is the caller's job, not `renderElevation`'s - keep the render
pure in `seed0`.

## Testing plan (TDD, oracle-first)

### Task 0 - de-risk the oracle path BEFORE writing elevationLakes.ts (C1)

Nothing has ever sampled a full tree through the harness, and the `[{0,0}]` / `[]`
ctx assumption is unverified. Before porting the tree:

1. **Spike:** prove the harness can sample `elevation_lakes` at all - route it onto
   `elevation` (or whatever the harness needs) and sample a grid. Confirms a full
   tree can be captured, not just a primitive.
2. **Capture the distance free-vars as their own fixtures** at the probe positions:
   `distance` (`distance_from_nearest_point{points = starting_positions}`) and
   `starting_lake_distance` (`...{points = starting_lake_positions,
   maximum_distance = 1024}`). This reveals the game's actual spawn/lake points
   indirectly and validates or kills the ctx defaults.
3. **Choose probe positions far from spawn** (thousands of tiles) so branch1
   dominates regardless of the spawn-point question - plus a near-origin band so the
   fixture still exercises the `hypot`-driven regime if the capture confirms
   `[{0,0}]`.

If step 2 shows the oracle supplies empty/origin-only points, the EvalCtx defaults
match the oracle everywhere and there is no near-origin caveat. If not, read the
actual points from the oracle into the fixture's ctx and document the far-from-spawn
fidelity limit in the render.

### Task 1 - fixture

Add a capture case to `test/oracle/capture.ts`:
`sampleExpression("elevation_lakes", grid, {seed})` ->
`test/fixtures/oracle-elevation-lakes.seed123456.json`. The grid MUST span
near-origin AND far (>1200 tiles) cells (per Task 0.3).

### Task 2 - CI-safe spec

`test/elevationLakes.spec.ts`: pure-TS `elevationLakes(ctx)` vs fixture, assert
`< 1e-6` (the fastapprox basis floor). This is where `distanceFromNearestPoint`
finally gets end-to-end oracle validation (standalone it could not - the DSL
rejects a literal points list).

### Task 3 - render smoke test

`renderElevation` produces an `ImageData` of expected dims; then a manual eyeball of
the coastline against a real `factorio --generate-map-preview` with elevation_lakes
selected (gated on Factorio presence).

## Open questions / caveats folded from review

- **S4:** The claim "`distance` is uncapped" is only relatively verified: line 571
  passes no `maximum_distance` while line 187 passes 1024. The absolute default is
  flagged unconfirmed in `distanceFromNearestPoint.ts:38-40`. Low-impact for
  elevation_lakes (branch1 is distance-independent and dominates far out); the port
  passes no cap for `distance` and `1024` for `starting_lake_distance`.
- **N7:** `elevation < 0 => water` is the standard binary cutoff and fine for the
  MVP mask; confirm it matches at least the game's land/water boundary before
  trusting the render visually.
- **N8:** `log2` in `water_level` is inert at defaults (`log2(1) = 0`). Provide a
  correct `log2` helper but do not gold-plate a fastapprox match - it only matters
  once the water-coverage slider is wired.

## Task 0 result (oracle spike, 2026-07-18)

Ran the capture at seed 123456 (26-point grid: a 3x3 near-origin band + two far
rings at r=2200/3300 x 8 angles + one deep-field point). Findings:

- **`distance == hypot(x, y)`** to 4.6e-3 (large-coord 1/256 quantization) at every
  point. So the game's `starting_positions` is the single origin spawn `[{0,0}]`;
  the `EvalCtx` default `startingPositions=[{x:0,y:0}]` is faithful **everywhere**.
- **`starting_lake_positions` is NOT empty.** The game placed real starting lakes:
  `starting_lake_distance` runs 57-91 across the near-origin band and saturates at
  1024 only in the far field (17 of 26 points). So the far-from-spawn default
  `startingLakePositions=[]` is faithful **only where sld == 1024**. Near spawn the
  empty-lake model diverges (the lakes pull elevation down via finish_elevation
  terms 3-4). This is the far-from-spawn fidelity limit the scope decision accepted;
  it is documented in `renderElevation.ts`, and rendering the actual near-spawn lakes
  is deferred (needs the real lake positions, out of M1 scope).
- **Full-tree sampling through the harness works** (the C1 unknown): `elevation_lakes`
  routed onto `elevation` evaluates cleanly in `on_init`, and the free vars
  (`distance`, `starting_lake_positions`, `water_level`, `segmentation_multiplier`)
  are all available.

Consequence for Task 4: the CI parity test uses the default ctx (`ctxOverrides = {}`)
and asserts only on the saturated (sld == 1024) points. Every point samples basis at
`offset_x = 10000`, so all parity points sit in the f32 coordinate-floor regime (one
tolerance bound, no near-field class).

## Files touched (new)

- `src/noise/eval/ctx.ts`, `src/noise/eval/math.ts`, `src/noise/eval/primitives.ts`
- `src/noise/expressions/elevationLakes.ts`
- `src/noise/preview/renderElevation.ts`
- `test/oracle/capture.ts` (add case), `test/fixtures/oracle-elevation-lakes.seed123456.json`
- `test/elevationLakes.spec.ts`

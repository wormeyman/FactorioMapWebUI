# Milestone 2 - client-side climate terrain colors - design

Date: 2026-07-19
Status: approved design, pre-plan

## Goal

Render Factorio's Nauvis terrain **colors** (grass / dirt / sand / red-desert +
water) client-side in the preview, matching the game's `--generate-map-preview`.
Today the client preview is a binary water/land elevation mask; this milestone adds
the climate layer (temperature/moisture/aux), the tile-autoplace resolution that
picks a tile per pixel, and the `map_color` palette.

All noise ports follow the established pattern: hand-ported TypeScript closures over
the already-solved primitives, validated against the headless-Factorio oracle to the
f32 floor. No DSL evaluator.

## Background (from the game data - authoritative)

Sources: `core/prototypes/noise-programs.lua`, `core/prototypes/noise-functions.lua`,
`base/prototypes/tile/tiles.lua`, `base/prototypes/noise-expressions.lua` (Factorio 2.1.x).

### Tile selection is a pure argmax over aux + moisture + elevation

The placed tile is the one whose `probability_expression` is **maximum** at that
point. Tile `order` is documented to have NO effect (unlike entities). Ties are a
non-issue with continuous float noise. Base terrain is driven by:

- **water tiles** by `elevation` (via `water_base`),
- **19 land tiles** by `aux` + `moisture` (via `expression_in_range_base`) plus a
  per-tile `noise_layer_noise(N)` jitter,
- `sand-1` additionally by an `elevation`+`aux` coastal term.

**Temperature drives NO base tile** (zero references in `tiles.lua`). It is ported
this milestone for completeness / a future heatmap, but is not needed for the palette.

### The default Nauvis climate expressions

Default technical properties on Nauvis: `temperature` = `temperature_basic`,
`moisture` = `moisture_nauvis`, `aux` = `aux_nauvis`. Full transitive closure
(verified by reading the Lua):

- `temperature_basic` = `clamp(15 + var('control:temperature:bias') + quick_multioctave_noise{seed1=5, octaves=4, input_scale=control:temperature:frequency/32, output_scale=1/20, offset_x=40000/control:temperature:frequency, octave_output_scale_multiplier=3, octave_input_scale_multiplier=1/3}, -20, 50)`. Self-contained.
- `aux_nauvis` = `clamp(0.5 + var('control:aux:bias') + 0.06*(nauvis_plateaus - 0.4) + aux_noise, 0, 1)`, where `aux_noise` = `quick_multioctave_noise{seed1=7, octaves=4, input_scale=control:aux:frequency/2048, output_scale=0.25, offset_x=20000/control:aux:frequency, octave_output_scale_multiplier=0.5, octave_input_scale_multiplier=3}`.
- `moisture_nauvis` = `max(min(moisture_main, 0.45), moisture_main - 0.2*max(0, 1 - trees_forest_path_cutout*1.5))`
  - `moisture_main` = `clamp(0.4 + moisture_adjusted_bias + moisture_noise - 0.08*(nauvis_plateaus - 0.6), 0, 1)`
  - `moisture_noise` = `quick_multioctave_noise{seed1=6, octaves=4, input_scale=control:moisture:frequency/256, output_scale=0.125, offset_x=30000/control:moisture:frequency, octave_output_scale_multiplier=1.5, octave_input_scale_multiplier=1/3}`
  - `moisture_adjusted_bias` = `lerp(base_bias, starting_bias, starting_bias_region)` with `base_bias=var('control:moisture:bias')`, `starting_bias=lerp(base_bias, slider_to_linear(var('control:starting_area_moisture:size'), -0.5, 0.5), abs(2*starting_bias_change)*1.1)`, `starting_bias_region=clamp(2 - var('control:starting_area_moisture:frequency')/400*distance, 0, 1)`
  - `trees_forest_path_cutout` = `min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)` = `min((nauvis_bridge_billows-0.07)*5, (nauvis_hills-0.1)*3, (forest_path_billows-0.07)*3)`

**Key scope finding:** `trees_forest_path_cutout` is NOT tree/spot placement - it is
three `abs(multioctave_noise{...})` billow bands combined with `min()`. Two of the
three (`nauvis_hills` seed 900, `nauvis_bridge_billows` seed 700) already exist inside
`makeElevationNauvis`. Only `forest_path_billows` (seed 1800, `input_scale=nauvisSeg/100`)
is a new noise call. `nauvis_plateaus` (= `0.5 + clamp((nauvis_hills - nauvis_hills_cliff_level)*10, -0.5, 0.5)`;
`nauvis_hills_cliff_level` = `clamp(0.65 + basis_noise{seed1=99584, input_scale=nauvisSeg/500, output_scale=0.6}, 0.15, 1.15)`)
also already exists inline in `elevationNauvis.ts`. `nauvis_segmentation_multiplier = 1.5*control:water:frequency`.

Helpers: `lerp(a,b,t)=a+(b-a)*t`; `slider_to_linear(s,min,max)=min+0.5*(max-min)*(1+log2(s)/log2(6))`.

### Tile helpers

- `expression_in_range_base(aux_from, moisture_from, aux_to, moisture_to)` = `expression_in_range(20, 1, aux, moisture, aux_from, moisture_from, aux_to, moisture_to)`.
- `water_base(max_elevation, influence)` = `if(max_elevation >= elevation, influence*min(max_elevation - elevation, 1), -inf)`.
- `noise_layer_noise(seed)` = `multioctave_noise{persistence=0.7, seed1=seed, octaves=4, input_scale=1/6, output_scale=2/3}` (already-solved `multioctave_noise`).
- **`expression_in_range` is a native C++ builtin - its peak/falloff math is UNDOCUMENTED.** Signature: `expression_in_range(peak_multiplier, peak_maximum, expr_1..N, from_1..N, to_1..N)`. This is the one genuine unknown (see below).

### The 21 Nauvis tiles (palette ground truth)

`map_color` is 0-255 when any component > 1, else 0-1 (Factorio Color rule). All base
tiles here are 0-255. `probability_expression` verbatim (de-escaped):

| tile | probability_expression | map_color (0-255) |
|---|---|---|
| deepwater | `water_base(-2, 200)` | 38,64,73 |
| water | `water_base(0, 100)` | 51,83,95 |
| grass-1 | `expression_in_range_base(-10,0.7,11,11) + noise_layer_noise(19)` | 55,53,11 |
| grass-2 | `expression_in_range_base(0.45,0.45,11,0.8) + noise_layer_noise(20)` | 66,57,15 |
| grass-3 | `expression_in_range_base(-10,0.6,0.65,0.9) + noise_layer_noise(21)` | 65,52,28 |
| grass-4 | `expression_in_range_base(-10,0.5,0.55,0.7) + noise_layer_noise(22)` | 59,40,18 |
| dry-dirt | `expression_in_range_base(0.45,-10,0.55,0.35) + noise_layer_noise(13)` | 94,66,37 |
| dirt-1 | `max(expression_in_range_base(-10,0.25,0.45,0.3), expression_in_range_base(0.4,-10,0.45,0.25)) + noise_layer_noise(6)` | 141,104,60 |
| dirt-2 | `expression_in_range_base(-10,0.3,0.45,0.35) + noise_layer_noise(7)` | 136,96,59 |
| dirt-3 | `expression_in_range_base(-10,0.35,0.55,0.4) + noise_layer_noise(8)` | 133,92,53 |
| dirt-4 | `max(expression_in_range_base(0.55,-10,0.6,0.35), expression_in_range_base(0.6,0.3,11,0.35)) + noise_layer_noise(9)` | 103,72,43 |
| dirt-5 | `expression_in_range_base(-10,0.4,0.55,0.45) + noise_layer_noise(10)` | 91,63,38 |
| dirt-6 | `expression_in_range_base(-10,0.45,0.55,0.5) + noise_layer_noise(11)` | 80,55,31 |
| dirt-7 | `expression_in_range_base(-10,0.5,0.55,0.55) + noise_layer_noise(12)` | 80,54,28 |
| sand-1 | `max(expression_in_range_base(-10,-10,0.25,0.15), expression_in_range(5, inf, elevation, aux, -1.5, 0.5, 1.5, 1)) + noise_layer_noise(36)` | 138,103,58 |
| sand-2 | `max(expression_in_range_base(-10,0.15,0.3,0.2), expression_in_range_base(0.25,-10,0.3,0.15)) + noise_layer_noise(37)` | 128,93,52 |
| sand-3 | `max(expression_in_range_base(-10,0.2,0.4,0.25), expression_in_range_base(0.3,-10,0.4,0.2)) + noise_layer_noise(38)` | 115,83,47 |
| red-desert-0 | `expression_in_range_base(0.55,0.35,11,0.5) + noise_layer_noise(30)` | 103,70,32 |
| red-desert-1 | `max(expression_in_range_base(0.6,-10,0.7,0.3), expression_in_range_base(0.7,0.25,11,0.3)) + noise_layer_noise(31)` | 116,81,39 |
| red-desert-2 | `max(expression_in_range_base(0.7,-10,0.8,0.25), expression_in_range_base(0.8,0.2,11,0.25)) + noise_layer_noise(32)` | 116,84,43 |
| red-desert-3 | `expression_in_range_base(0.8,-10,11,0.2) + noise_layer_noise(33)` | 128,93,52 |

`noise_layer_noise` seeds used: 6-13, 19-22, 30-33, 36-38 (19 distinct). Water tiles
use no `noise_layer_noise`. Non-autoplaced water variants (`water-shallow`, etc.) have
no `probability_expression` and are out of scope (placed by transition logic, not argmax).

## Architecture (5 layers + render)

### Layer 1 - shared Nauvis noise internals (refactor)

Extract from `makeElevationNauvis`'s private closure into a reusable module (e.g.
`src/noise/expressions/nauvisShared.ts`): `nauvis_segmentation_multiplier`,
`nauvis_hills` (= `abs(multioctave seed 900)`), `nauvis_hills_cliff_level`,
`nauvis_plateaus`, `nauvis_bridge_billows` (= `abs(multioctave seed 700)`). Expose as
seed/seg-parameterized builders returning `(x,y)=>number`. `makeElevationNauvis` is
refactored to consume them.

**Hard invariant:** `test/elevationNauvis.spec.ts` oracle parity must stay byte-identical
(worst far-field 4.08e-3, near-spawn 1e-4 bound). This is a pure extraction with zero
numeric change; a drift is a real regression.

### Layer 2 - climate expressions

`src/noise/expressions/temperature.ts` (`makeTemperature`), `moisture.ts`
(`makeMoisture`), `aux.ts` (`makeAux`) - closures over `quick_multioctave_noise`,
the shared nauvis internals, `distance`, `lerp`/`slider_to_linear`, and control reads.
Add `forest_path_billows` (new multioctave seed 1800) to the shared module.

Control reads come from the preset's `property_expression_names` / autoplace controls:
`control:temperature:{frequency,bias}`, `control:moisture:{frequency,bias}`,
`control:aux:{frequency,bias}`, `control:starting_area_moisture:{size,frequency}`,
`control:water:frequency`. A climate-control read helper (mirroring `climateControls.ts`)
resolves these with the game's defaults when absent.

### Layer 3 - tile helpers

`src/noise/tiles/helpers.ts`: `expressionInRange` (RE'd - see below),
`expressionInRangeBase` (wrapper binding `peak_multiplier=20, peak_maximum=1, exprs=[aux,moisture]`),
`waterBase`, and `noiseLayerNoise` (a `makeMultioctaveNoise` at the tile's seed).

### Layer 4 - tile resolver + palette

`src/noise/tiles/catalog.ts`: the 21 tiles as data (name, `map_color`, and a
`probability(ctx)` closure built from the helpers). `src/noise/tiles/resolve.ts`:
`resolveTile(x,y, climate) -> tile` by argmax of `probability`. Palette = each tile's
`map_color` as an RGBA tuple.

### Layer 5 - render

New terrain render path (`renderTerrain` or a `mode` on the existing render) that, per
pixel, evaluates elevation + aux + moisture once, resolves the winning tile, and writes
its `map_color`. A "Terrain" view toggle alongside the current elevation water/land view
on the preview panel. Reuses the Web Worker + canvas plumbing.

## The one unknown: reverse-engineering `expression_in_range`

`expression_in_range(peak_multiplier, peak_maximum, expr_1..N, from_1..N, to_1..N)` is a
native builtin with no published formula. RE it via the oracle exactly as the primitives
were:

1. Route `expression_in_range(pm, pmax, <controlled expr>, from, to)` onto `elevation`
   and sample over a swept input (e.g. expr = `x/1000`) for the 1-D case: recover the
   peak shape (value inside `[from,to]`, falloff slope outside, role of `peak_multiplier`
   and `peak_maximum`).
2. Then the N-D combination (how multiple expr/range pairs combine - hypothesis: min-like
   AND across dimensions) with a 2-D sweep.
3. Port as `expressionInRange`, validate against the oracle to the noise floor.

**This is the critical-path task and is sequenced FIRST.** If the formula proves more
involved than a clamped triangular peak, that is a real finding to resolve before the
tile layer can be faithful - not a step to approximate past.

## Validation

- **Climate values:** oracle-sample `temperature`, `moisture`, `aux` at a grid for
  seed 123456 (near-origin + far rings), assert `makeTemperature/Moisture/Aux` match to
  the f32 floor (like elevation). Fixtures under `test/fixtures/`.
- **`expression_in_range`:** oracle fixture of the swept peak; parity test to the floor.
- **Tile assignment (end-to-end):** compare the client terrain render against the server
  `--generate-map-preview` for the default preset at a fixed seed. The preview-service
  already produces that reference image. Agreement bar: visually faithful, with
  per-pixel color matching away from tile-boundary jitter (the `noise_layer_noise` seams
  are where small numeric drift flips a tile - expected, matches the elevation coastline
  caveat).

## Out of scope

- Resources / ore patches (Milestone 3 - `spot_noise` is solved).
- Cliffs, enemy bases, trees/decoratives (Milestone 4).
- Non-Nauvis planets.
- Non-Nauvis elevation's effect on climate: `moisture_nauvis`/`aux_nauvis` reference
  `nauvis_plateaus` regardless of the selected map type; we render the default Nauvis
  climate. (If a Lakes/Island map's in-game climate differs, that is a follow-up.)
- The map-exchange codec and mapType model (untouched).

## Sequencing (one plan)

1. RE `expression_in_range` (+ oracle fixture + parity). De-risks everything downstream.
2. Extract shared nauvis internals (refactor; elevation parity byte-exact).
3. Climate ports: temperature, then aux, then moisture (each oracle-validated).
4. Tile helpers (`expressionInRangeBase`, `waterBase`, `noiseLayerNoise`).
5. Tile catalog + `resolveTile` (argmax) + palette.
6. Terrain render path + UI toggle + `--generate-map-preview` comparison.

## Open risks

- **`expression_in_range` shape** - the only true unknown; mitigated by sequencing it
  first. If N-D combination is not simple min, the tile faithfulness depends on getting
  it right.
- **`--generate-map-preview` color exactness** - the server may apply lighting/shading
  the raw `map_color` doesn't capture; the comparison bar is visual faithfulness, and we
  may need to compare against raw tile IDs (if the oracle can dump the placed tile) as a
  stricter check. Flagged for the plan's validation task.

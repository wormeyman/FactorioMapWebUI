# Terrain render (Milestone 2) - notes

Client-side Nauvis terrain colors: climate (temperature/moisture/aux) -> 21-tile
autoplace argmax -> `map_color`. Shipped 2026-07-19 on `feat/m2-climate-terrain`.
Design: `docs/superpowers/specs/2026-07-19-milestone2-climate-terrain-design.md`.

## Headline result

`makeTileResolver` (elevation + climate + tile catalog, argmax) matches the real
game's placed tile at **100% - 153/153 oracle points across 3 seeds** (123456,
424242, 654321), the default Nauvis preset. Ground truth captured via the new
`get_tile` oracle path (`sampleTileNames` in `test/oracle/oracle.ts`: generate
chunks per point, read `surface.get_tile(pos).name`). Validated in
`test/resolveTile.spec.ts`.

## How tiles are selected

The placed tile is the **argmax** of each tile's `probability_expression` at a point.
Tiles are a pure argmax - the prototype `order` field has no effect (unlike entities).
Drivers:

- **Water tiles** (`water`, `deepwater`) by `elevation` via `water_base`.
- **19 land tiles** by **aux + moisture** via `expression_in_range_base`, plus a
  per-tile `noise_layer_noise(N)` jitter. `sand-1` adds an `elevation`+`aux` coastal
  term.
- **Temperature drives no base tile** (ported for completeness only).

`water_base(elev,0,100)` yields up to 100 and `water_base(elev,-2,200)` up to 200,
vs land's ~1 peak - so water/deepwater precedence falls out of the argmax naturally.

## The one reverse-engineering: `expression_in_range`

A native C++ builtin with no published formula. RE'd from an oracle sweep
(`docs/noise/expression-in-range-NOTES.md`):

    result = min(peak_maximum, peak_multiplier * min_i( min(value_i - from_i, to_i - value_i) ))

Per-dimension triangular peak (signed distance to the nearer edge of `[from,to]`),
`min` across dimensions (a hard AND), scaled by `peak_multiplier`, capped at
`peak_maximum`. **No lower clamp.** `peak_maximum` may be `Infinity` (sand-1's
unbounded coastal boost). Worst residual vs the game 9.5e-7. The `min` (not product
or sum) was pinned by a diagonal sweep - the `d=525` sign flip (oracle -0.4999995 =
`min`, not product's +0.25) is decisive.

## Coastline sits at elevation ~= -0.017, not 0

Under the argmax, land tops out near `1 + noise_layer_noise` (~1.67), so
`water_base(elev,0,100) = 100*min(-elev,1)` only overtakes land once `-elev >
~0.0167`. The water/land line is therefore at `elevation ~= -0.017` and the
deepwater/water line at `~= -2.5` - a slight shift from the M1 binary mask's
threshold, faithful to the game.

## Latent bug caught: quickMultioctaveNoise octave seed

The multi-seed tile-name fixture (odd seed 654321) exposed a bug in
`quickMultioctaveNoise`'s `octaveSeed0`: the earlier "+2 per octave-pair" derivation
was numerically indistinguishable from a flat `+1 per octave` whenever the base seed
word is **even** (taus88's `s1` update masks the low bit, so
`basisNoiseTablesFromSeed(W) == basisNoiseTablesFromSeed(W+1)` for even W). Every
prior fixture used even seed 123456, hiding it. Fixed to a flat `seed0 + k`, verified
per-octave against the live game at both parities. This is why the fixture diversity
(20/21 tiles, 3 seeds) mattered - a single even-seed fixture would have shipped the
bug. See `docs/noise/quick-multioctave-noise-NOTES.md`.

## Render + performance

`renderTerrain` (`src/noise/preview/renderTerrain.ts`) sweeps the world window and
paints each pixel the winning tile's `map_color`, through the same Web Worker as the
elevation render (off the main thread). A **Terrain/Elevation toggle** on the preview
panel (Nauvis map type only - terrain uses Nauvis climate).

- **Timing** (256x256, seed 123456): ~480ms land-heavy, ~87ms all-water.
  Extrapolated 1024x1024: **~7.7s land / ~1.4s water** (in line with the elevation
  render; runs off-thread so the UI does not freeze).
- **Water early-out:** where elevation is deep enough that water/deepwater provably
  beat every land tile, skip the 19 land noise layers. Threshold chosen with an
  analytic margin: worst-case land value is `max(1, 1.25 sand-1) + 2.2012
  noise_layer_noise = 3.4512` (Cauchy-Schwarz bound on the basis corner sum), so the
  early-out fires only when the water influence exceeds **5**. Proven safe (never
  changes a pixel) and checked over 1600 mixed points.

## Climate controls

The terrain view threads the preset's `control:moisture:*` and `control:aux:*`
frequency/bias (via `readClimateControls`), so the moisture/aux ("terrain type")
sliders change the terrain. At defaults it is byte-identical to the 100%-validated
path. **Non-default climate values are faithful ports but NOT oracle-validated
point-by-point** (only the default preset has get_tile ground truth) - same caveat as
the starting-lake levers. `control:starting_area_moisture:*` and
`control:temperature:*` are not written by any current UI.

## Validation strategy (three decoupled checks)

1. **Climate values** - oracle-sample temperature/moisture/aux routed onto elevation,
   parity to the f32 floor (`test/{temperature,aux,moisture}.spec.ts`).
2. **`expression_in_range`** - oracle sweep parity (`test/expressionInRange.spec.ts`).
3. **Tile selection** - exact per-point argmax vs `get_tile().name`
   (`test/resolveTile.spec.ts`). The palette is a static `map_color` lookup.

`--generate-map-preview` is only a secondary compositing sanity check (it may apply
lighting the raw `map_color` does not); the exact correctness gate is the `get_tile`
parity above.

## Follow-ups

- Non-default climate + starting-area-moisture: capture non-default `get_tile`
  fixtures to validate slider-driven terrain against the game.
- Render-time optimization (tiling / progressive downsample) if ~7s feels slow.
- `plateaus()` recomputes `hills`/`cliffLevel` (double-eval per tile) - a
  precomputed path would speed the render.

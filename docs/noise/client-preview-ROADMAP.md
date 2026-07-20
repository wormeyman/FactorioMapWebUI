# Client-side map preview - roadmap

Forward-looking plan (not a living doc - a point-in-time record, like the specs
under `docs/superpowers/`). Written 2026-07-17, right after `basis_noise` and
`spot_noise` were fully reverse-engineered.

## Goal

Generate Factorio 2.1.11 map previews **in the browser**, from a `Preset`, with no
server round-trip - to optionally replace (or front-run) the headless
`preview-service/` container with instant, offline previews.

Correctness bar: **visually faithful**, with per-expression agreement to ~1e-6
against the game (the fastapprox noise floor - bit-exactness is the wrong goal,
see `basis-noise-NOTES.md`). A preview is downsampled (~1 px per N tiles), so
small numeric drift is invisible anyway.

Non-goal: reproducing the game's threading, chunk streaming, or entity placement.
We evaluate noise per pixel, independently.

## Where we are: the hard part is done

The two primitives the community called "black magic" are solved and verified
against the game's own machine code:

- **`basis_noise`** - `src/noise/basisNoise.ts` (`basisNoise`, and
  `basisNoiseTablesFromSeed` for the full seed -> tables derivation).
  `docs/noise/basis-noise-NOTES.md`.
- **`spot_noise`** - candidate RNG `src/noise/spotCandidates.ts`, selection
  `src/noise/spotSelection.ts`, rendering documented.
  `docs/noise/spot-noise-NOTES.md`.

What remains is **breadth, not depth**: an expression evaluator, a handful of
smaller primitives, and a large body of game *data* (the expression trees + tile
autoplace) to port - all of it validatable against the oracle, none of it
research-hard.

## The stack

```
6. Render        tile/resource -> color, downsample, compose image
5. Tile types    elevation + climate -> winning tile (autoplace "peaks")
4. Settings      control:*:frequency/size/richness/bias, property_expression_names
3. Expressions   base-game trees: elevation, temperature, moisture, aux, resources
2. Evaluator     the 14 NoiseOperations + arithmetic + built-in vars (x,y,distance,seed)
1. Primitives    basis_noise (done), spot_noise (done), + the rest below
```

## Do this first: the validation harness (M0)

Everything below is built test-first against the game, exactly as the primitives
were. Commit the harness so every later layer has ground truth.

- [x] Commit a reusable headless oracle under `test/oracle/` (currently rebuilt
      ad hoc each session): a mod that routes an arbitrary named noise expression
      onto `elevation`, reads `calculate_tile_properties({"elevation"}, positions)`
      in `on_init`, `write_file`s JSON, `error("DUMPED-OK")` to exit (~1.7 s/run).
      Recipe in `basis-noise-NOTES.md` / `noise-oracle-basis-measurements`.
      It needs a local Factorio install, so gate the tests on its presence.
- [x] A `sampleExpression(exprString, positions, {seed, ...}) -> number[]` helper
      that runs the oracle and returns game values, for use as fixtures.
- [x] Decide fixture policy: capture once, commit JSON (like the existing
      `basis-noise*.json`), run the comparison in CI without Factorio.

## Milestone 1 - MVP: elevation land/water/coast

The smallest recognizable preview. Proves the evaluator design before the big
data port.

- [x] **Evaluator core** (`src/noise/eval/`): a per-pixel evaluator. Recommended
      shape - compile each named expression to a JS closure `(ctx) => number`
      where `ctx = { x, y, seed, controls }`; the expression tree maps directly to
      nested calls. (The game compiles to a register program in `NoiseCache`; we
      do **not** need to replicate that - it is an internal batching optimization.)
- [x] **Remaining primitives needed for elevation** (RE against the oracle):
  - `MultioctaveNoise` / `VariablePersistenceMultioctaveNoise` - octave layering
    over `basis_noise`. Already partly measured (basis summed, ~RMS-normalized,
    std ratio 1.077x at octaves=4). Nail persistence/lacunarity/per-octave seed
    and input-scale exactly. `NoiseOperations::MultioctaveNoise::run` at a known
    address (see the disassembler in `scratchpad`), or infer from
    `core/prototypes/noise-programs` Lua.
  - Trivial math ops: `Const`, `Clamp`, `If`, `PowInt`, arithmetic
    (`BinaryExpression` add/sub/mul/div/min/max, `UnaryExpression`). These are
    one-liners; confirm signatures from the binary if in doubt.
  - `DistanceFromNearestPoint` (starting-area / spawn shaping) if the elevation
    tree uses it.
- [x] **The elevation expression**: Nauvis `elevation` (the default) ported
      2026-07-19 as `makeElevationNauvis` (`src/noise/expressions/elevationNauvis.ts`,
      merged f95594f) - a 1:1 hand-port of `elevation_nauvis_function` from
      `core/prototypes/noise-programs.lua`, validated against the oracle to the f32
      floor (worst far-field 4.08e-3, near-spawn 2.87e-6). KEY finding: it needs NO
      new primitive - `ridge`/`terrace` (rated "small" below) are used by NO
      elevation tree (every apparent "ridge" was the `b`ridge`` substring). The
      Island variant (`elevation_island`, a trivial `bias=-1000` lakes variant)
      shipped 2026-07-19 as `makeElevationIsland` (`src/noise/expressions/elevationIsland.ts`)
      - a thin wrapper over `makeElevationLakes` with `bias=-1000` and
      `segmentation_multiplier/4`, validated against the oracle to the f32 floor
      (worst far-field 6.66e-3, near-spawn 5.2e-7). All three base map types
      (Nauvis, Lakes, Island) now render client-side; they dispatch via a `mapType` selector.
- [x] **Render**: `elevation < 0` -> water (deep vs shallow by threshold), else
      land; draw to a `<canvas>` at a chosen scale. Coastline falls out.
- [x] **Validate**: sample the game's `elevation` at a grid for a few seeds; diff
      to ~1e-6; then eyeball the rendered coastline against a real
      `--generate-map-preview`.

Done = a recognizable land/water/coastline image from a `Preset`, matching the
game's elevation to the noise floor.

## Milestone 2 - climate terrain colors - DONE 2026-07-19

Shipped on branch `feat/m2-climate-terrain` (see
`docs/superpowers/specs/2026-07-19-milestone2-climate-terrain-design.md` and
`docs/noise/terrain-render-NOTES.md`). Client renders Nauvis terrain colors that
match the real game's tile placement at 100% (153/153 oracle points, 3 seeds).

- [x] Ported `temperature_basic`, `moisture_nauvis`, `aux_nauvis` (default Nauvis
      climate) as hand-written closures over the solved primitives, reusing the
      extracted `nauvisShared` internals (`nauvis_plateaus`/`hills`/`bridge_billows`
      + new `forest_path_billows`). Oracle-validated to the f32 floor (temperature
      worst 7.07e-5, aux 1.01e-5, moisture 2.76e-5). `temperature` is ported but
      unused by tiles. KEY: `trees_forest_path_cutout` is billow noise, not tree
      placement.
- [x] **Reverse-engineered the native `expression_in_range`** (undocumented C++
      builtin) from the oracle: `min(peak_maximum, peak_multiplier * min_i(min(v_i -
      from_i, to_i - v_i)))` - per-dim triangular peak, min across dims, no lower
      clamp, `peak_maximum` may be Infinity (sand-1). Worst residual 9.5e-7. See
      `docs/noise/expression-in-range-NOTES.md`.
- [x] **Tile-type resolution** (`src/noise/tiles/`): the 21 Nauvis tiles as a
      catalog (`catalog.ts`) built on `expression_in_range_base`/`water_base`/
      `noise_layer_noise`; `resolveTile` picks the argmax `probability_expression`
      (tiles are a pure argmax - `order` has no effect). Tile selection is driven by
      aux + moisture (land) and elevation (water); temperature is unused.
- [x] Palette: each tile's `map_color`, cross-checked byte-for-byte against
      `tiles.lua`.
- [x] **Validated tile assignment against the game** via a new `get_tile` tile-ID
      oracle path (chunk-generate + `surface.get_tile().name`, `test/oracle/oracle.ts`),
      NOT `--generate-map-preview` (which only sanity-checks compositing). The
      widened multi-seed fixture (20/21 tiles) caught a latent `quickMultioctaveNoise`
      octave-seed bug (invisible on even seeds) - fixed to a flat `seed0 + k`.
- [x] Terrain render path (`renderTerrain`, water early-out with an analytically
      proven-safe threshold) + a Terrain/Elevation view toggle (Nauvis only). The
      moisture/aux sliders drive the terrain view (non-default climate is a faithful
      port but not oracle-validated point-by-point; only the default preset is).

Done = colored terrain (grass / sand / dirt / desert variants + water), matching the
game's tile placement at the default preset.

## Milestone 3 - resources

`spot_noise` is fully solved; this is wiring, not research.

**M3a (regular whole-map patches) - DONE** (branch `feat/m3-resources`, unmerged).
Spec `docs/superpowers/specs/2026-07-19-milestone3-resources-design.md`, plan
`docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md`.

- [x] Port the per-resource autoplace expressions (iron/copper/coal/stone/
      uranium + crude-oil) from `prototypes/entity/resources.lua` +
      `resource-autoplace.lua`. `src/noise/resources/` = catalog (6 param sets),
      resourceMath (distance/amplitude local functions), regularPatches
      (`makeRegularPatches`: spot field + blob term). The `control:<resource>:*`
      levers flow in via `readResourceControls`.
- [x] Wire `selectSpots` + the max-of-cones renderer into per-pixel evaluation,
      region-cached. The one unknown (`random_penalty`'s batch composition inside
      spot-quantity selection) resolved: a batch over all skip-set accepted spots
      in acceptance order (`quantityBatch`). Oracle-validated (pure-regular fixture,
      iron+uranium, 2 seeds): abs error < 0.7 units everywhere after fixing the
      cube root to the game's fastapprox `pow` (`fastApprox.ts`, `fastCbrt`).
- [x] Overlay resource patches on the terrain image (resource `map_color`),
      order-priority winner where `probability >= 0.5` (`resolveResource` +
      `renderResources`); worker `view:"resources"`; Resources toggle on the panel.
- [x] Validated against the pure-regular `calculate_tile_properties` oracle and a
      headless full-view render (all 6 ore types as blob patches, spawn cleared).

Remaining for M3: **M3b** (starting patches + `max(starting, regular)`) and
**M3.5** (per-tile placement stipple - needs the un-RE'd entity-placement RNG).
Solid-footprint (opaque where `prob >= 0.5`) ships in M3a.

Done = ore patches overlaid, responding to the frequency/size/richness sliders.

## Milestone 4 - the long tail

- [ ] Cliffs (`cliffiness` / cliff elevation bands).
- [ ] Enemy bases (enemy autoplace - `enemy-autoplace-utils.lua`), starting-area
      clearing.
- [ ] Trees / decoratives (optional for a preview).
- [ ] Non-Nauvis planets (Space Age) if in scope - each is another expression set.

## Milestone 5 - integration

- [ ] A `previewMap(preset, {width, height, scale}) -> ImageData` entry point.
- [x] Wire into the app UI next to / instead of the `preview-service` call. Keep
      the server path as a fallback and as a cross-check oracle.
- [ ] Perf: evaluate off the main thread (Web Worker); tile the viewport; cache
      per-region spot lists and per-tile noise. Target interactive re-render on
      slider changes.

## Remaining primitives to reverse-engineer (layer 1)

The binary defines exactly **14** `NoiseOperations::*::run` types. Status:

| op | needed for | difficulty |
| --- | --- | --- |
| `BasisNoise` | everything | DONE |
| `SpotNoise` | resources/enemies | DONE (RNG+select+render) |
| `Const`, `Clamp`, `If`, `PowInt` | all trees | trivial (math) |
| `BinaryExpression`/`UnaryExpression` (arithmetic) | all trees | trivial |
| `MultioctaveNoise` | terrain | DONE (`multioctaveNoise.ts`) |
| `QuickMultioctaveNoise` | climate (temp/moisture/aux) | DONE (`quickMultioctaveNoise.ts`) |
| `VariablePersistenceMultioctaveNoise` | terrain (elevation) | DONE (`variablePersistenceMultioctaveNoise.ts`) |
| `DistanceFromNearestPoint` | spawn/starting area | DONE (`distanceFromNearestPoint.ts`) - `min(maximum_distance, nearest euclidean dist to any point)`; points int/256 fixed-point. Geometry read off disasm; needs runtime point data (see below) so validates via the elevation tree, not standalone. |
| `Terrace` | terrain banding | small - NOT used by any elevation tree (2026-07-19) |
| `Ridge` | terrain | small - NOT used by any elevation tree; every "ridge" in noise-programs.lua is the `b`ridge`` substring (2026-07-19) |
| `RandomPenalty` | jitter | small |
| `Multisampling` | AA/quality | small |
| `VoronoiNoise` | some terrains | medium (new primitive; not yet probed) |

Method for each: disassemble `NoiseOperations::<Op>::run` (the capstone
disassembler `scratchpad/re/fdis.py` seeks by symbol address from
`nm | c++filt`), and/or probe it through the oracle, then validate to ~1e-6.
None are "black magic" - the two that were are already done.

### M1 scoping note: the elevation tree depends on runtime spawn data

Traced the Nauvis `elevation` tree (`core/prototypes/noise-programs.lua`). The
default `elevation_nauvis` is large (`elevation_nauvis_function` over `nauvis_main`,
`nauvis_bridges`, `nauvis_detail`, `nauvis_macro`, `nauvis_hills_plateaus`, ...);
the `elevation_lakes` / `elevation_island` variants are smaller
(`finish_elevation{make_0_12like_lakes{...}}`). **All of them reference values that
are not pure noise:**

- `distance` - distance from the spawn point (world origin-ish).
- `starting_lake_positions` / `starting_positions` - runtime-generated spawn/lake
  points, fed to `distance_from_nearest_point`. These come from the game's
  starting-area placement, not a noise expression.
- `water_level`, `segmentation_multiplier` - map-gen settings (scalars the app's
  `Preset` already models, but the noise DSL exposes them as vars).

So an elevation render needs a decision before the evaluator work: either (a) render
**far from spawn**, where the `distance`- and `starting_*`-gated terms fade out, and
supply `water_level`/`segmentation_multiplier` from the preset - the cheapest path to
a recognizable coastline; or (b) additionally RE the spawn / starting-lake placement
to be faithful near the origin. (a) is the right MVP.

There is also an evaluator-shape fork: hand-port each named expression to a TS
closure (roadmap's stated primary strategy) vs. write a parser for the noise DSL
strings. Hand-porting is less upfront work for the MVP; a parser pays off only if
the whole tree corpus gets ported.

## Porting the expression trees (layer 3) - the biggest chunk

Two strategies; use both:

1. **Transpile the Lua** (primary). The base-game expressions live in
   `data/base/prototypes/**` and `data/core/prototypes/**` as the noise DSL (an
   expression-builder API). Re-express each named expression as a JS closure over
   the primitives. Some are generated by helper functions (autoplace utils) - port
   the helper, not each output.
2. **Capture + validate** (safety net). The game can serialize named noise
   expressions; and `calculate_tile_properties` gives exact values. Every ported
   expression is diffed against the game before it is trusted. This is what makes
   the port low-risk despite its size.

This layer is where the real effort and the ongoing maintenance sit: the trees
are large, interdependent, reference the `control:*` constants, and differ across
game versions and base-vs-Space-Age.

## Settings wiring (layer 4)

The app already models the levers in `Preset`
(`autoplaceControls`, `property_expression_names`, seed). The evaluator's `ctx`
needs to expose them as the `control:<name>:frequency|size|richness|bias`
constants and honor `property_expression_names` overrides (which can *replace* a
named expression entirely - e.g. the map-type elevation swap). `seed` = `seed0`
(random -> wire 0); each `basis_noise`/`spot_noise` call carries its own `seed1`.

## Risks and the build-vs-keep decision

- **Maintenance surface.** The expression trees track game versions and base vs
  Space Age. The `preview-service` container gets this for free by running the
  real game; a client port must be re-synced on updates.
- **You already have a working preview.** `preview-service/` (headless Factorio +
  Cloudflare) renders correct previews today. A client-side reimplementation is a
  **UX/infra optimization** (instant, offline, no cold starts), not a correctness
  need. Weigh the ongoing port cost against that benefit before committing past
  the MVP.
- **De-risking:** the MVP (M1) is cheap and proves the evaluator; stop there if
  the value/cost tradeoff does not hold up. The oracle makes every step verifiable,
  so there are no unknown cliffs left after the primitives.

## Suggested module layout

```
src/noise/
  basisNoise.ts          # done
  spotCandidates.ts      # done
  spotSelection.ts       # done
  eval/                  # M1: evaluator + primitive library + arithmetic
  expressions/           # M1+: ported base-game trees (elevation, climate, ...)
  tiles/                 # M2: tile autoplace peak resolution + palette
  preview/               # M1+: per-pixel driver, region spot cache, render to canvas
test/oracle/             # M0: committed headless harness + capture helper
```

## Immediate next action

Start **M0 + M1**: commit the oracle harness, build the evaluator core, RE
`MultioctaveNoise`, port Nauvis `elevation`, render land/water. That converts the
two solved primitives into an actual image and locks the evaluator design before
the large expression port begins.

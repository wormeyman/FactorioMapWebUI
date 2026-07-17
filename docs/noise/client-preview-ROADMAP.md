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

- [ ] Commit a reusable headless oracle under `test/oracle/` (currently rebuilt
      ad hoc each session): a mod that routes an arbitrary named noise expression
      onto `elevation`, reads `calculate_tile_properties({"elevation"}, positions)`
      in `on_init`, `write_file`s JSON, `error("DUMPED-OK")` to exit (~1.7 s/run).
      Recipe in `basis-noise-NOTES.md` / `noise-oracle-basis-measurements`.
      It needs a local Factorio install, so gate the tests on its presence.
- [ ] A `sampleExpression(exprString, positions, {seed, ...}) -> number[]` helper
      that runs the oracle and returns game values, for use as fixtures.
- [ ] Decide fixture policy: capture once, commit JSON (like the existing
      `basis-noise*.json`), run the comparison in CI without Factorio.

## Milestone 1 - MVP: elevation land/water/coast

The smallest recognizable preview. Proves the evaluator design before the big
data port.

- [ ] **Evaluator core** (`src/noise/eval/`): a per-pixel evaluator. Recommended
      shape - compile each named expression to a JS closure `(ctx) => number`
      where `ctx = { x, y, seed, controls }`; the expression tree maps directly to
      nested calls. (The game compiles to a register program in `NoiseCache`; we
      do **not** need to replicate that - it is an internal batching optimization.)
- [ ] **Remaining primitives needed for elevation** (RE against the oracle):
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
- [ ] **The elevation expression**: port Nauvis `elevation` (the default) from
      `data/base/prototypes/**/noise*.lua` + `planet/planet-map-gen.lua`. The
      Lakes / Island variants are already captured as strings
      (`elevation_lakes` / `elevation_island`, see `src/model/mapType.ts` and
      `docs/mapexchangestrings/maptype-elevation-*`).
- [ ] **Render**: `elevation < 0` -> water (deep vs shallow by threshold), else
      land; draw to a `<canvas>` at a chosen scale. Coastline falls out.
- [ ] **Validate**: sample the game's `elevation` at a grid for a few seeds; diff
      to ~1e-6; then eyeball the rendered coastline against a real
      `--generate-map-preview`.

Done = a recognizable land/water/coastline image from a `Preset`, matching the
game's elevation to the noise floor.

## Milestone 2 - climate terrain colors

- [ ] Port `temperature`, `moisture`, `aux` expressions (same method).
- [ ] **Tile-type resolution** (`src/noise/tiles/`): implement Factorio's tile
      autoplace "peaks" - each tile prototype has influence peaks over
      elevation/temperature/moisture/aux; the winner (with order/tiebreak) is the
      tile. Port the tile autoplace specs from `data/base/prototypes/tile/`.
- [ ] Palette: map each tile prototype to its `map_color`.
- [ ] Validate tile assignment against the game (a debug expression per tile
      influence, or compare rendered colors to `--generate-map-preview`).

Done = colored terrain (grass / sand / dirt / desert variants + water).

## Milestone 3 - resources

`spot_noise` is fully solved; this is wiring, not research.

- [ ] Port the per-resource autoplace expressions (iron/copper/coal/stone/
      uranium + crude-oil) from `prototypes/entity/resources.lua` +
      `autoplace-controls.lua`. They are `spot_noise` over density/richness with
      the `control:<resource>:frequency/size/richness` levers the app already
      round-trips.
- [ ] Wire `selectSpots` + the documented max-of-cones renderer
      (`spot-noise-NOTES.md` "Field rendering") into per-pixel evaluation. Note the
      region cache: spots are per `region_size` region; compute a region's spot
      list once, reuse for all pixels in it.
- [ ] Overlay resource patches on the terrain image (resource `map_color`).
- [ ] Validate patch positions/extents against `calculate_tile_properties` for the
      resource autoplace property, and against a real preview.

Done = ore patches overlaid, responding to the frequency/size/richness sliders.

## Milestone 4 - the long tail

- [ ] Cliffs (`cliffiness` / cliff elevation bands).
- [ ] Enemy bases (enemy autoplace - `enemy-autoplace-utils.lua`), starting-area
      clearing.
- [ ] Trees / decoratives (optional for a preview).
- [ ] Non-Nauvis planets (Space Age) if in scope - each is another expression set.

## Milestone 5 - integration

- [ ] A `previewMap(preset, {width, height, scale}) -> ImageData` entry point.
- [ ] Wire into the app UI next to / instead of the `preview-service` call. Keep
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
| `MultioctaveNoise` | terrain | small (basis layering; partly measured) |
| `VariablePersistenceMultioctaveNoise` | terrain | small (variant of above) |
| `DistanceFromNearestPoint` | spawn/starting area | small |
| `Terrace` | terrain banding | small |
| `Ridge` | terrain | small |
| `RandomPenalty` | jitter | small |
| `Multisampling` | AA/quality | small |
| `VoronoiNoise` | some terrains | medium (new primitive; not yet probed) |

Method for each: disassemble `NoiseOperations::<Op>::run` (the capstone
disassembler `scratchpad/re/fdis.py` seeks by symbol address from
`nm | c++filt`), and/or probe it through the oracle, then validate to ~1e-6.
None are "black magic" - the two that were are already done.

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

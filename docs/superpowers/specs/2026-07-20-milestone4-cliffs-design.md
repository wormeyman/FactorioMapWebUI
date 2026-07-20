# Milestone 4 - cliffs (design)

Point-in-time design record (like the other files under `docs/superpowers/specs/`),
written 2026-07-20. Companion to the M4 enemy-bases design
(`2026-07-20-milestone4-enemy-bases-design.md`), whose overlay pipeline this
reuses. This is the second (and final planned) Milestone 4 "long tail" item.

## Goal

Add a client-side **cliffs overlay** to the map preview: the cliff `map_color`
painted over the Nauvis terrain render wherever the game would place a cliff wall,
responding to the `nauvis_cliff` control (Frequency/Continuity) and the map's
`cliff_settings` (elevation_0, interval, smoothing), with cliffs excluded from
water. Cliffs unblock a deferred M3 follow-up (excluding ore from cliff pixels),
which is itself out of scope here (see Deferred).

**Correctness bar (same as M1-M3):** the two ported cliff noise *fields*
(`cliff_elevation_nauvis`, `cliffiness_nauvis`) agree with the game's
`calculate_tile_properties` to the fastapprox noise floor
(`|port-game| < max(1.0, 1e-2*|game|)`). The cliff *placement* is the verified
geometric rule (`crossesCliff` + the 4-tile grid): cliff positions are
lattice-exact, and the placed-cell set matches the game's real cliff entities
**tile-for-tile at ~90%**, with the residual fully attributed to the deferred
`fixImpossibleCells` continuity-repair post-pass and water-collision rejection
(see Placement + Deferred).

## Tractability: mostly reuse, one refactor, one verified RE

Cliffs reuse primitives and expressions already implemented and oracle-validated:

- `nauvis_hills`, `nauvis_hills_cliff_level`, `forest_path_billows`,
  `nauvis_bridge_billows` (all in `src/noise/expressions/nauvisShared.ts`).
- `basis_noise` (`basisNoise.ts`), `multioctave_noise` (`multioctaveNoise.ts`),
  `distance` (`distanceFromNearestPoint.ts`), arithmetic/`clamp`/`min`/`max`/`log2`.
- The full `elevation_nauvis` tree (`makeElevationNauvis`) - reused via a small
  refactor for the `no_cliff` variant (below).

No new noise primitive is needed. In particular **`VoronoiNoise` is NOT needed**
(a `grep -rin voronoi` over `factorio-data` 2.1.11 finds it only on Space-Age
planets; no Nauvis cliff expression or transitive helper uses it). It stays
un-ported.

The one genuinely un-RE'd piece - the C++ cliff-placement rule - was reverse
engineered and validated in a spike (2026-07-20; see the RE writeup in
`docs/noise/cliffs-NOTES.md`). It is confirmed exact on the 4-tile lattice; the
only residual is a secondary post-pass we deliberately defer.

## The two field ports (1:1 from `core/prototypes/noise-programs.lua` @ 2.1.11)

Source: `~/GitHub/factorio-data` (tag `2.1.11`), `core/prototypes/noise-programs.lua`.
Both are named expressions, so both are directly `sampleExpression`-able and
oracle-validated point-by-point (the primary assertion).

### `cliff_elevation_nauvis`

```
cliff_elevation_nauvis = 10 + 30 * (nauvis_hills - nauvis_hills_cliff_level)
```

A smooth height field. `nauvis_hills` and `nauvis_hills_cliff_level` are already
ported (`nauvisShared.hills` / `nauvisShared.cliffLevel`); this is a two-line
combination.

### `cliffiness_nauvis`

```
cliffiness_nauvis = (main_cliffiness >= cliff_cutoff) * 10        -- a 0-or-10 gate

main_cliffiness = min( base_cliffiness,
                       forest_path_cliffiness,
                       bridge_path_cliffiness,
                       elevation_cliffiness,
                       starting_area_cliffiness,
                       4 * low_frequency_cliffiness )

base_cliffiness          = (nauvis_cliff_ringbreak - 0.01) * 60
forest_path_cliffiness   = (forest_path_billows   - 0.03) * 12    -- forestPathBillows [ported]
bridge_path_cliffiness   = (nauvis_bridge_billows  - 0.05) * 15   -- bridgeBillows [ported]
elevation_cliffiness     = (elevation_nauvis_no_cliff - 4) / 2
starting_area_cliffiness = -2 + distance * segmentation_multiplier / 120   -- plain seg
low_frequency_cliffiness = 1.5
                         + basis_noise{ seed0=map_seed, seed1=86883,
                                        input_scale=nauvis_segmentation_multiplier/500,
                                        output_scale=0.51 }
                         + min( slider_to_linear(cliff_frequency, -1.7, 1.7),
                                slider_to_linear(cliff_richness,   -1,   1) )

cliff_cutoff   = 2 * cliff_gap_size ^ 1.5
cliff_gap_size = 0.5 - 0.5 * slider_to_linear(cliff_richness, -1, 1)
cliff_frequency = 40 / cliff_elevation_interval           -- (effective interval; see Levers)

slider_to_linear(v, lo, hi) = lo + 0.5*(hi-lo)*(1 + log2(v)/log2(6))
```

The pieces needing new code (all validated end-to-end by the `cliffiness_nauvis`
oracle fixture):

1. **`elevation_nauvis_no_cliff`** = `elevation_nauvis_function(0)` - the elevation
   tree with `added_cliff_elevation = 0`. The app currently bakes
   `added_cliff_elevation = 0.1*nauvis_hills + 0.8*nauvis_plateaus` into
   `makeElevationNauvis`. **Refactor:** extract an
   `elevation_nauvis_function(addedCliffElevation)` so `elevation_nauvis` (the
   existing behavior) and `elevation_nauvis_no_cliff` (pass 0) share code. This
   must keep the existing `makeElevationNauvis` byte-identical to today (its
   oracle fixtures still pass).
2. **`nauvis_cliff_ringbreak = abs(nauvis_hills - nauvis_hills_offset)`**, where
   `nauvis_hills_offset` domain-warps `nauvis_hills` by
   `(x,y) -> (x + 12*nx, y + 12*ny)` with `nx,ny` = normalized offset vectors from
   `basis_noise` calls seeded with the **string seeds** `'nauvis_offset_x'` /
   `'nauvis_offset_y'` (`normalize(a,b,bias) = a/sqrt(bias+a^2+b^2)`, bias 0.001).
   The string-seed `seed1` values are resolved as a bounded de-risk task (below).
3. **`low_frequency_cliffiness`'s `basis_noise` (seed 86883)** + the
   `slider_to_linear` helper.
4. **`starting_area_cliffiness`** (trivial arithmetic; note it uses the plain
   `segmentation_multiplier`, not `nauvis_segmentation_multiplier`).

## Placement (verified geometric rule, `docs/noise/cliffs-NOTES.md`)

The cliff-wall placement was disassembled and validated against a real
`find_entities_filtered{type="cliff"}` dump (2026-07-20). It is a per-cell rule on
a fixed lattice; **no per-chunk RNG** is involved (unlike the deferred M3.5
resource stipple), so it is deterministic and directly portable.

### The lattice (confirmed 100% exact)

A 32-tile chunk is `8x8` cells of `4x4` tiles (`grid_size = {4,4}`). Cliff entities
sit at **cell centers**:

```
cliff.x = cx*4 + 2      -> x  ≡ 2   (mod 4)
cliff.y = cy*4 + 2.5    -> y  ≡ 2.5 (mod 4)     (grid_offset = {0, 0.5})
```

Both fields are sampled at the **cell corners** `(i*4 + 0, j*4 + 0.5)` (a `9x9`
corner lattice per chunk). Every dumped cliff across two seeds matched this lattice
exactly.

### The crossing rule (`crossesCliff`, disasm-confirmed)

```
crossesCliff(a, b, cliffinessAvg, elevation_0, interval):   -- a,b = cliff_elevation at two corners
   if a < 0 or b < 0: return 0
   boundary = elevation_0 + interval * floor((max(a,b) - elevation_0) / interval)  -- floor toward -inf
   if boundary < elevation_0: return 0
   dA = a - boundary;  dB = b - boundary
   if cliffinessAvg > 0.5:                       -- gate is > 0.5, and cliffinessAvg is an AVERAGE
      if dA < 0 and dB > 0: return +1
      if dA > 0 and dB < 0: return -1
   return 0
```

`cliffinessAvg = (cliffiness[cornerA] + cliffiness[cornerB]) * 0.5`. Since
`cliffiness_nauvis in {0, 10}`, `avg > 0.5` means "at least one of the two corners
is cliffy". The result is a **signed** crossing (+1/-1/0; encode -1 as 3 for the
orientation code).

### Cell -> cliff (orientation code)

For cell `(cx,cy)` with corner grid indexed `[i][j]`:

```
L = crossesCliff(elev[cx  ][cy], elev[cx  ][cy+1], avg(cliff[cx  ][cy], cliff[cx  ][cy+1]), 10, interval)
R = crossesCliff(elev[cx+1][cy], elev[cx+1][cy+1], avg(cliff[cx+1][cy], cliff[cx+1][cy+1]), 10, interval)
T = crossesCliff(elev[cx  ][cy], elev[cx+1][cy  ], avg(cliff[cx  ][cy], cliff[cx+1][cy  ]), 10, interval)
B = crossesCliff(elev[cx  ][cy+1], elev[cx+1][cy+1], avg(cliff[cx  ][cy+1], cliff[cx+1][cy+1]), 10, interval)
code = (enc(L)<<6) | (enc(R)<<4) | (enc(T)<<2) | enc(B)          -- enc: 0->0, +1->1, -1->3
orientation = toMaybeCliffOrientation(code)                      -- 256-entry table, extracted from the binary
if orientation != none: place a cliff at (cx*4+2, cy*4+2.5)
```

For the render we only need the boolean `orientation != none` (which cells get a
cliff), not the specific sprite orientation. We extract the 256-entry table (or,
equivalently, its `code -> none/not-none` predicate) from the binary so cell
cliff-vs-none is faithful rather than approximated by `code != 0`.

## Render semantics

`renderCliffs(base, opts)` composites onto a terrain `ImageData`, mutating in
place, mirroring `renderResources`/`renderEnemies` in wiring but **enumerating
discrete cliff cells** rather than point-sampling a field per pixel (cliffs are a
4-tile lattice, so per-pixel sampling would alias the thin walls and waste work):

- Compute the visible world region from `origin*`, `width/height`, `tilesPerPixel`.
- Enumerate the cliff cells whose centers fall in that region (build the corner
  lattice once, run the placement rule), collect placed cliff cell centers.
- For each placed cliff, map its center world tile to the output pixel and paint
  the cliff `map_color` opaque, **unless** that pixel was drawn as water
  (reuse `renderResources`'s exact `WATER_TILE_COLORS` decision - the cheap,
  faithful-enough approximation of the game's `wouldCollide` water rejection, and
  the same mechanism the deferred ore-on-cliff exclusion will later use).
- **Color:** the base cliff entity's `map_color = {r=144, g=119, b=87}`
  (`scaled_cliff(... map_color={144,119,87} ...)` in
  `base/prototypes/entity/entity-util.lua`) -> RGB `(144, 119, 87)`.

At `tilesPerPixel >= 4` each pixel covers >= 1 cell; at finer scales cliffs draw
as ~1-px marks on the 4-tile lattice. Because we draw placed cells (not sample a
field), there is no aliasing dropout.

## Levers, scalars, inputs

- **`nauvis_cliff` control** (`Preset.autoplaceControls["nauvis_cliff"]`, edited on
  the Terrain tab): the app's Frequency column is the `frequency` slot, the
  Continuity column is the `size` slot (cliff terrain controls have no richness
  column). Verified mapping:
  - `interval = cliffSettings.cliffElevationInterval / control.frequency`
    (`getModifiedElevationInterval = elevation_interval / frequency`); default
    `40 / 1 = 40`.
  - `cliff_richness = cliffSettings.richness * control.size`
    (`getModifiedRichness = richness_field * size_field`); default `1 * 1 = 1`.
  - **Continuity (`size`) = 0 disables all cliffs** (the whole pass is gated on the
    size field being non-zero).
- **`cliffSettings`** (`Preset.cliffSettings`, a read-only derived view of the
  map-exchange tail): `cliffElevation0` (10), `cliffElevationInterval` (40),
  `cliffSmoothing` (0), `richness` (1). Threaded into the render ctx alongside the
  control.
- **`distance`** - Euclidean distance to `startingPositions` (already threaded
  through the resource/enemy renders; default single origin spawn).
- **`segmentation_multiplier` / `nauvis_segmentation_multiplier`** - already modeled
  (`control:water:frequency`, and `1.5 *` that); reused from `nauvisShared`.
- **`cliff_smoothing`** - 0 on Nauvis; confirmed a no-op in the default placement
  path (the only post-pass is `fixImpossibleCells`, which is smoothing-independent
  and deferred).

## Module layout

```
src/noise/cliffs/
  cliffCatalog.ts    # constants: CLIFF_CONTROL_NAME "nauvis_cliff", grid (GRID_SIZE 4,
                     #   GRID_OFFSET_Y 0.5, cell center +2/+2.5), CLIFF_ELEVATION_0 defaults,
                     #   CLIFF_MAP_COLOR [144,119,87]; slider_to_linear; getModifiedElevationInterval
                     #   / getModifiedRichness; CliffControls / CliffSettings types; the extracted
                     #   toMaybeCliffOrientation code->placed predicate.
  cliffFields.ts     # makeCliffFields(ctx) -> { cliffElevation(x,y), cliffiness(x,y) }
                     #   ports cliff_elevation_nauvis + cliffiness_nauvis (reusing nauvisShared,
                     #   the no_cliff elevation variant, basis_noise, the offset/ringbreak chain).
  cliffPlacement.ts  # crossesCliff + cell/grid enumeration over a world region
                     #   -> placed cliff cell centers (using cliffFields + the code predicate).
src/noise/preview/
  renderCliffs.ts    # enumerate placed cells over the region, paint CLIFF_MAP_COLOR, skip water.
```

Refactor: `elevationNauvis.ts` gains an internal `elevation_nauvis_function(addedCliffElevation)`
seam so `cliffFields` can build `elevation_nauvis_no_cliff` (added=0) without
changing `makeElevationNauvis`'s existing output. `elevationRenderRequest.ts` gains
a `view: "cliffs"` case (renderTerrain base -> renderCliffs) plus `cliffControls` /
`cliffSettings` fields. `elevationPreviewCtx.ts` exposes them from the preset.
`ElevationPreviewPanel.vue` gains a "Cliffs" toolbar button gated on
`terrainAvailable` (Nauvis), alongside Elevation/Terrain/Resources/Enemies.

## Validation (oracle-first, mirrors M3/M4)

1. **Field ports (primary, asserted).** Capture `cliff_elevation_nauvis` and
   `cliffiness_nauvis` via `sampleExpression` at a grid for 2 seeds; commit the JSON
   fixtures; assert `|port-game| < max(1.0, 1e-2*|game|)`. This is what actually
   validates the string-seed hash, the `no_cliff` refactor, and all six
   `main_cliffiness` terms - end to end, in one comparison. `cliffiness_nauvis` is
   `0` or `10`, so its fixture also doubles as an exact gate check (port and game
   agree on cliffy-vs-not at every point).
2. **Placement (asserted as a drift guard).** New `find_entities{type="cliff"}`
   oracle capture path (model on the `get_tile` chunk-forced path,
   `captureTileNamesForSeed`): generate real chunks at the default preset for a
   region, dump cliff positions. Assert the ported placement reproduces the lattice
   exactly and the placed-cell set to the documented **~90%** (residual =
   `fixImpossibleCells` + water). This guards against regressions in the rule; it is
   NOT a "make it 100%" gate (that needs the deferred post-pass).
3. **Headless PNG eyeball.** Full-view render vs a real
   `factorio --generate-map-preview` of the same seed: cliffs trace plateau edges,
   cluster into rings, respond to the Frequency/Continuity sliders, and Continuity=0
   clears them.

## Bounded de-risk tasks (folded into the plan, not open research)

- **String-seed `seed1` for the offset chain.** `nauvis_hills_offset_raw_x/y` use
  string seeds `'nauvis_offset_x'`/`'nauvis_offset_y'`; `basisNoiseTablesFromSeed`
  needs numeric `seed1`. Resolve by oracle-matching the (named, sampleable)
  `nauvis_hills_offset_raw_x` expression - a single u32 to pin, oracle-verifiable.
  If it does not fall out quickly, fall back to disassembling the noise-program
  string-seed hash. Bounded either way.
- **Extract the 256-entry `toMaybeCliffOrientation` table** (or its not-none
  predicate) from the binary at the address in `cliffs-NOTES.md`. Mechanical disasm
  dump; needed so cell cliff-vs-none is faithful.

## Testing

Unit tests per module, mirroring `regularPatches.spec.ts` / `enemyBaseField.spec.ts`
/ `renderEnemies.spec.ts`:

- `cliffCatalog.spec.ts` - `slider_to_linear`, `getModified*`, grid constants, the
  orientation predicate, `CLIFF_MAP_COLOR` drift guard.
- `cliffFields.spec.ts` - `cliff_elevation_nauvis` and `cliffiness_nauvis` vs the
  committed oracle fixtures (abs/rel tolerance + exact gate agreement for cliffiness).
- `cliffPlacement.spec.ts` - lattice-exactness and the ~90% agreement vs the
  `find_entities` fixture; Continuity=0 clears all cliffs.
- `renderCliffs.spec.ts` - a placed-cell pixel is painted the cliff color; water
  pixels are never painted; `CLIFF_MAP_COLOR` / `WATER_TILE_COLORS` drift guards.
- Extend `elevationRenderRequest.spec.ts` / `elevationPreviewCtx.spec.ts` for the
  `cliffs` view + lever plumbing.

## Out of scope / deferred

- **`fixImpossibleCells`** - the per-chunk border-edge clearing + impossible-config
  continuity-repair post-pass that accounts for the ~10% placement residual. A
  substantial additional RE pass (a bitmask/neighbor-propagation cell rewrite);
  deferred (Eric, 2026-07-20) in favor of the exact geometric rule, matching how
  M3.5 stipple and M4 worms were deferred. Documented in `cliffs-NOTES.md`.
- **Exact `wouldCollide`** - the precise collision-box-vs-tile water/entity rejection.
  Approximated by the existing water-pixel exclusion; the exact box test is deferred.
- **Ore-on-cliff exclusion** - the deferred M3a follow-up that cliffs unblock
  (exclude ore off cliff pixels like it is excluded off water). Deferred to a
  separate follow-up (Eric, 2026-07-20) to keep this milestone scoped to the cliff
  overlay.
- **Cliff sprite orientation** - we render a colored footprint at cell centers, not
  oriented cliff sprites; the specific `CliffOrientation` per cell is not needed for
  the preview (only cliff-vs-none is).
- **Non-default `starting_area`, non-Nauvis planets (Gleba/Fulgora/Vulcanus cliffs),
  the `cliffiness_basic` variant** - the render is Nauvis + default-`starting_area`
  faithful; other cases are a faithful port but not oracle-validated point-by-point
  (same posture as the non-default climate render in M2). Space-Age planet cliffs
  would each be another expression set (and Aquilo/Vulcanus/Fulgora do use
  `VoronoiNoise`, which stays un-ported until then).
- **Combining cliffs with the resource/enemy overlays in one view** - each `view` is
  a single layer (matches current Elevation/Terrain/Resources/Enemies UX). YAGNI.

# Nauvis trees on the client-side preview - design

Point-in-time design record (2026-07-21), not a living doc. Companion to
`docs/noise/client-preview-ROADMAP.md` (M4 "long tail") and
`docs/noise/placement-roll-NOTES.md`.

## Goal

Render Nauvis forests in the client-side preview, so the preview reads green like
the real game preview instead of showing bare terrain. Trees are the largest
remaining visual fidelity gap between this app's preview and
`factorio --generate-map-preview`.

## What the game actually does (reverse-engineered 2026-07-21)

Before designing anything, the map preview's own render path was disassembled from
the shipped (non-stripped) 2.1.11 binary. The finding materially shapes the scope,
so it is recorded here rather than only in a notes file.

`MapPreviewGenerator::Worker::computeEntities(MapPreviewChunk&)` @ `0x1016613b4`
constructs a real `EntityMapGenerationTask` on the stack (vtable stored at `+68`)
and then:

```
+172:  bl  0x101622860   ; EntityMapGenerationTask::computeInternal()  (EntityMapGenerationTask.cpp:129)
+184:  bl  0x10166191c   ; MapPreviewGenerator::Worker::chartCliffs()  (MapPreviewGenerator.cpp:239)
+196:  bl  0x101661ac0   ; MapPreviewGenerator::Worker::chartEntities() (MapPreviewGenerator.cpp:258)
```

`chartEntities` @ `0x101661ac0` walks the placed entities, builds a `BoundingBox`
per entity, **skips any box that collides with an already-drawn one**
(`BoundingBox.cpp:624`), and calls `Chart::drawEntity()` (`Chart.cpp:284`) - the
same charting path the in-game minimap uses. A tree therefore charts at the tree
chart color `default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}`
(`core/prototypes/utility-constants.lua:201`); the 40% alpha is the game blending
each placed tree over the terrain beneath it.

Two consequences:

1. **The preview places real entities.** There is no probability-shading shortcut
   path in the binary. Reproducing the game pixel-for-pixel therefore requires the
   per-tile placement roll - i.e. M3.5, deferred 2026-07-20 - and the *harder*
   version of it, because the shared per-chunk taus88 stream is consumed by every
   Nauvis autoplacer, not just resources:

   | source | `autoplace =` entries | port status |
   | --- | --- | --- |
   | `base/prototypes/entity/trees.lua` | 21 | not ported (this spec) |
   | `base/prototypes/entity/resources.lua` | 3 (-> 6 patches) | done (M3a/M3b) |
   | `base/prototypes/entity/turrets.lua` (worms) | 4 | not ported |
   | `base/prototypes/entity/enemies.lua` (spawners) | 2 | done (M4) |
   | `base/prototypes/entity/entities.lua` (fish) | 1 | trivial, not ported |

2. **Decoratives are out of scope for free.** No `DecorativeMapGenerationTask`
   symbol exists in the binary, and the preview worker calls only `chartCliffs` +
   `chartEntities`. The game's own preview shows no decoratives, so neither should
   ours. The dead/dry-tree expressions in `trees.lua` (`tree_dry_hairy`,
   `tree_dead_dry_hairy`, `tree_dead_grey_trunk`, `tree_dry`, `tree_dead_desert`)
   feed decorative prototypes and are explicitly **not** ported here.

### Sequencing decision (Eric, 2026-07-21)

Ship the **probability fields first** with a density-shaded render; treat faithful
stipple as a separate later project. The 15 probability fields are required either
way - stipple or shading - so nothing is wasted, and Phase 2 swaps only the render
step. Phase 2 (a revived M3.5) would upgrade trees, resources and enemy bases from
footprint/shading to faithful stipple in one go, and is out of scope for this spec.

## Scope

**In scope:**

- The 15 Nauvis tree species probability expressions (`tree_01` ... `tree_09_red`).
- One composed per-pixel tree density field.
- An alpha-blended green overlay, its own `view: "trees"`, and inclusion in
  `view: "all"`.
- `control:trees` frequency/size wiring.
- Oracle validation of every species.

**Out of scope:** per-tile placement stipple (Phase 2), decoratives, worms/fish
autoplacers, non-Nauvis planets, tree richness (`clamp(random_penalty_at(6,1),0,1)`
- richness has no bearing on whether or where a tree appears, so it does not affect
the render).

## The expressions

All 15 species share **exactly one shape**. This was verified mechanically: after
filtering out the common terms from every `tree_0*` noise-expression block in
`trees.lua`, nothing remained. There are no per-species special cases.

```
min(CAP,
    trees_forest_path_cutout_faded,
    min(0, asymmetric_ramps{input=temperature, ...},
           asymmetric_ramps{input=moisture, ...})
    + min(0, distance/20 - 3)
    - 0.5 + 0.2 * control:trees:size
    + tree_small_noise * 0.1
    + multioctave_noise{x, y, persistence = 0.65, octaves = 3,
                        seed0 = map_seed, seed1 = '<species>',
                        input_scale = (1/IS) * control:trees:frequency,
                        output_scale = OS})
```

A species is fully described by a parameter row. Extracted from
`~/GitHub/factorio-data` @ tag 2.1.11:

| species | cap | temperature ramp (fb,ft,tt,tb) | moisture ramp (fb,ft,tt,tb) | 1/IS | OS | seed1 |
| --- | --- | --- | --- | --- | --- | --- |
| `tree_01` | 0.45 | 0, 10, 14, 15 | 0.6, 0.7, 1, 2 | 25 | 0.8 | `tree-01` |
| `tree_02` | 0.4 | 0, 10, 14, 15 | 0.4, 0.5, 0.7, 0.8 | 25 | 0.75 | `tree-02` |
| `tree_02_red` | 0.3 | 0, 10, 14, 15 | 0.2, 0.3, 0.5, 0.6 | 25 | 0.7 | `tree-02-red` |
| `tree_03` | 0.4 | 15, 16, 35, 45 | 0.4, 0.5, 0.7, 0.8 | 35 | 0.75 | `tree-03` |
| `tree_04` | 0.45 | 13, 14, 16, 17 | 0.7, 0.9, 1, 2 | 30 | 0.8 | `tree-04` |
| `tree_05` | 0.45 | 15, 16, 35, 45 | 0.6, 0.7, 1, 2 | 40 | 0.8 | `tree-05` |
| `tree_06` | 0.2 | 0, 10, 14, 15 | 0.1, 0.2, 0.3, 0.4 | 22 | 0.6 | `tree-06` |
| `tree_06_brown` | 0.1 | 0, 10, 14, 15 | 0, 0.1, 0.2, 0.3 | 22 | 0.5 | `tree-06-brown` |
| `tree_07` | 0.4 | 13, 14, 16, 17 | 0.5, 0.6, 0.9, 1 | 40 | 0.75 | `tree-07` |
| `tree_08` | 0.3 | 13, 14, 16, 17 | 0.3, 0.4, 0.6, 0.7 | 30 | 0.7 | `tree-08` |
| `tree_08_brown` | 0.2 | 13, 14, 16, 17 | 0.2, 0.3, 0.4, 0.5 | 30 | 0.6 | `tree-08-brown` |
| `tree_08_red` | 0.1 | 13, 14, 16, 17 | 0.1, 0.2, 0.3, 0.4 | 30 | 0.5 | `tree-08-red` |
| `tree_09` | 0.3 | 15, 16, 35, 45 | 0.2, 0.3, 0.5, 0.6 | 25 | 0.7 | `tree-09` |
| `tree_09_brown` | 0.2 | 15, 16, 35, 45 | 0.1, 0.2, 0.3, 0.4 | 25 | 0.6 | `tree-09-brown` |
| `tree_09_red` | 0.1 | 15, 16, 35, 45 | 0, 0.1, 0.2, 0.3 | 25 | 0.5 | `tree-09-red` |

These are the authoritative values; the implementation must not re-derive them by
hand.

### Dependencies - all already ported or trivial

| dependency | status |
| --- | --- |
| `multioctave_noise` | done - `src/noise/multioctaveNoise.ts` |
| `temperature` | done - `src/noise/expressions/temperature.ts`. Ported and oracle-validated in M2 but **never evaluated by anything** until now; tiles turned out to be aux+moisture only. This is its first consumer. |
| `moisture` | done - `src/noise/expressions/moisture.ts` |
| `distance` | done - `distanceFromNearestPoint(x, y, startingPositions)` |
| string `seed1` | done - Factorio crc32s the string; documented at `src/noise/expressions/nauvisShared.ts:9`, and `crc32` already exists in the codec |
| `forest_path_billows`, `nauvis_hills`, `nauvis_bridge_billows` | done - `src/noise/expressions/nauvisShared.ts` |
| `asymmetric_ramps` | **new**, a one-liner (see below) |
| `tree_small_noise`, `trees_forest_path_cutout{,_faded}` | **new**, thin compositions of the above |

`asymmetric_ramps` (`core/prototypes/noise-functions.lua:123`):

```
min((input - from_top) / (from_top - from_bottom),
    (to_top - input) / (to_bottom - to_top))
```

Note it has no built-in clamp; it is designed to be used inside a shared `min()`,
which is exactly how the tree expressions use it.

The new shared fields (`core/prototypes/noise-programs.lua:427-446`):

```
tree_small_noise               = multioctave_noise{persistence 0.75, octaves 3,
                                                   seed1 'tree-small',
                                                   input_scale 0.2, output_scale 0.5}
forest_paths                   = (forest_path_billows - 0.07) * 3
nauvis_hills_paths             = (nauvis_hills - 0.1) * 3
nauvis_bridge_paths            = (nauvis_bridge_billows - 0.07) * 5
trees_forest_path_cutout       = min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)
trees_forest_path_cutout_faded = trees_forest_path_cutout * 0.3 + tree_small_noise * 0.1
```

`tree_small_noise` uses `input_scale = 0.2` flat - it is **not** scaled by
`control:trees:frequency`, unlike each species' own noise term.

## Architecture

Mirrors `src/noise/resources/` - a catalog of parameter rows plus one builder -
because the uniform expression shape makes per-species code unnecessary.

| module | responsibility |
| --- | --- |
| `src/noise/trees/asymmetricRamps.ts` | the `asymmetric_ramps` helper |
| `src/noise/trees/treeCatalog.ts` | the 15 parameter rows above, as data |
| `src/noise/trees/treeShared.ts` | `tree_small_noise` and the cutout chain, built over `nauvisShared` |
| `src/noise/trees/treeField.ts` | `makeTreeDensity(params) -> (x, y) => number` |
| `src/noise/preview/renderTrees.ts` | `renderTrees(base, opts): void`, mirroring `renderResources` |

`makeTreeDensity` takes the same shape of params the other field builders take
(`seed0`, `startingPositions`, climate control values, `control:trees`
frequency/size, `segmentationMultiplier`), builds the 15 species closures once,
and returns a per-pixel closure.

### Why the composition is `max`, and why that is exact

`makeTreeDensity` returns `clamp(max_i p_i, 0, 1)`.

This is not an approximation of "tree density". Per
`docs/noise/placement-roll-NOTES.md`, the game's `generateEntities` runs a per-tile
arbitration (`+456..+844`) that picks a **single winning entity by max
probability**, then rolls **once** against that winner's probability. So
`max_i p_i` is literally the probability the game rolls against on a tile where a
tree wins arbitration. The density-shaded render is therefore the exact expected
value of what the game draws, and Phase 2 can consume the identical field.

Caveat recorded for honesty: on tiles where a resource or spawner out-competes
every tree, the game would place that instead, so our tree layer slightly
over-covers those tiles. Resource and enemy footprints paint *over* trees in the
composite (see render order below), so the visible result is unaffected.

### Per-pixel early-out

Each species is `min(cap, cutoutFaded, sharedTerms + speciesNoise)`. The shared
terms (`cutout_faded`, both climate ramps, the distance term, the size term) are
computed once per pixel and bound every species from above. The 3-octave noise is
evaluated only when it could still change the running maximum:

```
cheap = min(cap, cutoutFaded, rampTerm + distTerm + sizeTerm)
if (cheap + MAX_NOISE[i] <= best) continue    // skip the 3-octave evaluation
value = min(cap, cutoutFaded, rampTerm + distTerm + sizeTerm + noise_i(x, y))
best  = max(best, value)
```

where `MAX_NOISE[i] = outputScale_i * norm(0.65, 3) * (sum of octave amplitudes)
* BASIS_ABS_MAX`.

`BASIS_ABS_MAX` is not currently documented in `src/noise/basisNoise.ts`. It is to
be established as a **measured maximum plus a safety margin**, and its correctness
is enforced by test rather than by argument: a spec asserts the early-out path is
bit-identical to full evaluation across multiple seeds and world regions. A wrong
bound fails that test loudly instead of silently clipping forests.

Ordering the catalog so high-cap species evaluate first raises `best` sooner and
skips more work. This is a pure optimization and must not change results - the
same equality test covers it.

## Render

```
density = clamp(max_i p_i, 0, 1)
alpha   = 0.40 * density                     // 0.40 from default_color_by_type["tree"]
px      = px * (1 - alpha) + [48, 99, 48] * alpha
```

`[48, 99, 48]` is `{0.19, 0.39, 0.19}` in 8-bit. Both the color and the alpha come
from the game's own constants, not from taste.

- **Water exclusion:** trees do not place on water. `renderTrees` skips any pixel
  the terrain drew as water/deepwater, reusing `renderTerrain`'s exact water
  decision the same way `renderResources` does, so the forest edge lines up with
  the drawn coastline rather than with a re-derived one.
- **Cliff exclusion:** not wired, consistent with the existing deferred ore-on-cliffs
  follow-up. Recorded, not built.
- **Composite order in `view: "all"`:** terrain, then **trees**, then resources,
  enemies, cliffs. Trees are a broad background wash; ore patches, bases and cliffs
  stay legible painted on top.
- **Nauvis-gated**, like terrain/resources/enemies/cliffs.

## UI

- New `"trees"` member of the `view` union in
  `src/noise/preview/elevationRenderRequest.ts`, dispatched in the same place as
  the other overlays.
- A Trees toggle in the preview panel's dev-mode view toggles, alongside the
  existing six.
- `control:trees` frequency/size read from the active preset's autoplace controls
  and threaded into the render request. `trees` already exists in the catalog
  (`src/model/controlCatalog.ts:65`) and already has a UI row on the Terrain tab -
  no model or codec change is needed.

## Testing

Same bar as every prior noise layer.

1. **Per-species oracle fixtures.** `sampleExpression` each of the 15 named
   expressions across multiple seeds and a grid spanning near-spawn and far-field,
   commit the JSON, diff to the f32 noise floor. Reuse the existing tolerance idiom
   (`abs < tol OR rel < tol`) that `test/resourcePatches.spec.ts` established, so
   the known far-field `basisNoise` floor does not mask a real near-field error.
2. **Control-lever fixture.** One capture at a non-default `control:trees`
   frequency and size, proving the levers enter `input_scale` and the `0.2 *
   control:trees:size` term the way the game reads them.
3. **Early-out equality.** Assert the optimized path is bit-identical to full
   evaluation over a large sample, multiple seeds and regions. This is what makes
   `BASIS_ABS_MAX` safe.
4. **Shared-field tests** for `asymmetric_ramps`, `tree_small_noise` and the cutout
   chain, oracle-validated as named expressions in their own right.
5. **Tiled equality.** Extend `test/tiledEquality.spec.ts` to cover `view: "trees"`
   and the updated `view: "all"`. Trees are evaluated per pixel with no
   neighbourhood query, so no halo is needed - unlike cliffs - but the test should
   prove that rather than assume it.
6. **Eyeball** against a real `factorio --generate-map-preview` of the same seed
   and region. Note the comparison bar: the game's preview shows *stippled placed
   trees* while ours shows expected density, so the standard is "the same forests
   in the same places with the same shape", not pixel agreement. Pixel agreement is
   Phase 2's bar, and cannot be reached without the placement roll.

## Performance

Trees add roughly 50 basis octaves per pixel plus `temperature` on top of climate.
The tiled `all` composite currently runs ~1,918 ms at 1024x1024 on a 12-core
machine. The early-out is expected to remove most of that cost, because most of the
map sits outside most species' climate window, but the number must be **measured
and recorded** the way the tiling speedup was, not assumed. If `view: "all"` lands
somewhere unacceptable after the early-out, the fallback is to reconsider trees'
inclusion in the composite - not to weaken the field.

## Risks

- **`BASIS_ABS_MAX` is a measured constant.** Mitigated by the equality test, which
  turns a wrong bound into a failure rather than a silent visual defect.
- **Climate fidelity off the default preset.** Non-default moisture/aux is a
  faithful port but was never oracle-validated point-by-point (an M2 caveat); trees
  inherit that. Unchanged by this work, recorded so it is not rediscovered.
- **Version drift.** All values come from `~/GitHub/factorio-data` @ tag 2.1.11,
  matching the oracle binary. Per `docs/noise/M3-session-handoff.md`, do **not**
  use `~/Downloads/factorio 4/data` (2.0.77, stale).
- **Phase 2 coupling.** Nothing here should hard-code the density-shaded render into
  the field module; `makeTreeDensity` must stay a pure field so the stipple project
  can consume it unchanged.

## Done means

Nauvis previews show forests: dense dark-green where the game grows dense forest,
fading at forest edges, absent on water and in the game's forest-path cutouts,
responding to the Trees frequency and size sliders, with all 15 species
oracle-validated to the noise floor and the composite render time measured and
recorded.

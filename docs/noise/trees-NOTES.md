# Nauvis trees (M4) - reverse-engineering and validation notes

Factorio 2.1.11 (build 86962, mac-arm64). Measured 2026-07-21 against the headless
oracle (`test/oracle/oracle.ts` `sampleExpression`, fixture
`test/fixtures/oracle-trees.seed123456.json`) and the non-stripped shipped binary
(disassembly). Companion to `docs/superpowers/specs/2026-07-21-nauvis-trees-design.md`
(the design record), `docs/noise/placement-roll-NOTES.md` (the deferred per-tile
placement RNG this port does not touch), `docs/noise/cliffs-NOTES.md` and
`docs/noise/enemy-bases-NOTES.md` (the two prior M4 overlays, same house style).
Source Lua: `~/GitHub/factorio-data` @ tag `2.1.11`,
`base/prototypes/entity/trees.lua` (the 15 species expressions),
`core/prototypes/noise-programs.lua:427-446` (the shared `tree_small_noise` /
forest-path cutout fields), `core/prototypes/noise-functions.lua:123`
(`asymmetric_ramps`), `core/prototypes/utility-constants.lua:201`
(`default_color_by_type["tree"]`).

## The map-preview RE: the game places real entities, not a probability shade

Before any of the field porting below was designed, the map preview's own render
path was disassembled to find out how the game itself draws forests in a preview.
`MapPreviewGenerator::Worker::computeEntities(MapPreviewChunk&)` @ `0x1016613b4`
builds a real `EntityMapGenerationTask` on the stack and calls:

```
+172:  bl  0x101622860   ; EntityMapGenerationTask::computeInternal()   (EntityMapGenerationTask.cpp:129)
+184:  bl  0x10166191c   ; MapPreviewGenerator::Worker::chartCliffs()   (MapPreviewGenerator.cpp:239)
+196:  bl  0x101661ac0   ; MapPreviewGenerator::Worker::chartEntities() (MapPreviewGenerator.cpp:258)
```

`chartEntities` @ `0x101661ac0` walks the placed entities, builds a `BoundingBox`
per entity, skips any box that collides with an already-drawn one
(`BoundingBox.cpp:624`), and calls `Chart::drawEntity()` (`Chart.cpp:284`) - the
same charting path the in-game minimap uses. **There is no probability-shading
shortcut path in the binary anywhere in this call chain.** The game's preview is
faithful because it actually runs `computeInternal()` (the full entity placement,
including the per-chunk placement roll `docs/noise/placement-roll-NOTES.md`
describes) and then charts what got placed. Reproducing the game pixel-for-pixel
therefore requires that placement roll - deferred as Phase 2, see below - and this
port instead renders the exact expected value of what the roll would produce
(the density field, not a stipple).

**Decoratives are out of scope on binary evidence, not by assumption.** No
`DecorativeMapGenerationTask` symbol exists anywhere in the binary, and the
preview worker's three calls above are the entirety of what it does before
compositing - `chartCliffs` and `chartEntities`, nothing decorative. The game's
own preview shows no decoratives, so this port does not add any; the dead/dry
tree expressions in `trees.lua` (`tree_dry_hairy`, `tree_dead_dry_hairy`,
`tree_dead_grey_trunk`, `tree_dry`, `tree_dead_desert`) feed decorative
prototypes and were excluded from the 15-species catalog for this reason.

## The footprint RE - the most valuable part

`Chart::drawEntity` @ `0x1004c4470` tail-calls `ChartingInterface::drawRectangle`
@ `0x1001b1fdc` when the `Entity*` argument is null (the map-preview case, since
there is no live entity to charts's normal path - only its footprint box).
`drawRectangle` rasterizes the box **floor on the low edge and ceil on the high
edge** - coordinates are fixed-point 1/256 tile, so the high edge is
`(right + 255) >> 8` - and blends **every pixel the box touches**, not one pixel
per entity:

```
out = ((256 - a) * dst + a * src) >> 8,   a = alphaByte + (alphaByte >> 7)
```

The tree chart color is `default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}`
(`utility-constants.lua:201`), so the alpha byte is `102` (`0.40 * 255`, rounded),
giving `a = 102 + (102 >> 7) = 102` and a blend factor of `102/256 = 0.398` per
tree, per touched pixel. Modelling one pixel per tree (the port's first cut) was
therefore **4.2x under-inked** against a real game render (measured: game 11.49%
of pixels touched at mean `|d| = 49.6`, ours 24.62% of pixels at mean `5.5`; total
ink 5.70 vs 1.35 - "ink" being the summed per-pixel absolute color delta over the
region, the same metric `cliffs-NOTES.md`/`enemy-bases-NOTES.md` use).

## The charted box size, determined empirically

`trees.lua` collision boxes vary across the 15 species (0.8x0.8, 0.8x1.0,
1.2x1.2), and nothing in the disassembly says which box `chartEntities` charts
with (it is plausibly the collision box, the selection box, or something else
entirely). Rather than guess, the box size was determined by predicting pixel
coverage over the same 1024x1024 region at seed 123456 for three candidate box
sizes and comparing against the real game's measured coverage:

| candidate box | predicted coverage |
| --- | --- |
| 0.8 x 0.8 | 9.80% |
| 1.0 x 1.0 | 11.46% |
| 1.2 x 1.2 | 13.13% |
| **real game (measured)** | **11.49%** |

`1.0 x 1.0` wins cleanly (0.06 percentage points off; the other two are off by
1.7 and 1.6 points). So the charted box is **1.0 x 1.0 tiles**, giving the
separable 1-D kernel `[0.5, 1.0, 0.5]`: a tree centred uniformly at random within
its tile paints its own pixel with probability 1, each of the 4 edge-adjacent
pixels with probability 0.5, and each diagonal with probability 0.25 -
`E[area] = 4 px/tree`. Treating neighbouring tiles' placements as independent
events, the probability at least one paints a given pixel is
`coverage = 1 - PRODUCT(1 - p * w_x * w_y)` over the 3x3 neighbourhood, which
self-limits at 1 with no artificial clamp. Implemented in
`src/noise/preview/renderTrees.ts` over a precomputed `(width+2) x (height+2)`
density buffer, so the kernel costs about one extra density evaluation per pixel
(+1.3% measured), not nine.

**Overlapping-tree blends compound, they do not cap.** The game blends once per
drawn tree in `drawRectangle`, so two overlapping trees reach
`1 - (1 - 0.398)^2 = 0.638`, not a single blend capped at `0.398`. The first
footprint fix (kernel only, alpha applied once to the coverage probability) still
under-inked at 3.85 vs the game's 5.70 (1.48x). Moving `TREE_MAX_ALPHA` inside the
per-neighbour miss product - `miss *= 1 - TREE_MAX_ALPHA * p * w_x * w_y` - lets
independent tree blends compound, matching a measured real-preview implied alpha
of up to 0.952, and brought ink to 4.67.

## The validation table (game ink / our ink, both measured the same way)

Both sides measured by diffing a trees-on against a trees-off
`--generate-map-preview` render at the same seed/region and summing the absolute
per-pixel color delta ("ink"):

| seed | game ink | our ink | ratio |
| --- | --- | --- | --- |
| 123456 | 5.70 | 4.67 | 1.22x |
| 777771 | 7.89 | 6.89 | 1.14x |

The model tracks the game's own seed-to-seed ink variation (both seeds' ratios
land in the same 1.1-1.25x band), so this is not a fit to one sample. The
residual **is the expected-value-vs-discrete difference**, not a further
modelling error: the game's real preview has a max per-pixel delta of 380 (a
pixel painted by several overlapping trees at high compounded alpha) versus our
50 (this port paints smooth expected coverage, never a hard multi-tree spike).
Only the deferred Phase 2 stipple - actually placing discrete trees and rolling
against the per-chunk RNG - can close this gap; further tuning of the kernel or
alpha model at this point would be overfitting to two samples, not modelling
anything real. **Stop chasing.**

## The per-species `sizeOffset` finding - and the methodology lesson

`tree_05` and `tree_07` use `-0.45 + 0.2 * control:trees:size` in their size term,
where the other 13 species use `-0.5 + 0.2 * control:trees:size`. This was caught
by the oracle after the design spec's first draft claimed all 15 species share
exactly one shape "verified mechanically" - the mechanical check filtered out
every line containing `control:trees:size` before comparing rows, on the
assumption that term was boilerplate. That filter excluded the one field that
actually varies, so the check "verified" uniformity by construction, on exactly
the field where it did not hold.

The bug survived a spec, a plan, and four implementation tasks (1-4) undetected,
because nothing in that chain diffed against the game - it was caught only once
Task 5's oracle validation ran. `tree_05` and `tree_07` disagreed with the real
game by a near-constant ~0.05 at all 26 sampled points (near-spawn through
`r=2400`), about 65x the ~7.7e-4 noise floor every other species sits at - a flat
offset independent of position, which is the signature of a missing/wrong
constant rather than a frequency/seed/scale bug (those grow with distance).
Grepping `trees.lua` for `control:trees:size` confirmed `tree_05`/`tree_07` are
the only two of 15 rows using `-0.45`; every other term across all 15 species was
re-checked afterward and is genuinely uniform.

Fixed by adding a per-species `sizeOffset` field to the `TreeSpecies` catalog
(`src/noise/trees/treeCatalog.ts`, default `0.5`, `0.45` for `tree_05`/`tree_07`)
plus a regression guard pinning the exception set to exactly `{tree_05,
tree_07}`. Worst residual across all 15 species dropped from **5.01e-2** (the
bug) to **7.71e-4** (`tree_02`, the ordinary noise floor) after the fix -
`tree_05`/`tree_07` individually landed at 3.15e-4 / 2.92e-4.

**The lesson, worth carrying forward to the next expression-family port**: a
uniformity check that filters out a field before comparing cannot vouch for that
field. If a mechanical "these N things are all the same shape" check needs to
exclude some substring to pass, that substring is exactly the part that has not
actually been checked - route it back through the oracle, per-row, before
trusting it.

## Oracle residuals per species (fixture: `oracle-trees.seed123456.json`)

26 sample points: a 3x3 near-spawn grid, two far rings at `r=800`/`r=2400`, and
one deep-field point. Post-fix (the state now on `feat/nauvis-trees`):

| species | worst residual |
| --- | --- |
| `tree_small_noise` (shared field) | 9.20e-4 |
| `trees_forest_path_cutout_faded` (shared field) | 5.65e-5 |
| `tree_01` | 3.03e-4 |
| `tree_02` | 7.71e-4 (worst of all 15) |
| `tree_02_red` | 7.27e-4 |
| `tree_03` | 2.24e-4 |
| `tree_04` | 2.03e-4 |
| `tree_05` | 3.15e-4 (post-fix; was 5.01e-2 - see above) |
| `tree_06` | 5.74e-4 |
| `tree_06_brown` | 4.70e-4 |
| `tree_07` | 2.92e-4 (post-fix; was 5.01e-2 - see above) |
| `tree_08` | 6.15e-4 |
| `tree_08_brown` | 5.15e-4 |
| `tree_08_red` | 5.65e-4 |
| `tree_09` | 3.91e-4 |
| `tree_09_brown` | 4.12e-4 |
| `tree_09_red` | 4.26e-4 |

All 15 species plus both shared fields sit at or below the ~1e-3 f32/fastapprox
noise floor established by every other ported noise expression in this project.
The composed-max-of-15 test's worst absolute gap is 1.03e-4.

## `BASIS_ABS_MAX` and the early-out skip rate

`makeTreeDensity` evaluates 15 species per pixel, each a `min(cap, cutoutFaded,
sharedTerms + 3-octave noise)`. Since the shared terms and cap bound every
species from above, a species can be skipped once `cheapAt(x,y) + maxNoise <=
best` - avoiding the 3-octave `multioctave_noise` evaluation entirely. `maxNoise`
needs a proven upper bound on a single `basisNoise` sample; the design spec's own
placeholder guess ("roughly 1.0-1.2") was explicitly not to be trusted and was
measured instead:

- Brief's 3-seed sampling script: max `|basisNoise|` observed = **1.769376920943407**
- Wider check, all 15 real `TREE_SPECIES` seeds over a 2,000,000-sample grid
  (`x, y` in `[-300, 300)`): max `|basisNoise|` observed = **1.771341344377337**

Both converge on ~1.77, confirming the guess was wrong (too low) and the real
bound needed measuring, not assuming. **`BASIS_ABS_MAX = 1.8`** (1.77... rounded
up to the next 0.1). Safety is enforced by test, not argument: an exact-equality
suite (`test/treeFieldEarlyOut.spec.ts`) asserts the early-out path is
bit-identical to full evaluation across three seeds, a 3000x3000 world grid, and
a non-default-control-lever case - a wrong bound would fail that test loudly
(silently clipping forests), not just read slightly off.

Skip rate, measured over a representative ~2000x2000-tile sample (x/y stepped 3
and 5 respectively) of the actual per-species loop logic: **9,517,289 of
16,028,010 species-checks skipped = 59.4%** avoid the expensive 3-octave noise
evaluation entirely.

## Render cost

Full suite: `pnpm vp test` - **99 passed / 1 skipped (100 files); 883 passed / 2
skipped (885 tests)**, 2026-07-21, clean (no regressions).

`pnpm perf` (the committed Node bench, `test/render-cost.perf.spec.ts`,
`FMW_PERF=1`, median of 3, 1024x1024, tile-per-pixel 1, seed 123456):

```
PNPM_PERF_TABLE_PLACEHOLDER
```

**Caveat on this table**: the bench's `ALL (terrain + 3 overlays)` row calls
`renderTerrain` + `renderResources` + `renderEnemies` + `renderCliffs` directly
and was never updated to add `renderTrees` alongside the other three overlays -
so that row still measures the pre-trees composite, not the current
`view: "all"`. `runRenderRequest({ view: "all" })` (what the app and
`elevationRenderRequest.ts` actually dispatch) does include trees; the bench's
hand-assembled `ALL` row does not. Recorded here as a known gap in the bench
rather than silently treating its `ALL` number as the trees-inclusive cost;
fixing the bench is out of scope for a documentation-only task.

A one-off, uncommitted measurement of `runRenderRequest({ ...base, view: "trees"
})` and `runRenderRequest({ ...base, view: "all" })` (which does include trees)
gives the actual current cost:

```
NODE_TREES_MEASUREMENT_PLACEHOLDER
```

Per `docs/superpowers/plans/2026-07-21-region-tiling-renderer.md` and the
`render-perf-tiling` session note, **the Node bench (`pnpm perf`) runs roughly
15% optimistic versus a real browser** - a rule established while building the
region-tiling renderer, not new here. Scale the Node numbers above up ~15% to
predict browser wall-clock.

**Open item: the browser measurement for trees has not been taken.** The prior
tiling work's browser numbers (elevation 237ms / terrain 1,519ms / all 1,918ms
tiled, 11 workers, 12-core machine) predate this branch and do not include
trees. Taking the median-of-3 in-app elapsed-ms reading (Debug mode,
`view: "all"`, 1024x1024, with and without trees) is flagged as outstanding
follow-up work, not fabricated here.

## What Phase 2 would need

This port ships the 15 probability fields and a density-shaded render - the
exact expected value of what the game's placement roll would produce, per
`makeTreeDensity`'s doc comment and the design spec's "why the composition is
max, and why that is exact" section. Reaching pixel-for-pixel agreement (discrete
placed trees, not smooth density) needs the full per-chunk placement roll this
port explicitly does not touch:

- The shared per-chunk taus88 stream (`EntityMapGenerationTask::generateEntities`)
  consumed in a fixed order across **every** Nauvis autoplacer group, not just
  trees - resources (done, M3a/b), enemy spawners (done, M4), trees (this spec's
  fields only), worms, and fish, per the group-ordering table in the design spec.
- Per-tile arbitration: a single winning entity by max probability, then one
  roll against that winner's probability (`generateEntities +1104..+1188`) - this
  is exactly why `max_i p_i` is the correct field to have built, not a sum.
- The 2 jitter draws per placement in `generateEntityOnTile` (sub-tile position
  jitter), also consumed from the same shared stream.

None of this is research-hard - it was already reverse-engineered as the M3.5
spike - it is multi-session, cross-subsystem work that would upgrade trees,
resources, and enemy bases from footprint/shading to faithful stipple in one
project, not three separate ones. Full RE, the exact seeding formula, and the
decision to defer: `docs/noise/placement-roll-NOTES.md`.

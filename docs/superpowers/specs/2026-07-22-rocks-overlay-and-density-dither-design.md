# Rocks overlay + density-matched stipple dither - design

Point-in-time design record (not a living doc). Written 2026-07-22.

Answers two questions raised against the client-side Nauvis preview:

1. Trees render as a smooth green blob; the game's native preview shows individual
   scattered pixels. Match the native look without a major project.
2. Show rocks too (trees + rocks).

## Decision

Two sessions, sequenced. **Session 1 = C (rocks overlay).** **Session 2 = A (a
world-position dither that upgrades both trees and rocks to a scattered-pixel
look).** **B (the faithful per-chunk placement roll) is shelved.**

Rationale - the three options were costed before this doc (see the companion
reasoning in the session that produced it):

- **C** is an independent easy win, the same class of work as the enemy-base
  overlay but simpler (3 fields, one `multioctave_noise` each, versus 15 tree
  species). It gives the already-registered `rocks` control a renderer.
- **A** is the cheapest path to "individual pixels". It does NOT invent detail:
  `makeTreeDensity` already returns the exact per-tile place-probability the game
  rolls against (the game arbitrates one winning entity per tile by max
  probability, then rolls once). A dither is that identical field spatially
  quantized into place / no-place - which is precisely what the native preview
  shows. The blob already matches dense forest cores (compounding alpha reaches
  ~0.95); what reads as "smooth" is the faint translucent wash at forest edges
  and low-density zones, which is exactly what a dither fixes.
- Rocks are sparse (huge-rock `multiplier` is 0.07, so peak per-tile probability
  is ~2-6%). Sparse fields are the case where a dither reads far better than a
  faint alpha shade - so A is the render mode rocks want anyway. One dither
  primitive, built once, serves both trees and rocks. That composition is why C
  comes first (get the fields in and oracle-validated) and A second (upgrade both
  looks at once).
- **B** is 3-5 sessions for a correctness property a preview does not need. It
  drags in porting worms and fish (they consume draws in the shared per-chunk
  taus88 stream), and it breaks the per-pixel-pure-function model the tiled
  renderer depends on. Only worth it for literal per-tile parity with the game's
  tree positions, which is out of scope. Full RE already exists at
  `docs/noise/placement-roll-NOTES.md`; nothing here re-derives it.

## Is the dither a trap? The honest framing (belongs in the spec, not lost)

A trades "obviously approximate" (a heatmap nobody expects to match placement)
for "looks like placed trees but isn't". Two failure modes, both managed:

1. **Could look worse than the blob** - true if the dither is white noise
   (`hash(x,y) < density` thresholds into ugly clumps and holes). A MUST use a
   blue-noise / ordered dither mask so it reads as clean scattered stipple. This
   is the main design cost of session 2, not a research risk.
2. **"Why doesn't it match the game" forever** - legitimate. Once it looks
   discrete, someone overlays it on the game and sees different dot positions
   (the game's positions come from the taus88 chunk stream A does not simulate).
   For a map *preview* - where the author is choosing frequency/size, and the
   game's own preview already differs from the map it generates - representative
   texture is the correct and standard thing. Mitigation: **frame it as
   representative texture; never imply tile-exactness in the UI.** If any UI copy
   currently implies the preview is exact, fix that as part of session 2.

Verdict: not a trap for a preview, provided the mask is blue noise and we do not
oversell exactness.

---

## Session 1 - C: rocks overlay

### The fields (factorio-data @ 2.1.11)

Only 3 of the 9 `rocks`-control prototypes are `simple-entity` with a `map_color`
and therefore chart like trees. All three share `map_color = {129, 105, 78}`, so
one overlay color suffices. All in
`base/prototypes/decorative/decoratives.lua`:

Common to all three:

```
probability = multiplier * control:rocks:size * (region_box + rock_density - penalty)
rock_density = rock_noise - max(0, 1.1 - distance / 32)
rock_noise   = multioctave_noise{seed0 = map_seed, seed1 = 137, octaves = 4,
                                 persistence = 0.9,
                                 input_scale = 0.15 * control:rocks:frequency,
                                 output_scale = 1}
               + 0.25 + 0.75 * (slider_rescale(control:rocks:size, 1.5) - 1)
```

Per-prototype (`base/prototypes/noise-expressions.lua:75-89` for the shared noise;
autoplace blocks at the lines below):

| prototype     | multiplier | penalty | region_box                                             |
| ------------- | ---------- | ------- | ------------------------------------------------------ |
| huge-rock     | 0.07       | 1.7     | `range_select_base(moisture, 0.35, 1, 0.2, -10, 0)`    |
| big-rock      | 0.17       | 1.6     | `range_select_base(moisture, 0.35, 1, 0.2, -10, 0)`    |
| big-sand-rock | 0.10       | 1.6     | `min(aux_range, moisture_range)` (aux + moisture bands) |

`big-sand-rock`'s `aux_range` / `moisture_range` `local_expressions` are read in
full during implementation (they are `range_select` bands on `aux` and
`moisture`).

Per-tile arbitration is max probability (same as trees), so the overlay field is
`max_i probability_i` over the three - the same shape `makeTreeDensity` uses.

### Primitives - all exist, two tiny additions

- `multioctave_noise` - `makeMultioctaveNoise` (done).
- `moisture` - `makeMoisture` (done). `aux` - `makeAux` (done, used by tiles).
- `distance` - `distanceFromNearestPoint` (done).
- **New, trivial:** `range_select_base(input, from, to, slope, min, max) =
  clamp(min(input - from, to - input) / slope, min, max)`
  (`core/prototypes/noise-functions.lua:105`). `range_select` (the `-slope`
  variant) if `big-sand-rock` needs it.
- **New, trivial scalar:** `slider_rescale(v, n) = 2^(log2(v)/log2(6)*log2(n))`
  (`core/prototypes/noise-functions.lua:16`) - a pure function of the size slider,
  constant per render. Check `src/model/controlScale.ts` for an existing
  equivalent before adding.

### Files

- **New `src/noise/rocks/rockField.ts`** - `makeRockDensity(params)` returning
  `(x, y) => number = max_i probability_i`, plus the catalog of 3 param sets.
  Mirror `src/noise/enemies/enemyBaseField.ts` / `treeField.ts` structure.
- **New `src/noise/preview/renderRocks.ts`** - clone `renderEnemies.ts`. Water
  exclusion reuses `WATER_TILE_COLORS` (rocks collide with water). Cliff
  exclusion left unwired, consistent with the existing ore-on-cliffs gap.
- **`src/noise/preview/elevationRenderRequest.ts`** - add `"rocks"` to the `view`
  union and a `rockControls`/reuse of existing control plumbing; add a
  `renderRocks` block. **Composite order:** rocks are ground decoratives - draw
  them after trees and before resources/enemies/cliffs.
- **`src/components/ElevationPreviewPanel.vue`** - add a Rocks view toggle
  alongside Trees/Resources/Enemies/Cliffs (dev-mode view toggles). Nauvis-gated,
  like the others.
- **`test/tiledEquality.spec.ts`** - add `"rocks"` to the `VIEWS` list so the new
  overlay is held to byte-identical tiling from day one.

### Interim render fidelity (session 1)

Rocks are point-like and sparse, so **1 pixel per rock cell** is more faithful
than cliffs' 5x5 legibility block (a block would merge scattered rocks into a
blob - wrong). Render as an opaque `ROCK_MAP_COLOR` footprint where
`max_i probability_i >= threshold`. Because probabilities are tiny, the threshold
is not `0.5`; pick it by **matching game rock coverage**: choose the threshold so
the painted-pixel fraction equals the rock-pixel fraction in a real
`--generate-map-preview` render (the same ink-ratio method trees used). This
interim look is scattered specks already; session 2's dither refines it. If 1px
is invisible in-app, block size is a legibility knob to revisit - do not reach for
it pre-emptively.

### Validation (session 1)

- **Oracle-validate the 3 probability fields** point-by-point via
  `calculate_tile_properties`, exactly as trees/enemies were, to the ~1e-3
  fastapprox noise floor. This is C's real deliverable - the field, not the
  interim pixels.
- Headless full-view eyeball: rocks scatter across land, absent on water, absent
  in the cleared spawn area.
- `pnpm run verify` green (expect 906+ passed with the new field/render tests).

---

## Session 2 - A: density-matched stipple dither (trees + rocks)

### Approach

Add a dither mode that converts a density field into a per-tile place / no-place
decision, painting the entity color where it places. Reuses `makeTreeDensity` and
`makeRockDensity` unchanged - they are already the exact expected-value fields.

### The hard constraint - tiled byte-identity

`test/tiledEquality.spec.ts` renders 32px tiles and asserts byte-identity to the
whole render across all views (now including `trees` and `rocks`). The dither
**must be a pure function of world tile coordinate and seed** -
`ditherMask(worldX, worldY, seed0)` - and never depend on pixel index within a
tile, render order, or a sequential RNG. Since `worldX = originX + px * tpp` is
computed identically in tiled and whole renders, a world-indexed mask is
byte-identical across seams by construction (the same property the current
density buffer relies on). The gate already covers these views, so any accidental
tile-index dependence fails loudly.

### The mask must be blue noise

A per-pixel `hash(x,y) < density` (white noise) clumps and reads as static. Use a
blue-noise / ordered dither: e.g. a precomputed void-and-cluster tile indexed
`mask[(worldX & (N-1))][(worldY & (N-1))]` (still a pure function of world
position, still tiled-safe), or a hash-based blue-noise approximation. Getting
this to read as scattered entities rather than a grid or static is the core work
of the session.

### Where the dither applies

- **Trees:** where the tree wins, place at the game's per-tree alpha (keep the
  existing compounding-alpha blend for placed pixels). At density ~1 the mask
  places ~every pixel -> solid green cores, unchanged. At density 0.2-0.5 it
  scatters specks -> the native edge look.
- **Rocks:** same mask, `ROCK_MAP_COLOR`. Replaces session 1's threshold
  footprint.
- **`tilesPerPixel` > 1 (zoomed out):** one world sample per pixel undersamples a
  discrete decision, so **keep the expected-value alpha shade when tpp > 1** and
  dither only at tpp <= 1 (~1px per tile, where discrete is meaningful). `tpp` is
  constant per render, so this never threatens byte-identity.

### Honest acceptance criterion (NOT tile-exact vs the game)

The dither is deliberately not tile-exact - the dots will not sit where the
game's taus88 stream puts them, so per-tile agreement is the wrong test. The
correct gate is **coverage conservation**: the dither is a spatial
re-quantization of the same integral the blob already targets.

1. **Unit test:** dither total ink ≈ blob total ink per region, to within
   quantization, so it cannot silently drift.
2. **Ink-ratio vs a real render:** the same check trees already passed (game / our
   ink 1.22x @ seed 123456, 1.14x @ 777771), eyeballed on the same two seeds.
   Total ink vs the game is unchanged from today; only the spatial distribution
   changes.
3. **Subjective:** reads as discrete scattered pixels at forest/rock edges, not a
   wash and not static. Eyeball against `--generate-map-preview`, same two seeds.

### Perf

Trees already have a per-species-recomputation trap (5,121 ms -> 370 ms once
hoisted). The dither adds only a mask lookup per pixel over the existing density
evaluation, so cost should be flat, but measure: `pnpm perf` (`FMW_PERF=1`) plus a
browser median-of-3 in Debug mode (`view: "all"`, 1024x1024) - the Node bench
reads ~15% optimistic. Do not "tidy" the load-bearing float order in
`treeField.ts`.

### UI framing

If any preview UI copy implies exactness, adjust it so the dither reads as
representative texture (see the trap section). Small change; do not skip it.

---

## Non-goals

- **B / the per-chunk placement roll** - shelved. No worms/fish port, no
  chunk-sequential simulator, no rethink of the tiled gate.
- **Per-tile parity** with the game's actual tree/rock positions.
- **The other 5 rock prototypes** (`optimized-decorative`, no `map_color`) - not
  charted, not rendered. Confirm the no-`map_color` = not-charted assumption
  against the binary evidence trees already gathered (`chartEntities` only) before
  relying on it.
- **Non-Nauvis planets.**

## Risks

- **Blue-noise mask quality** - the one aesthetic risk that could make A look
  worse than the blob. Mitigated by using a real blue-noise mask, not white noise,
  and by the coverage + eyeball gates.
- **Rock threshold tuning (session 1)** - a badly chosen threshold makes rocks too
  dense or invisible. Mitigated by tuning it to real-render coverage, and it is
  superseded by the dither in session 2 anyway.
- **`big-sand-rock` region_box** - its aux+moisture bands are the one field detail
  not fully transcribed here; read the `local_expressions` in full during
  implementation and oracle-validate like the other two.

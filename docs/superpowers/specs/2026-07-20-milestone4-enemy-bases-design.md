# Milestone 4 - enemy bases (design)

Point-in-time design record (like the other files under `docs/superpowers/specs/`),
written 2026-07-20. Companion to the M3 resources design
(`2026-07-19-milestone3-resources-design.md`), whose overlay pipeline this reuses.

## Goal

Add a client-side **enemy-base overlay** to the map preview: a red footprint over
the Nauvis terrain render showing where biter/spitter bases cluster, responding to
the `control:enemy-base:frequency|size` levers, with the starting area clear of
enemies. This is the first Milestone 4 ("long tail") item.

**Correctness bar (same as M1-M3):** the ported probability *field* agrees with the
game's `calculate_tile_properties` to the fastapprox noise floor
(`|port-game| < max(1.0, 1e-2*|game|)`). We render a probability **footprint**, not
exact per-nest placement - exact spawner tile positions go through the per-chunk
`EntityMapGenerationTask` roll that was reverse-engineered and **deferred** in M3.5
(`docs/noise/placement-roll-NOTES.md`); a faithful footprint does not need it.

## Tractability: mostly reuse, plus one RE step

Enemy bases reuse primitives that are already implemented and oracle-validated:

- `spot_noise` cone rendering (`resources/regularPatches.ts`) - already honors this
  field's `basement_value = -1000` and `maximum_spot_basement_radius = 128`.
- `basis_noise` (`basisNoise.ts`) - the three `blob(...)` terms are `basis_noise`.
- `distance` (`distanceFromNearestPoint.ts`) - already threaded through the resources
  render as `startingPositions`.
- `clamp`/`min`/`max`/arithmetic.

**One spot-param question, resolved by the M4 spike** (2026-07-20; writeup in
`docs/noise/enemy-bases-NOTES.md`): the enemy `spot_noise` sets
**`candidate_point_count = 100`** and leaves `candidate_spot_count` +
`suggested_minimum_candidate_point_spacing` at engine defaults, a path the M3
`spotSelection.ts` (which models only `candidateSpotCount` + a required `spacing`)
never exercised. The code review rightly flagged this as potentially un-RE'd. **A
spike settled it as a non-issue:** a hand-port over the existing `selectSpots`
(mapping `candidate_point_count -> candidateSpotCount = 100`) matches the oracle to
`abs < 0.001` at 7 points (basement, near-spawn, five cone interiors), **identical for
spacing in {32, 45.25, 51.2}** - because this field's low density (`frequency ~1e-5`)
trims to ~5 spots/region, reached before the pool size or spacing-decay could bind. So
**no `spotSelection` change is needed**; the field is a straight reuse. Task 1 folds
this into a dense full-region oracle validation (belt-and-suspenders) rather than a
standalone RE spike.

`starting_area_radius = 150` (default `starting_area`) is directly sampleable, not a
new primitive (see Levers).

## The field (1:1 port from `base/prototypes/noise-expressions.lua` @ 2.1.11)

Source: `~/GitHub/factorio-data` (tag `2.1.11`),
`base/prototypes/noise-expressions.lua` (enemy expressions),
`base/prototypes/entity/enemy-autoplace-utils.lua` (the autoplace wrapper),
`base/prototypes/entity/enemies.lua` (biter-spawner uses `enemy_autoplace_base(0, 6)`
at :209, spitter-spawner `(0, 7)` at :865). Transcription verified character-for-character
by the code review.

```
enemy_base_intensity   = clamp(distance, 0, 2400) / 325
enemy_base_radius      = sqrt(control:enemy-base:size) * (15 + 4 * enemy_base_intensity)
enemy_base_frequency   = (1e-5 + 3e-6 * enemy_base_intensity) * control:enemy-base:frequency
spot_radius_expression   = max(0, enemy_base_radius)
spot_quantity_expression = pi/90 * spot_radius_expression^3

enemy_base_probability =
    spot_noise{ x=x, y=y,
                density_expression      = spot_quantity_expression * max(0, enemy_base_frequency),
                spot_quantity_expression = spot_quantity_expression,
                spot_radius_expression   = spot_radius_expression,
                spot_favorability_expression = 1,
                seed0 = map_seed, seed1 = 123,
                region_size = 512, candidate_point_count = 100,
                hard_region_target_quantity = 0,
                basement_value = -1000, maximum_spot_basement_radius = 128 }
  + (blob(1/8, 1) + blob(1/24, 1) + blob(1/64, 2) - 0.5) * spot_radius_expression / 150
      * (0.1 + 0.9 * clamp(distance / 3000, 0, 1))
  - 0.3
  + min(0, 20 / starting_area_radius * distance - 20)

blob(input_scale, output_scale) =
    basis_noise{ x=x, y=y, seed0 = map_seed, seed1 = 123,
                 input_scale = input_scale, output_scale = output_scale }
```

The spawner placement probability is `enemy_autoplace_base(0, 6)`:

```
enemy_autoplace_base(distance_factor = 0, seed = 6) =
    random_penalty{ x = x + 6, y = y,
        source = min( enemy_base_probability
                        * max(0, 1 + 0.002 * 0 * (...)),   # distance_factor = 0 -> factor 1
                      0.25 + 0 * 0.05 ),                    # -> cap 0.25
        amplitude = 0.1 }
```

With `distance_factor = 0` the distance-shaping factor collapses to `1` and the cap to
`0.25`, so the **deterministic source** is `min(enemy_base_probability, 0.25)`
(verified against the oracle: inside spots `enemy_autoplace_base = min(ebp, 0.25) -
0.1*U`, subtractive `random_penalty`; e.g. ebp 0.781 -> 0.172). The near-spawn
**starting-area clearing** falls out of the `- 0.3` and `min(0, 20/150 * distance -
20)` terms inside `enemy_base_probability` (measured clear within +-140 tiles of
spawn), with no special handling.

**We render the deterministic source and omit the `random_penalty` wrapper** - see
the render-semantics section for why. `random_penalty` (`randomPenalty.ts`) is a
**batch op**, not a per-tile function: it is seeded once from the batch's first
position and consumes its taus88 stream across the batch from last element to first,
so its exact per-tile value depends on the batch the game happens to evaluate (a
chunk row), which a per-pixel downsampled preview cannot reproduce - the same
batch-boundary coupling that blocks crude-oil's `random_probability` factor and the
M3.5 placement roll. Its `amplitude = 0.1` is cosmetically irrelevant to a threshold
footprint anyway. So the footprint uses `min(enemy_base_probability, 0.25)` directly;
the batch RNG never enters.

**What we render (spawners only).** Both biter-spawner `(0, 6)` and spitter-spawner
`(0, 7)` are `distance_factor = 0`, so they share the identical deterministic source
`min(enemy_base_probability, 0.25)` - one footprint covers both. `(0, 7)` is the
**spitter-spawner, not a worm** (`seed` is just the per-expression x-offset into the
omitted `random_penalty`). **Worms** (`enemy_worm_autoplace`, `(0,2)/(2,3)/(5,4)/(8,5)`
in `turrets.lua`, wrapped `* (1 - no_enemies_mode)`) are OUT OF SCOPE: only the small
worm is `distance_factor = 0`; medium/big/behemoth are distance-shaped (their factor
and cap do not collapse), so they are a distinct, wider field. Rendering the spawner
footprint is the "where are the biter/spitter nests" answer; worm turrets sit within
the same base regions and add no distinct visible territory at preview scale.

## Render semantics

**Base-region footprint** (chosen over a density heatmap or a spawner/worm split):
fill each land tile where the deterministic spawner source
`min(enemy_base_probability, 0.25) >= T` with the enemy `map_color`, composited onto
the terrain ImageData - the same convention as the M3 resource footprint, except:

- **The field structure (measured).** `enemy_base_probability` sits at the `-1000`
  basement almost everywhere and rises above `0` only *inside* base spot cones (far
  grid: basement `-1000` vs spot peaks `~0.4-0.78` in `ebp`, capped at `0.25` in the
  placement source). So the footprint is exactly those positive cones.
- **Threshold `T` is a small positive value**, NOT the resource `>= 0.5` (which caps
  at `0.25` here) nor "half the cap". Since the field is either `~-1000` or a positive
  cone, any `T` in `(0, 0.25)` cleanly separates base from non-base; `T` only trims how
  much of each cone's fading edge is included. Start at `T = 0.05` and pin it in the
  headless-eyeball step by comparing renders against a real `--generate-map-preview`
  (nest regions + starting-area clearing). `T` is a single documented constant.
- **`random_penalty` omitted** (see the field section): a ±10% per-tile jitter with
  batch-RNG semantics that a per-pixel preview cannot reproduce and that does not
  change the region. The footprint is the deterministic source.
- **Water exclusion.** Spawners collide with water, so skip any pixel the terrain
  drew as water/deepwater - reuse `renderResources`'s exact `WATER_TILE_COLORS`
  decision (no re-derivation), so the enemy edge lines up with the drawn coastline.
- **Color.** `default_enemy_color = {1, 0.1, 0.1}` from
  `core/prototypes/utility-constants.lua` -> RGB `(255, 26, 26)`. (Spawners carry no
  per-entity `map_color`; the map uses the utility default enemy color.)


## Levers, scalars, inputs

- `control:enemy-base:frequency|size` - already in `Preset.autoplaceControls`
  (edited by the Enemy tab); read via the existing autoplace-control accessor used
  by the resources render.
- `distance` - Euclidean distance to `startingPositions` (already threaded through
  `renderResources` / `elevationRenderRequest`; default single origin spawn).
- `starting_area_radius` - a game-provided scalar. Measured `= 150` for the default
  `starting_area` setting (directly sampleable as the named value `starting_area_radius`;
  it equals the `starting_resource_placement_radius` constant). Hardcode `150`; it
  scales with the `starting_area` setting but only the default is validated (deferred,
  like other non-default settings). (NB: do NOT derive it from `starting_area_weight` -
  that is a different, decreasing expression `1 - min(1, 0.5*tier_from_start)`.)
- `no_enemies_mode` - defaults `0`; already modeled on the mid-block
  (`src/model/types.ts`). Only affects worms (out of scope), so it does not enter the
  spawner footprint.

## Module layout

```
src/noise/enemies/
  enemyCatalog.ts     # control name "enemy-base", spot_noise params, blob seed,
                      #   cap 0.25, starting_area_radius=150, enemy map_color, threshold T
  enemyBaseField.ts   # makeEnemyBaseField(ctx) -> { probability(x,y): number }
                      #   ports enemy_base_probability; returns the deterministic
                      #   spawner source min(enemy_base_probability, 0.25).
                      #   reuses selectSpots (candidateSpotCount=100) + cone render (as
                      #   regularPatches does), basisNoise blobs, distance. No spotSelection
                      #   change (spike-confirmed). No randomPenalty (batch op).
src/noise/preview/
  renderEnemies.ts    # composite onto terrain ImageData; fill map_color where
                      #   probability >= T; skip water (WATER_TILE_COLORS)
```

`elevationRenderRequest.ts` gains a `view: "enemies"` case (renderTerrain base ->
renderEnemies). `ElevationPreviewPanel.vue` gains an "Enemies" toolbar button gated
on `terrainAvailable` (Nauvis), alongside Elevation/Terrain/Resources.

## Validation (oracle-first, mirrors M3)

1. **Field port (primary, asserted).** Capture **`enemy_base_probability`** via
   `calculate_tile_properties` at a grid for 2-3 seeds (reuse `test/oracle/oracle.ts`
   `sampleExpression`; commit the JSON fixtures, run comparison without Factorio).
   Assert `|port-game| < max(1.0, 1e-2*|game|)`. **Tolerance caveat:** the field spans
   `-1000` (basement) to `~0.25` (spot caps), so a `1.0` absolute tolerance is loose
   relative to the `~0.25` in-spot signal. The assertion therefore mainly guarantees
   basement-matches-basement and that cones land in the right place at roughly the
   right height; the *footprint* correctness (which side of `T` each pixel falls) is
   what actually matters and is confirmed by the eyeball step. We assert against
   `enemy_base_probability` (no `random_penalty`), **not** `enemy_autoplace_base`: the
   latter's batch-RNG `random_penalty` cannot be matched per-pixel (field section).
2. **Footprint threshold (eyeball, not asserted).** Headless full-view render; confirm
   nest regions cluster correctly, the starting area is clear (measured clear within
   +-140 tiles), and the footprint responds to the frequency/size sliders. Pin `T`. We
   do **not** assert exact per-nest tile placement (deferred per-chunk roll, M3.5).

## Testing

Unit tests per module, mirroring `regularPatches.spec.ts` / `renderResources.spec.ts`:

- `enemyBaseField.spec.ts` - field values vs the committed oracle fixtures (abs/rel
  tolerance); structural checks (basement far from spots, positive cones inside them,
  cleared near spawn).
- `renderEnemies.spec.ts` - footprint fill at/above `T`, water-exclusion, and a
  drift guard asserting the enemy `map_color` and `WATER_TILE_COLORS` still match
  their sources.

## Out of scope / deferred

- **Exact spawner tile placement** - the per-chunk `EntityMapGenerationTask` roll
  (M3.5, `placement-roll-NOTES.md`). The footprint is a region, not tile-exact
  nests.
- **Cliffs** (the other M4 item) and the ore-on-cliffs exclusion it unblocks -
  separate milestone.
- **Non-default `starting_area`, non-Nauvis planets, exposing `no_enemies_mode` in
  the UI** - the render is Nauvis + default-`starting_area` faithful; other cases
  are a faithful port but not oracle-validated point-by-point (same posture as the
  non-default climate render in M2).
- **Combining enemy + resource overlays in one view** - each `view` is a single
  layer (matches current Elevation/Terrain/Resources UX). YAGNI until asked.

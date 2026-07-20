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

## Why this is tractable (no new primitive)

Enemy bases reuse only primitives that are already implemented and oracle-validated:

- `spot_noise` (candidate RNG `spotCandidates.ts` + selection `spotSelection.ts`,
  cone rendering in `resources/regularPatches.ts`) - the existing spot-field
  machinery already handles this field's `basement_value = -1000` and
  `maximum_spot_basement_radius = 128`.
- `basis_noise` (`basisNoise.ts`) - the three `blob(...)` terms are `basis_noise`.
- `distance_from_nearest_point` / `distance` (`distanceFromNearestPoint.ts`) -
  already threaded through the resources render as `startingPositions`.
- `clamp`/`min`/`max`/arithmetic.

The only non-obvious scalar, `starting_area_radius`, is **oracle-derivable** (see
the Validation section), not a new primitive. Because nothing here is un-RE'd, M4 needs **no
preceding research spike** (unlike `random_penalty` for M3a or the M3.5 roll) - it
is a re-run of the validated M3 overlay pipeline with a new field.

## The field (1:1 port from `base/prototypes/noise-expressions.lua` @ 2.1.11)

Source: `~/GitHub/factorio-data` (tag `2.1.11`),
`base/prototypes/noise-expressions.lua` (enemy expressions),
`base/prototypes/entity/enemy-autoplace-utils.lua` (the autoplace wrapper),
`base/prototypes/entity/enemies.lua` (spawner uses `enemy_autoplace_base(0, 6)`).

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

The full spawner placement probability is `enemy_autoplace_base(0, 6)`:

```
enemy_autoplace_base(distance_factor = 0, seed = 6) =
    random_penalty{ x = x + 6, y = y,
        source = min( enemy_base_probability
                        * max(0, 1 + 0.002 * 0 * (...)),   # distance_factor = 0 -> factor 1
                      0.25 + 0 * 0.05 ),                    # -> cap 0.25
        amplitude = 0.1 }
```

With `distance_factor = 0` (spawners) the distance-shaping factor collapses to `1`
and the cap to `0.25`, so the **deterministic source** is
`min(enemy_base_probability, 0.25)`. The near-spawn **starting-area clearing** falls
out of the `- 0.3` and `min(0, 20/starting_area_radius * distance - 20)` terms
inside `enemy_base_probability`, with no special handling.

**We render the deterministic source and omit the `random_penalty` wrapper** - see
the render-semantics section for why. `random_penalty` (`randomPenalty.ts`) is a
**batch op**, not a per-tile function: it is seeded once from the batch's first
position and consumes its taus88 stream across the batch from last element to first,
so its exact per-tile value depends on the batch the game happens to evaluate (a
chunk row), which a per-pixel downsampled preview cannot reproduce - the same
batch-boundary coupling that blocks crude-oil's `random_probability` factor and the
M3.5 placement roll. Its `amplitude = 0.1` (±10%) is cosmetically irrelevant to a
threshold footprint anyway. So the footprint uses `min(enemy_base_probability,
0.25)` directly; the batch RNG never enters.

Worms (`enemy_autoplace_base(0, 7)`) are `spawner_probability * (1 -
no_enemies_mode)`; on the default preset `no_enemies_mode = 0`, so the worm field
equals the spawner field. We render the single **spawner** field. (`seed` is a
per-expression x-offset into the omitted `random_penalty`, so with the wrapper
dropped the spawner and worm deterministic sources are identical at
`no_enemies_mode = 0`.)

## Render semantics

**Base-region footprint** (chosen over a density heatmap or a spawner/worm split):
fill each land tile where the deterministic spawner source
`min(enemy_base_probability, 0.25) >= T` with the enemy `map_color`, composited onto
the terrain ImageData - the same convention as the M3 resource footprint, except:

- **Threshold `T`.** Resources use `>= 0.5` (half the `[0,1]` cap). The spawner
  probability caps at `0.25`, so `>= 0.5` would render nothing. Start at
  `T = 0.125` (half the `0.25` cap) and pin it in the headless-eyeball step by comparing
  renders against a real `--generate-map-preview` (nest regions + starting-area
  clearing). `T` is a single documented constant.
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
- `starting_area_radius` - a game-provided scalar from the `starting_area` map
  setting, **oracle-derived** (see Validation): sample the named expression
  `starting_area_weight = max(0, distance - starting_area_radius) / starting_area_radius`
  (`core/prototypes/noise-programs.lua:576`) at two distances and solve for
  `starting_area_radius`. Modeled as a constant keyed off the `starting_area`
  setting (default only, initially).
- `no_enemies_mode` - defaults `0`; already modeled on the mid-block
  (`src/model/types.ts`). We render the spawner field (worms == spawners at
  `no_enemies_mode = 0`).

## Module layout

```
src/noise/enemies/
  enemyCatalog.ts     # control name "enemy-base", spot_noise params, blob seed,
                      #   cap 0.25, starting_area_radius, enemy map_color, threshold T
  enemyBaseField.ts   # makeEnemyBaseField(ctx) -> { probability(x,y): number }
                      #   ports enemy_base_probability; returns the deterministic
                      #   spawner source min(enemy_base_probability, 0.25).
                      #   reuses selectSpots + cone render (as regularPatches does),
                      #   basisNoise blobs, distance. (No randomPenalty - batch op.)
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
   Assert `|port-game| < max(1.0, 1e-2*|game|)` - the combined abs/rel tolerance M3b
   uses, which accommodates the far-field `basisNoise` f32 floor without masking
   near-spawn errors. We assert against `enemy_base_probability` (no
   `random_penalty`), **not** `enemy_autoplace_base`: the latter's batch-RNG
   `random_penalty` cannot be matched per-pixel (field section). Sampling
   `enemy_autoplace_base` as a non-asserted sanity check is fine (its deterministic
   source should track `min(enemy_base_probability, 0.25)` within the ±10%
   amplitude), but it is not a pass/fail gate.
2. **Footprint threshold (eyeball, not asserted).** Headless full-view render;
   confirm nest regions cluster correctly, the starting area is clear, and the
   footprint responds to the frequency/size sliders. Pin `T`. We do **not** assert
   exact per-nest tile placement (deferred per-chunk roll, M3.5).

## Testing

Unit tests per module, mirroring `regularPatches.spec.ts` / `renderResources.spec.ts`:

- `enemyBaseField.spec.ts` - field values vs the committed oracle fixtures (abs/rel
  tolerance); a `starting_area_radius` derivation check.
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

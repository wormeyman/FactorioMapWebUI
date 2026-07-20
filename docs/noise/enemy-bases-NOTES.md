# Enemy bases (M4) - reverse-engineering notes

Factorio 2.1.11 (build 86962). Measured 2026-07-20 against the headless oracle
(`test/oracle/oracle.ts` `sampleExpression`, routing a named expression onto
`elevation`). Companion to `spot-noise-NOTES.md`, `basis-noise-NOTES.md`,
`random-penalty-NOTES.md`. Source Lua: `~/GitHub/factorio-data` @ tag `2.1.11`,
`base/prototypes/noise-expressions.lua` (enemy expressions),
`base/prototypes/entity/{enemies,turrets}.lua` (autoplace bindings).

## The expressions (verbatim, `noise-expressions.lua:1-49`)

```
enemy_base_intensity   = clamp(distance, 0, 2400) / 325
enemy_base_radius      = sqrt(var('control:enemy-base:size')) * (15 + 4 * enemy_base_intensity)
enemy_base_frequency   = (0.00001 + 0.000003 * enemy_base_intensity) * var('control:enemy-base:frequency')
spot_radius_expression   = max(0, enemy_base_radius)
spot_quantity_expression = pi/90 * spot_radius_expression ^ 3

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

blob(is, os) = basis_noise{ x=x, y=y, seed0=map_seed, seed1=123, input_scale=is, output_scale=os }

enemy_autoplace_base(distance_factor, seed) =
    random_penalty{ x = x + seed, y = y,
        source = min( enemy_base_probability * max(0, 1 + 0.002*distance_factor*(-312*distance_factor - starting_area_radius + distance)),
                      0.25 + distance_factor*0.05 ),
        amplitude = 0.1 }
```

## Autoplace bindings (who uses which `enemy_autoplace_base(distance_factor, seed)`)

- **biter-spawner** `(0, 6)` (`enemies.lua:209`), **spitter-spawner** `(0, 7)`
  (`enemies.lua:865`) - via `enemy_spawner_autoplace` (`enemy-autoplace-utils.lua:14`).
  Both have `distance_factor = 0`.
- **worms** (`enemy_worm_autoplace`, wrapped `* (1 - no_enemies_mode)`): small `(0, 2)`,
  medium `(2, 3)`, big `(5, 4)`, behemoth `(8, 5)` (`turrets.lua:421/1050/1193/1334`).
  Only the small worm is `distance_factor = 0`; medium/big/behemoth are distance-shaped
  (the `max(0, 1 + 0.002*df*(...))` factor and the `0.25 + df*0.05` cap do NOT collapse).
- `(0, 7)` is the **spitter-spawner, NOT a worm** (a common misread - `seed=7` is just
  the per-expression x-offset into `random_penalty`).

## Measured facts (the render-relevant ones)

1. **The field is basement-dominated.** `enemy_base_probability` sits at
   `basement_value = -1000` almost everywhere, rising to positive only *inside* base
   spot cones. Measured far grid `[800..1100]^2` stride 20: min `-1000.79`, max
   `0.781`; positive cells cluster into a few spot cones (e.g. `(1000,1040)=0.781`,
   `(1000,1020)=0.621`, `(980,1100)=0.583`).

2. **At `distance_factor = 0` the source reduces to `min(enemy_base_probability, 0.25)`**
   (the `max(0,1+...)` factor = 1, the cap = 0.25). Since `random_penalty` passes a
   `source <= 0` through unchanged, `enemy_autoplace_base(0, *)` == `enemy_base_probability`
   wherever the field is `<= 0.25` (i.e. everywhere except inside spot cones). Inside
   spots the placement prob **caps at 0.25** and is jittered DOWN:

   `enemy_autoplace_base = min(enemy_base_probability, 0.25) - 0.1 * U`, `U in [0,1)`
   the batched `random_penalty` draw (SUBTRACTIVE, not multiplicative). Verified:
   ebp 0.781 -> ap 0.172 (U=0.78), 0.621 -> 0.180 (U=0.70), 0.583 -> 0.233 (U=0.17),
   0.410 -> 0.210 (U=0.40), 0.498 -> 0.181 (U=0.69).

3. **`starting_area_radius = 150`** for the default `starting_area` setting - directly
   sampleable as the named value `starting_area_radius` (it equals the
   `starting_resource_placement_radius` constant). It scales with the `starting_area`
   map setting; only the default (150) is measured. (NB: `starting_area_weight` is a
   DIFFERENT, decreasing expression `1 - min(1, 0.5*tier_from_start)`; do not use it to
   derive the radius. `tier_from_start = max(0, distance - starting_area_radius)/starting_area_radius`
   at `noise-programs.lua:576` also exposes it, but direct sampling is simpler.)

4. **The starting area is clear of bases.** Within +-140 tiles of spawn every sampled
   cell is negative (2D block max ~ -0.9). The `- 0.3` and
   `min(0, 20/150*distance - 20)` terms hold the near-spawn field down; along +x it
   rises from -21.7 (d=0) to -12.0 (d=90), then drops to the -1000 basement at d>=100
   (the origin region's lone marginal spot fades out by ~d=95). Net: no positive
   footprint near spawn, so a `> 0` threshold clears the starting area for free.

## The open RE item: `candidate_point_count`

The enemy `spot_noise` sets `candidate_point_count = 100` and leaves both
`candidate_spot_count` and `suggested_minimum_candidate_point_spacing` at engine
defaults. Every M3 resource `spot_noise` did the opposite (set `candidate_spot_count`
+ explicit spacing, never `candidate_point_count`). `spot-noise-NOTES.md:57` records
"default candidate point count = (region_size/spacing)^2" - i.e. `candidate_point_count`
is the per-region candidate POOL size, `candidate_spot_count` the number selected.

The current `spotSelection.ts` models only `candidateSpotCount` (dart-throw acceptance
target `needed = candidateSpotCount * span`) with a REQUIRED `spacing`, over an
unbounded lazy candidate stream - it has no `candidate_point_count` pool bound and no
notion of a DEFAULT `candidate_spot_count`/spacing. So the enemy field cannot be ported
by "just calling selectSpots"; the `candidate_point_count` + defaulted-`candidate_spot_count`
+ defaulted-spacing path is un-reverse-engineered. This is M4's one genuine RE step
(a preceding oracle spike), NOT a re-run of the validated M3 spot path. Resolve by
matching a region's spot set (trilaterate cone centers from a dense oracle grid, per
`spot-noise-NOTES.md`) against the port for candidate values of the two defaults +
the pool bound.

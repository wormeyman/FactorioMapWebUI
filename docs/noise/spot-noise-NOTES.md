# spot_noise - reverse-engineering notes (in progress)

Source: Factorio 2.1.11 (build 86962), probed headless via `noise-expression`
prototypes read back with `LuaSurface.calculate_tile_properties`. Companion to
`docs/noise/basis-noise-NOTES.md`, which covers `basis_noise` (solved).

`spot_noise` places every ore patch. It is **not solved** - the candidate-point
RNG is still unknown. What follows is what has been measured, so the next attempt
starts here rather than at zero. Community consensus is that this function is
"black magic"; none of the facts below appear to be publicly documented.

## The technique: candidate points are directly observable

Force `spot_noise` to place exactly **one spot** with constant radius/quantity.
The output field is then a single cone, and the cone's apex **is** the candidate
point. Because the cone is linear in distance,

```
|p - c| = radius * (1 - value(p) / peak)
```

every sample gives a circle around the unknown centre `c`, so `c` trilaterates
exactly from the samples around the apex (observed residual 0.0000, giving exact
integer coordinates). This turns a hidden RNG stream into something you can read
off a heightmap.

## Confirmed

- **The cone formula is exact.** Peak height measured 23.8732 for
  quantity=10000, radius=20; `3 * q / (pi * r^2)` = 23.8732. Also 66.3144 vs
  66.3146 predicted at radius=12. Falloff is linear in distance, reaching 0 at
  `radius`.
- **Candidate points are at integer coordinates.** Trilateration residual 0.0000.
- **Regions are CENTRED on multiples of `region_size`**, not aligned to it:
  `region_index = floor((x + region_size/2) / region_size)`. Verified with one
  spot per region over a 5x5-region area: exactly 25 cones, and the indices come
  out one-per-region only for origin -512 (with origin 0, some indices appear
  twice and others none). A window of `[0, region_size)` therefore straddles
  **four** regions - which is why it shows two spots when `candidate_spot_count = 1`.
- **Default candidate point count = `(region_size / spacing)^2`.** The game's own
  default spacing is `45.254833995939045` = `32 * sqrt(2)`, and with
  `region_size = 1024` that is `(1024 / (32*sqrt(2)))^2` = **exactly 512**.
- **Candidate points are spaced, not uniform random.** Min nearest-neighbour
  distance 17.03 over 354 points in a 1024^2 region; uniform-random points would
  give ~1.35. Mean NN 33.4 against the 45.25 spacing parameter. Consistent with
  the docs' "minimum spacing to *try* to achieve" - a Poisson-disk / jittered
  process, not a plain PRNG draw.

## Gotchas (each one cost a run)

- **`maximum_spot_basement_radius = 0` suppresses every spot.** The field comes
  back entirely `basement_value` with no cones at all. This silently defeats any
  probe that sets it to 0 as an apparently harmless default.
- **`hard_region_target_quantity` takes 0/1**, not `true`/`false`. The game's own
  calls in `core/prototypes/noise-functions.lua` pass integers.
- **`skip_offset` must be < `skip_span`.** With `skip_span = 1`, only
  `skip_offset = 0` is legal; anything else hard-crashes the game (see below).
- **`density_expression` is quantity per unit area**, so it is a small number.
  The regional target is `average density * region area`; with `density = 1` and
  `region_size = 1024` the target is 1048576, i.e. ~104 spots of quantity 10000.
- The canonical parameter set to copy is `core/prototypes/noise-functions.lua`
  (`starting_patches` / `regular_patches`) - not the API docs, which do not make
  the above clear.

## The candidate-point cache (a hard crash, and what it reveals)

Probing many `skip_offset` values in one map crashes the game:

```
SpotNoiseCache.cpp:150: this->candidateSpotCount == candidateSpotCount was not true
```

This corroborates the documented claim that the candidate series is shared across
expressions with the same `seed0`, `seed1`, `region_size` and
`suggested_minimum_candidate_point_spacing` - the game caches it on exactly that
key and **asserts** that every expression sharing the key agrees on the count.

Practical consequence: to vary `candidate_spot_count` or `skip_offset` you need
**one headless run per value**. Recovering generation *order* is then a matter of
running `candidate_spot_count = 1, 2, 3, ...` and diffing the resulting cone sets;
the newly-appearing cone is the next point in the series. (Note this must be done
per region - see the region-centring result above, or the diffs will interleave
points from four different regions.)

## Still unknown

- **The candidate-point RNG.** Integer coordinates and Poisson-disk-like spacing
  narrow it a lot, but the generator itself is unidentified. Order can be
  recovered by the diffing method above; that ordered series is the input a
  generator hunt needs.
- How `seed0`/`seed1` seed that RNG - likely entangled with the same open
  question in `basis-noise-NOTES.md`.
- The favourability sort, the regional-target accumulation order, and how
  `hard_region_target_quantity` shrinks the last spot.

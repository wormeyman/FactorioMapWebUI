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

## Candidate RNG - reverse-engineering progress (2026-07-17, v2.1.11)

The ordered candidate series was recovered and attacked. The generator itself is
still not identified, but its *structure* now is, and several published/assumed
facts are disproved. All of the below is measured against 2.1.11 by CRT-combining
runs at region sizes 2048/2050/2058/2066 (pairwise-coprime-ish, product > 2^32)
and cross-checking against 512/1000/1024.

### The coordinate is a 32-bit integer reduced mod the region size

```
world_coord = (V mod region_size) - region_size/2       (V is a 32-bit value)
```

**Proof it is exactly 32-bit:** CRT over the four region runs gives V modulo
~2.23e12, yet every recovered V for 20 candidates x 2 axes lands below 2^32. By
chance that is (2^32 / 2.23e12)^40 ~ 10^-100. So each candidate carries a full
u32 quantity and the region size only enters as a final `mod`. The same V stream
reproduces across *all* region sizes - region_size is not part of the RNG key,
only the reduction.

### The spacing parameter does not consume draws

`suggested_minimum_candidate_point_spacing = 0.001` vs `= 45.25` produce
**identical** candidate values. So the "Poisson-disk" spacing acts later, during
spot *selection*, not during candidate generation. `candidate_spot_count = 1,2,3,
...` therefore walks a single fixed draw stream `V[0], V[1], ...` (x then y per
candidate), and the k-th accepted point is deterministic.

### The stream is NOT GF(2)-linear - kills the whole LFSR family

Berlekamp-Massey linear complexity of every bit-plane of 40 consecutive draws is
~n/2 (18-22 of 40). A small-state F2-linear generator would plateau far below
n/2. **This rules out xorshift / xoshiro / xoroshiro / taus88 / lfsr113 / LFSR /
Mersenne-tempering-style generators** - i.e. the community's "it's black magic /
some LFSR" assumption is wrong. The generator is non-linear (multiply/avalanche).

Also ruled out by direct solve on the 40-draw stream: LCG over 2^32/2^31/2^48/
2^64, PCG-not-attempted-blind, `finalizer(LCG-state)` for finalizer in
{murmur3 fmix32, fmix64, single xorshifts, identity} on interleaved / x-only /
y-only orderings, 64-bit LCG whose (hi,lo) = (Vx,Vy), and Wang hash of the index.
The specific non-linear generator is **still unidentified** (PCG32-XSH-RR is the
natural remaining suspect but was not blind-solved).

### Seeding - partially cracked, and it differs from basis_noise

- **`seed0` bit 0 is ignored.** `0 == 1`, `123456 == 123457`, `2^31 == 2^31+1`
  all give identical candidates.
- **`seed1` fully avalanches** the value: `V[0]` vs `seed1` shows no low-order /
  LCG structure (well-mixed).
- **`seed0`'s low bits (bit >= 1) enter `V` through a GF(2)-affine (XOR-linear)
  bit-scatter.** `seed0 = 48`'s XOR-delta equals `seed0=16` XOR `seed0=32`
  exactly (full 32-bit), and additive combos like `seed0=1234` predict the
  coordinate exactly. Each seed0 bit XORs a fixed spread 32-bit mask into
  `(Vx,Vy)`.
- That seed0 scatter is **`seed1`-independent** (byte-identical masks at seed1=0
  and seed1=5, for bits 1 and 4) but **index-dependent** (bit-1 mask is
  `dVy=0x080` for `V[0]` but `dVx=66` for `V[1]`). So seed0 does *not* separate
  as one global linear term - the linear map is per-candidate. Contrast
  `basis-noise-NOTES.md`, where seed0 low bits below ~384 were *fully ignored*;
  here they are a positional dither. The two primitives seed **differently**.

Net: `V(seed0,seed1,region,index) = NonLinear(seed1,region,index) XOR
L_index(seed0)`, with `L_index` GF(2)-linear in seed0 but varying with index.

### Reproduce / next attempt

Harness in a scratch dir (not committed - exploratory): `run.py` drives one
headless run per `candidate_spot_count`; `extract.py` trilaterates the new cone
per step (min component size 25 to reject grid-edge fragments); CRT combine over
regions 2048/2050/2058/2066. The recovered 20-candidate stream (seed0=123456,
seed1=0) is in `spot-candidate-stream.seed123456.json` alongside these notes.
The open core is the non-linear generator + how `seed1` seeds it - the same hard
step still open for `basis_noise` seeding.

## Still unknown

- **The non-linear candidate-point RNG** (family narrowed to multiply/avalanche;
  PCG32 the leading unconfirmed suspect).
- How `seed1` seeds it (avalanche confirmed, function unknown).
- The favourability sort, the regional-target accumulation order, and how
  `hard_region_target_quantity` shrinks the last spot.

# basis_noise - reverse-engineering notes

Source: Factorio 2.1.11 (build 86962), captured headless via probe
`noise-expression` prototypes read back with `LuaSurface.calculate_tile_properties`.
Reference implementation: `src/noise/basisNoise.ts`. Fixture:
`test/fixtures/basis-noise.seed123456.json`. Tests: `test/basisNoise.spec.ts`.

## The result

```
basis_noise(x, y) = SUM over the 4 cell corners of  (1 - d)^3 * (D . G[h(i,j)])

  D          = (x, y) - corner        (in noise space: world coords * input_scale)
  d          = |D|^2                  (corners with d >= 1 contribute nothing)
  G[h]       = 4.2 * (cos(2*pi*h/256), sin(2*pi*h/256))
  h(i, j)    = a[i & 255] XOR b[j & 255]
  a, b       = per-axis permutations of 0..255
```

Reproduces the game to **max error 3.1e-7** over 512 independent points, at a
different `input_scale` than the tables were measured at. For scale: the game's
own `multioctave_noise{octaves=1}` and `basis_noise` disagree by ~2e-6 (its `pow`
is documented as coming from the fastapprox library), so this is a closer match
than Factorio is to itself.

## Why this shape

[FFF-112](https://factorio.com/blog/post/fff-112) (2015) says: *"Our noise will
have the simple square grid from Perlin noise, the gradient summation idea from
simplex noise and a very cool hash function from 'Better Gradient Noise'."*

All three checked out, 11 years and two noise-system rewrites later:

- **Square grid from Perlin** - integer lattice, 4 corners per cell.
- **Gradient summation from simplex** - contributions are *summed* with a radial
  falloff, not separably interpolated. `(1-d)^3` reaches exactly 0 at `d = 1`,
  which is why integer lattice points return exactly 0 (the documented quirk
  falls out of the kernel; it is not special-cased).
- **Hash from Better Gradient Noise** - Kensler, Knoll & Shirley, SCI Technical
  Report UUSCI-2008-001. The FFF's link is dead; live copy at
  <http://eastfarthing.com/publications/noise.pdf>. Its Section 2 replaces
  Perlin's nested `P[P[i]+j]` with a separate permutation table per dimension,
  XORed: `H_ij = Px[i] ^ Py[j]`, for axial decorrelation.

Note FFF-112 says Wube took **only the hash**, not BGN's 4x4 reconstruction
kernel - and that is measurable: the full BGN kernel gives 0.212 at integer
lattice points where the game gives exactly 0.

## Evidence

| claim | test | result |
| --- | --- | --- |
| kernel is `(1-d)^3` | predict 3000 points using *measured* gradients | max err 3.5e-6; `(1-d)^2/^4/^5` all fail by ~1e0 |
| hash is `a[i] ^ b[j]` | collision `G(i1,j1)=G(i2,j2)` must force `G(i1,j2)=G(i2,j1)` | 162812 pairs, **0 violations** |
| hash group is `(Z/2)^8` | row permutations generate a group | order exactly 256, exactly 8 generators |
| gradient magnitude | direct measurement, 9216 lattice points | 4.19999919 +/- 1.4e-6 |
| 256 uniform directions | angle spacing | exactly 360/256 = 1.40625 deg, std 0.0000 |
| period 256 per axis | `G(k)` vs `G(k+256)` | 0.000e+00 (exact) |
| full model | 512 independent points from tables alone | max err 3.1e-7, corr 1.0000000000 |

## The probing technique

The trick that made this tractable: **near a lattice point every other corner's
falloff vanishes**, so

```
value(c + eps*u) = eps * (u . G[c])   + O(eps^3)
```

which reads gradients straight out of the game, one lattice point at a time. It
works for *any* candidate falloff, since every candidate has `falloff(0) = 1` -
so gradients can be measured **before** knowing the kernel, and the kernel then
solved with gradients held fixed. Two unknowns, separated.

Three traps, all of which cost a run:

- **`MapPosition` is 1/256 fixed-point** (the same fixed-point
  `src/codec/mapExchangeString.ts` decodes for `starting_points`). A world offset
  below 1/256 rounds to zero. An `eps` of 0.001 therefore lands exactly *on* the
  lattice and returns all zeros - which looks like a broken probe but is the game
  being precise. Choose `eps` via `input_scale`: one world tile = `input_scale`
  noise units.
- **Use power-of-two `input_scale`.** Noise coords must be exact in f32. Large
  world coords with a tiny `eps` cause catastrophic cancellation - at
  `input_scale = 1e-3` this inflated the noise floor ~1000x and made distinct
  gradients look continuous.
- **`calculate_tile_properties(property_names, positions)`** - property names
  come first. The HTML docs and `runtime-api.json` list `positions` first, but the
  `order` field (property_names=0) is authoritative.

## Still open: the seeding

How `seed0` / `seed1` generate `a` and `b` is unknown, and is entangled with
`sigma` (the hash -> direction mapping). A uniform gradient *set* does not imply
`G[h]` sits at angle `2*pi*h/256`; assuming that identity gives correlation 0.06.
The three tables here are recovered per-seed from the game and are only
determined up to a gauge - they need not be the game's literal internals, but
they reproduce its output exactly.

`seed0` and `seed1` can both be passed as **literals** in the expression (they do
not have to be `map_seed`), and **arbitrary `property_expression_names` keys are
evaluated by `calculate_tile_properties`** - so many seeds can be probed in a
single headless map. Control: literal `seed0 = 123456` reproduces `seed0 =
map_seed` on a seed-123456 map exactly, so literals are honoured.

Measured facts that any correct theory must explain:

- **Small `seed0` values are indistinguishable.** `seed0` in
  `{0,1,2,3,4,5,6,7,8,12,16,24,32,64,128,256,320}` all produce **bit-identical**
  fields (max|dG| = 0.000000). Every value from 384 up that was tried (384, 448,
  511, 512, 576, 640, 768, 896, 1023, 1024, 2047, 2048) produces a field
  differing in 63-64 of 64 lattice points, with max|dG| ~ 8.3 (i.e. ~2 * 4.2 -
  completely unrelated gradients). So there is a threshold between 320 and 384.
- **It is not a bit mask.** `128 == 0` and `256 == 0`, yet `384 = 128 | 256 != 0`.
  Non-linear, so no "low bits ignored" explanation works.
- **Exact collisions recur at higher seeds**: `512 == 513` and `1024 == 1025`.
- **`seed1` changes the field completely** (0/256 indices equal).
- Ruled out for the seed -> field relation: constant XOR, constant offset mod 256,
  1-D roll of the i axis, and 2-D translation within +/-15 (best 1.2% vs 0.4%
  chance).

## Still open: spot_noise

This does not make map gen reimplementable on its own. `spot_noise` - which
places every ore patch - is untouched and is the harder half: a stateful
region/candidate-point algorithm whose RNG is unknown. Community consensus is
that it is "black magic"; nobody has cracked it publicly.
## Reproducing

The probe harness is not committed (it needs a Factorio install). Recipe: an
isolated `--config` INI with `read-data=__PATH__executable__/../data`, a mod
registering `{ type = "noise-expression", name = "probe", expression =
"basis_noise{x = x, y = y, seed0 = map_seed, seed1 = 0, input_scale = ..., output_scale = 1}" }`,
`--map-gen-settings` pointing `property_expression_names.elevation` at it, and an
`on_init` that calls `calculate_tile_properties` and `helpers.write_file`s the
result. See `docs/mapexchangestrings/maptype-elevation-NOTES.md` for the same
headless setup.

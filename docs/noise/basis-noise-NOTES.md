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

## The seeding - seed0 word SOLVED, seed1 + table-gen still open

Progress 2026-07-17. Two things are now proven; one remains.

### SOLVED: the `seed0` -> taus88 seed word

`basis_noise` seeds the **same L'Ecuyer taus88** that `spot_noise` uses (see
`docs/noise/spot-noise-NOTES.md`), with the **same `0x155` clamp**:

```
word = max(seed0, 0x155)      // 0x155 = 341
s1 = s2 = s3 = word           // then taus88, exactly as spotSeedWord()
```

The difference from spot is only what is combined with `seed0` before the clamp:
spot uses `max((SEED_BASE + 7927*seed1 + ...) ^ seed0, 0x155)`; basis (at
`seed1 = 0`) has **no `SEED_BASE`** - the word is `seed0` itself, clamped.

Two consequences of seeding `s1=s2=s3=word` fall straight out and match every
measurement:

- **`seed0`'s bit 0 is dead** (the taus88 state words drop their low 1/3/4 bits
  on the first step). So `seed0` and `seed0^1` give bit-identical fields:
  `{2k, 2k+1}` always collide. This is the *same* artifact documented for spot in
  `spotCandidates.ts`.
- **`seed0` in `0..341` all clamp to word `341`**, so the whole block is one
  field; `342` is the first untouched value.

Verified exhaustively over `seed0 = 0..351` plus `5000..5005` and
`100000..100003`: the equality classes match `max(seed0 & ~1, 0x155)` with **zero
mismatches** (dense sweep, 12-point field fingerprint per seed).

This resolves the whole old puzzle:

- "`{0..320}` indistinguishable, `384+` differ, threshold between 320 and 384" ->
  the threshold is exactly **341/342** (clamp at `0x155`); 320, 128, 256 are all
  `<= 341` so they clamp to word 341.
- "not a bit mask: `128==0`, `256==0`, `384 = 128|256 != 0`" -> nothing bitwise;
  128 and 256 are just below the clamp, 384 is above it.
- "`512==513`, `1024==1025`" -> the `{2k,2k+1}` bit-0 collisions.
- constant XOR / offset / roll / translation ruled out -> correct: it is a clamp
  plus a dead low bit, none of those.

### Still open: `seed1`, and the taus88 -> (a, b, sigma) table generation

Structure now fully mapped (three seed-dependent permutations, no fixed gradient
table); the generator itself is still unknown.

`seed1` behaves **completely differently** from `seed0`: with `seed0` fixed,
*every* `seed1` value is distinct - no `0..341` clamp block, no `{2k,2k+1}` width-2
(checked `seed1 = 0..341`, `5000..5003`, `100000..100001`). So `seed1` does **not**
seed a taus word the `seed0` way. It also is **not** spot's `7927*seed1` XORed into
the word: `field(seed0=0, seed1=1) != field(seed0=7927, seed1=0)` (and the same
for primes 7919/7907, XOR and ADD). basis has two per-axis tables `a` (x) and `b`
(y); the natural reading is that `seed0` drives one and `seed1` the other, seeded
asymmetrically - but that is not yet pinned.

The generator that turns a taus88 stream into `a`, `b`, `sigma` is unknown.

**`sigma` is seed-dependent - there is NO fixed gradient table.** This was the
natural next assumption (classic gradient noise, incl. BGN, indexes a *fixed*
gradient set - which would make `sigma` shared across seeds and pin it, reducing
`a`/`b` to a 256-way global-XOR search). It is false. Recovering the raw
direction grid `K(i,j)` (physical gradient-direction index, gauge-free) for three
seeds and asking - via a GF(2) linear system - whether **one** permutation `pi`
unscrambles every grid into an XOR-table `pi(K) = f(i) ^ g(j)`: a bijection
survives for each grid alone (nulldim 9 = 8 hash bits + constant) but the joint
solution **collapses to the constant** (`classes = 1/256`) for all three pairs,
including two seeds that share `seed1 = 0`. Method self-validated: synthetic grids
built with a *shared* sigma stay fully separable (256/256), with *different* sigma
collapse. So basis generates **three** seed-dependent permutations (`a`, `b`,
`sigma`) per seed; even `seed0` alone changes all three.

Generative reconstruction (generate candidate `a,b,sigma` from taus88 and require
the predicted integer grid `sigma[a[i]^b[j]]` to match the measured grid
**exactly** - no gauge freedom this way) was run hard and **all fail** (best ~15
of 2304 cells, random baseline 9): Durstenfeld and high-bit (`(draw*(i+1))>>32`)
and byte-stream Fisher-Yates and argsort-by-key, ascending/descending, all six
{a,b,sigma} orderings, warmups 0..16, one shared `taus88(word)` stream vs three
separate streams (`word(seed0)`, `word(seed1)`, `word(seed0^seed1)`,
`word(seed0+seed1)`). So the table build is **not** a textbook shuffle off a
`taus88` stream. Likely needs Factorio's actual gradient-permutation code (binary
RE) or a fundamentally different generator. The fixture's `a`/`b` starting
`0,1,2,4,8,16,32,...` are a **gauge-fixed** recovery (they expose the GF(2)^8 hash
structure), not the game's raw tables - so table-level matching is a dead end; the
exact **integer direction grid** is the right oracle (denser and stricter than the
float field, and gauge-free for generative tests).

### Reproducing this leg

Rebuilt the headless oracle in a scratch dir (`oracle.py`): register one
`noise-expression` per candidate seed, route each onto its own
`property_expression_names` key, read them all at fixed non-lattice points with
`calculate_tile_properties` in `on_init`, `error("DUMPED-OK")` to exit. ~1.7 s per
run, dozens of seeds per run. Equality of the 12-point field fingerprint is the
discriminator; there were no non-contiguous fingerprint collisions, so the
running distinct-field count is a faithful `m(seed0)`.

**Raw direction-grid recovery** (the gauge-free oracle). With `input_scale = 1`,
noise coord == world coord. Near lattice point `(I,J)`, `value(I+eps, J) ~= C *
cos(2*pi*K/256)` and `value(I, J+eps) ~= C * sin(2*pi*K/256)`, so
`K(I,J) = round(atan2(vy,vx)/(2*pi)*256) mod 256` is the physical direction index.
`eps = 1/256` is exact in f32 for `I,J <= 255` (no cancellation) and isolates the
`(I,J)` corner (the other three sit at `d ~= 1`, falloff `(1-d)^3 ~= 0`). Verified
0/2304 against the fixture. Two probes per lattice point; a 48x48 grid is one run.

## spot_noise - SOLVED (see spot-noise-NOTES.md)

`spot_noise` - which places every ore patch, long called "black magic" - was
cracked on 2026-07-17: taus88 candidate RNG + a dart-throw selection phase. Full
write-up in `docs/noise/spot-noise-NOTES.md`; implementations in
`src/noise/spotCandidates.ts` and `src/noise/spotSelection.ts`. The `0x155` clamp
and `s1=s2=s3=word` seeding proven there are what identified basis's `seed0` word
above.
## Reproducing

The probe harness is not committed (it needs a Factorio install). Recipe: an
isolated `--config` INI with `read-data=__PATH__executable__/../data`, a mod
registering `{ type = "noise-expression", name = "probe", expression =
"basis_noise{x = x, y = y, seed0 = map_seed, seed1 = 0, input_scale = ..., output_scale = 1}" }`,
`--map-gen-settings` pointing `property_expression_names.elevation` at it, and an
`on_init` that calls `calculate_tile_properties` and `helpers.write_file`s the
result. See `docs/mapexchangestrings/maptype-elevation-NOTES.md` for the same
headless setup.

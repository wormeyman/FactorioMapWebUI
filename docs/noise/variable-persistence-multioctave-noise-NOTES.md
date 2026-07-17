# variable_persistence_multioctave_noise - reverse-engineering notes

Source: Factorio 2.1.11 (build 86962), cracked by disassembling the op's register
program `NoiseOperations::VariablePersistenceMultioctaveNoise::run` (@0x10174a318)
in the non-stripped shipped Mach-O and fitting the committed oracle (`test/oracle/`).
Reference implementation: `src/noise/variablePersistenceMultioctaveNoise.ts`.
Fixture: `test/fixtures/oracle-variable-persistence-multioctave.seed123456.json`.
Test: `test/variablePersistenceMultioctaveNoise.spec.ts`. Companion to
`multioctave-noise-NOTES.md`, `quick-multioctave-noise-NOTES.md`,
`basis-noise-NOTES.md`, `spot-noise-NOTES.md`.

This is the op the **elevation** tree uses (nauvis `make_0_12like_lakes`). Its
defining feature: `persistence` is a spatially-varying value - a noise *expression*
the game evaluates per tile - so successive octaves are attenuated by a persistence
that changes across the map.

## The result

```
varPers(x, y) = output_scale * 2^N * SUM_{k=0}^{N-1} p^(N-1-k) *
                basis( (x + offset_x)*S_k + k*OCTAVE_SHIFT , y*S_k ;
                       tables(seed0, seed1) )

  N            = octaves
  S_k          = input_scale * 0.5^(k+1)     (finest octave scale = input_scale/2)
  p            = persistence at this tile
  OCTAVE_SHIFT = -7936   (= -0x1F00; fixed per-octave x shift in NOISE space)
  basis        = basis_noise with tables from (seed0, seed1)  [basis-noise-NOTES.md]
```

So: **N octaves of `basis_noise` sharing ONE (seed0, seed1)**. Each octave halves
the input scale (lacunarity 1/2) and is weighted by a power of the per-tile
persistence, combined in Horner order - finest octave (k=0) gets the smallest
weight `p^(N-1)`, coarsest (k=N-1) gets `1`. The whole sum is scaled by
`output_scale * 2^N`. Verified to the basis floor (~3e-7) in a realistic window,
growing to ~2e-3 at large `offset_x` / far points (the f32 floor, amplified by the
`2^N` gain).

Three things distinguish it from the plain / quick relatives:

1. **No RMS normalisation.** It is the raw weighted sum times a `2^N` gain. The
   `amplitude_corrected_multioctave_noise` Lua wrapper is what normalises, by
   passing `output_scale = (1 - p)/2^N/(1 - p^N) * amplitude`. (The
   `sqrt((p^2-1)/(p^(2N)-1))` RMS branch that *is* present in the
   `Noise::multioctaveNoise(...,float const*,...)` float overload @0x101734884 is a
   **different entry point**; the register `run` path @0x10174a318 that
   `calculate_tile_properties` - and thus the oracle - executes has none. The
   oracle is ground truth, so: no norm.)
2. **`offset_x` is a single world-space x translation** `(x + offset_x)*scale`,
   applied identically to every octave - like `quick_multioctave_noise`, NOT the
   plain op's per-octave `k*17.17/offset_x` shift.
3. **Octaves decorrelate by a fixed per-octave x shift** `k*(-7936)` in noise space,
   NOT by re-seeding - the seed is shared across octaves (confirmed with seed1=999,
   256). The quick op's seed-phase reseed trick does not apply here.

## Why these pieces (the disassembly)

`VariablePersistenceMultioctaveNoise::run` builds a register program: an initial
input scale (`s8`, halved each octave via `fmov s9,#0.5; fmul s8,s8,s9`), an octave
count, and per octave a `Noise::noise` (one basis octave) whose output accumulates
into an output register. Between octaves the output register is multiplied
element-wise by the **persistence register** (`fmul v.4s, v.4s, v.4s` over the
per-tile buffer) - Horner: `out = out*p + basis_k`. The final octave multiplies by
a scalar constant (`output_scale * 2^N`) instead of the persistence buffer. The
loop passes the SAME seeds/offset constants every octave (only the scale changes),
which is why octaves share a seed and the only per-octave x change is the fixed
shift. The float overload @0x101734884 shows the same Horner + the (unused-here)
RMS-norm tail, and its per-octave x term uses the `0x40312b8551ec1eb8 = 17.17000305`
double - the same core constant as the plain op.

## How the constants were pinned (oracle fitting)

Structure from the disassembly; numbers from the oracle. The op's `persistence`
must be a genuine expression (a **constant** persistence hits a degenerate compile
path), so the fit routes an expression persistence onto elevation AND captures that
persistence field separately (route the same expression onto elevation), then fits
with the per-tile `p_i`. Decisive experiments:

| claim | test | result |
| --- | --- | --- |
| octaves=1 == 2*basis at IS/2 | N=1, offset_x=0 | `2*basis(x*IS/2)`, floor (1.8e-7) |
| output_scale linear | ratio at os=3 | 3.00000 |
| no normalisation | N=2 free fit, norm on vs off | norm OFF wins to floor; norm ON res 0.22 |
| gain = 2^N | fitted C at N=1..6 | 2, 4, 8, 16, 32, 64 |
| lacunarity 1/2, weight p^(N-1-k) | N=2 fit: octave-1 scale + weight | S_1=IS/4, Horner `[p,1]`, floor |
| per-octave shift = k*(-7936) | wide U scan, N=2..4 | -7936 exactly, res floor |
| shift is input-scale-independent | same fit at IS in {1/8,1/16,1/64} | -7936 all three |
| shift is seed-independent | seed1=999 | -7936 |
| offset_x = world translation | N=1 offset_x=5000 | `(x+offset_x)*(IS/2)`, floor (2.2e-7) |

The trap that cost the most time (same as the plain op): a **narrow** offset scan
finds false minima (got -4864 at +-4000, -3840 at +-4000); the true `-7936` only
holds up under a wide scan and is the one that is input-scale-, seed-, offset_x- and
persistence-independent. Scan wide and cross-check independence.

## The f32 floor

Same story as the other multioctave ops (see `multioctave-noise-NOTES.md`). The
game computes each octave's coordinate in f32; we use f64. The coarse octaves'
fixed shift `k*(-7936)` and a large climate-scale `offset_x` (e.g. 40000) push the
sampled coordinate to tens of thousands of noise units, where an f64-vs-f32
coordinate difference can land in a different basis lattice cell. The `2^N` gain
then amplifies it, so far-field error reaches ~2e-3 at 5 octaves - still invisible
in a downsampled preview, where a pixel is many tiles.

## amplitude_corrected_multioctave_noise (the wrapper)

`core/prototypes/noise-functions.lua` defines it as a thin wrapper over this op:

```
variable_persistence_multioctave_noise{
  input_scale  = input_scale,
  output_scale = (1 - persistence) / 2^octaves / (1 - persistence^octaves) * amplitude,
  offset_x = offset_x, octaves = octaves, persistence = persistence }
```

i.e. it just chooses `output_scale` to normalise the op's `2^N`-gained geometric
sum to the requested `amplitude` (note the `1 - p^N` -> geometric-series sum, and
the `/2^N` cancelling the op's gain). A `p == 1` guard (0/0) belongs in the wrapper
port, not the primitive. Port it once this primitive ships - no new RE needed.

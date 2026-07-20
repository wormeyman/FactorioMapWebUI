# quick_multioctave_noise - reverse-engineering notes

Source: Factorio 2.1.11 (build 86962), cracked by disassembling
`NoiseExpressions::QuickMultioctaveNoise::run` in the non-stripped shipped Mach-O
and fitting the committed oracle (`test/oracle/`). Reference implementation:
`src/noise/quickMultioctaveNoise.ts`. Fixture:
`test/fixtures/oracle-quick-multioctave.seed123456.json`. Test:
`test/quickMultioctaveNoise.spec.ts`. Companion to `multioctave-noise-NOTES.md`,
`basis-noise-NOTES.md`, `spot-noise-NOTES.md`.

This is the op the **temperature / moisture / aux** climate trees use (each passes
`offset_x = <big> / var('control:<name>:frequency')`), so it is the M2 climate
primitive. It is a distinct op from the plain `multioctave_noise` -
`QuickMultioctaveNoise` (10 constants: seed0, seed1, input_scale, output_scale,
octaves, octave_output_scale_multiplier, octave_input_scale_multiplier, offset_x,
plus x/y register refs).

## The result

```
quick(x, y) = SUM_{k=0}^{N-1}  OS * OOSM^k *
              basis( (x + offset_x) * IS*OISM^k ,  y * IS*OISM^k ;
                     tables( octaveSeed0(seed0, seed1, k) , seed1 ) )

  N     = octaves
  IS    = input_scale                            OS   = output_scale
  OISM  = octave_input_scale_multiplier          OOSM = octave_output_scale_multiplier
  offset_x = world-space x translation, SAME for every octave
```

So: **N octaves of `basis_noise`, each octave scaling its input by `OISM` and its
output contribution by `OOSM`**, with three things that make it "quick" and unlike
the plain op:

1. **No RMS normalisation.** It is the raw weighted sum. The
   `quick_multioctave_noise_persistence` Lua wrapper
   (`core/prototypes/noise-functions.lua`) is what normalises, by pre-scaling
   `input_scale *= OISM^(N-1)` and `output_scale *= 2^(N-1)` before the call.
2. **`offset_x` is a single world-space translation**, applied identically to every
   octave: the sampled x is `(x + offset_x) * scale_k`. This is NOT the plain /
   variable-persistence op's per-octave `k * 17.17000305 / offset_x` shift. (Basis's
   own `offset_x` param works the same way - `(x + offset_x) * input_scale` - see the
   decoratives, which pass `offset_x = seed`.)
3. **Octaves are decorrelated by re-seeding, not by an x shift.** The basis seed word
   steps by +2 every *pair* of octaves - see below.

At the compile level (`QuickMultioctaveNoise::run` is a register-program builder, not
a runtime loop) the op emits N explicit `BasisNoise` ops, multiplying the running
input scale (`s8 *= s12`) and output scale (`s9 *= s13`) per octave and advancing a
seed accumulator (`w21 += w28`). "Quick" = the octaves are unrolled at compile time.

Verified against the game to the basis floor (~1e-6) for small sampled coordinates,
loosening to ~3e-3 where a large `offset_x` (e.g. temperature's 40000) or a far world
point pushes the sampled coordinate to thousands of noise units - the documented f32
floor (see `basis-noise-NOTES.md` / `multioctave-noise-NOTES.md`), invisible in a
downsampled preview. Across octaves 1..6, both per-octave multipliers, offset_x in
{0, 12000, 40000}, several input/output scales and seven seed1 values.

## The per-octave seed (the whole subtlety)

Octaves pair up: the basis **seed word** steps by +2 every two octaves, so octaves
0,1 share a word, 2,3 the next, etc. Decorrelation between the two octaves of a pair
comes purely from their different input scales.

The seed word Factorio actually hashes is `seed0 + 7*(seed1>>8)` (see
`basisNoiseTablesFromSeed` in `basis-noise-NOTES.md`); the per-octave +2 lands on that
*combined* word, and the parity of the `7*(seed1>>8)` part shifts which octave of each
pair the +2 falls on. Writing `phase = (7*(seed1>>8)) & 1`, the `seed0` we pass to
`basisNoiseTablesFromSeed` for octave k is:

```
seed0_k = seed0 - phase + 2*floor((k + phase) / 2)
```

- **phase 0** (all `seed1 < 256`, i.e. every base-game quick usage - seed1 = 5,6,7,123):
  reduces to `seed0 + 2*floor(k/2)` -> word offsets 0,0,2,2,4,4,...
- **phase 1** (e.g. seed1 = 999, where `7*(seed1>>8) = 21` is odd): `-1,1,1,3,3,5,...`

Pinned by capturing `quick_multioctave_noise` at `octave_input_scale_multiplier = 1`
and `octave_output_scale_multiplier = 1` (all octaves identical scale/amplitude), so
each octave's contribution is a bare `basis` at one scale; the prefix-sum
differences `quick(N+1) - quick(N)` then isolate octave N, whose seed-word offset the
oracle reads directly. Confirmed for phase 0 (seed1 = 137, 42, 7, 512) and phase 1
(seed1 = 999, 256, 300).

## How the pieces were pinned (oracle fitting)

Structure from the disassembly; numbers from the oracle. The decisive experiments:

| claim | test | result |
| --- | --- | --- |
| octave 0 == basis | 1 octave, offset_x=0 | `OS*basis(x*IS)`, floor |
| `offset_x` world-space | 1 octave, offset_x=25000 | `(x+off)*IS`, floor |
| OISM/OOSM per-octave | 2 octaves, distinct multipliers | scale*=OISM, amp*=OOSM, floor |
| octaves 0,1 share a seed | `OISM=OOSM=1`, 2 octaves | `2*basis`, floor |
| seed word +2 per pair | `OISM=OOSM=1`, octaves 1..6, diff | 0,0,2,2,4,4 (phase 0) |
| phase from `7*(seed1>>8)&1` | same, seed1 with odd `7*(seed1>>8)` | `-phase + 2*floor((k+phase)/2)` |
| no normalisation | 1 octave == basis exactly (floor) | norm == 1 |

The trap that cost the most time: assuming `quick(N)` differences cleanly *and* that
the per-octave seed is a plain `2*floor(k/2)`. It is a prefix sum (no norm, so
`quick(N+1) - quick(N)` is exactly octave N), but the seed rule's phase term only
shows up once you test a `seed1 >= 256` whose `7*(seed1>>8)` is odd - every small
seed1 masks it. See the seed section above.

## Still open

`quick_multioctave_noise_persistence` (`noise-functions.lua`) is a thin Lua wrapper
over this op (pre-scaling input/output scale and mapping persistence ->
`octave_output_scale_multiplier`); it needs no new RE, just porting the wrapper. The
`variable_persistence_multioctave_noise` op (used by the elevation tree) is a
*different* primitive - see `multioctave-noise-NOTES.md` "Still open".

## Correction (2026-07-19, M2 Task 10): the "+2 per pair" rule was a masked over-fit

The "per-octave seed" section above (`seed0_k = seed0 - phase + 2*floor((k +
phase) / 2)`, i.e. the basis seed word stepping by +2 every *pair* of octaves)
is **wrong** - or more precisely, it is numerically indistinguishable from the
truth for every seed this doc's own oracle captures ever used, which is why it
went undetected for as long as it did.

The actual rule is a flat **`seed0_k = seed0 + k`** - a distinct basis seed
word for every single octave, no pairing at all.

**Why the old rule looked right:** `taus88`'s `s1` state update masks its input
with `& 0xfffffffe` (clears the low bit) before the first left-shift. That
means `basisNoiseTablesFromSeed(W)` and `basisNoiseTablesFromSeed(W + 1)`
produce byte-identical tables whenever `W` is **even** - the odd successor's
low bit gets thrown away before it can affect anything. So for an even base
word, "+1 every octave" and "+2 every pair" agree exactly: octaves 0 and 1
both hash to the same table either way (`W` and `W+1` collide), and so do
octaves 2 and 3, etc. Every fixture and hand-derived experiment in the
sections above used `seed0 = 123456`, which is even - so the pairing artifact
was baked into every oracle capture and never had a chance to show up.

**What exposed it:** Task 10's tile-resolver parity test exercises the
temperature/moisture/aux trees at three seeds, one of them **odd - 654321**.
For an odd base word, `W` and `W+1` are genuinely different tables (no
low-bit collision), so "+2 per pair" and "+1 per octave" diverge starting at
octave 1. Per-octave isolation against the live game (sampling
`quick_multioctave_noise` at `octaves = 1..4` and differencing consecutive
results, the same prefix-sum trick used above) showed octave 0 and 2 matching
the old formula but octaves 1 and 3 off by roughly 0.02-0.05 - precisely the
two octaves the old formula reused an even-derived word for, when the true
per-octave word for an odd `seed0` is one higher and does not collide.

The flat `seed0 + k` reproduces the live game to the basis floor at both
parities, and is bit-identical to the old formula's output at the historical
`seed0 = 123456` fixture (including its one `phase >= 1` case, `seed1 =
999`) - so nothing in this document's existing oracle evidence is
contradicted, it was just never sufficient to distinguish the two rules. See
`src/noise/quickMultioctaveNoise.ts`'s `octaveSeed0` doc for the code-level
version of this note.

This is left in place above (not deleted) as a worked example of how an
even/odd-masking RNG detail can hide a wrong derivation behind a coincidence -
worth remembering the next time a new op is pinned against a single seed
fixture.

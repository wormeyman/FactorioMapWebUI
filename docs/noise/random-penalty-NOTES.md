# random_penalty - reverse-engineering notes

Source: Factorio 2.1.11 (build 86962). Solved 2026-07-19 by disassembling the
non-stripped shipped executable (`NoiseOperations::RandomPenalty::run`,
`RandomPenalty.cpp`) and confirming against the headless oracle. Companion to
`basis-noise-NOTES.md` and `spot-noise-NOTES.md`; `random_penalty` is the same RNG
family (canonical L'Ecuyer taus88, base `0x3FBE2C`, primes 7919/7907, the 341
clamp).

Implementation: `src/noise/randomPenalty.ts`. Fixture:
`test/fixtures/oracle-random-penalty.seed123456.json`. Spec: `test/randomPenalty.spec.ts`.

## The primitive

`random_penalty{x, y, seed, source, amplitude}` subtracts a per-draw uniform
penalty from `source`:

```
output = source - amplitude * U          # U = taus88_output / 2^32,  U in [0,1)
```

Wrappers (`core/prototypes/noise-functions.lua`):

- `random_penalty_at(v, seed)` = `random_penalty{source = v, amplitude = v}`
- `random_penalty_between(from, to, seed)` = `random_penalty{source = to, amplitude = to - from}`
  (so the result lies in `[from, to]`)
- `random_penalty_inverse(seed, penalty)` = `random_penalty{source = 1, amplitude = 1/penalty}`
- `1 - random_penalty{... source = 1 ...}` appears directly too.

## It is a BATCH op (the important, non-obvious part)

`run(NoiseCache&)` evaluates a whole batch of query positions at once, and the RNG
state is **not** re-derived per tile:

1. **Seeded once, from the FIRST position in the batch:**

   ```
   word = max(341, 0x3FBE2C + 7919 * trunc(x0) + 7907 * trunc(y0 + seed))     (u32)
   ```

   - `x0, y0` are the coordinates of `positions[0]` only.
   - `trunc` is `fcvtzs` (truncate toward zero). `seed` (a constant) is folded into
     `y` (`y0 + seed`) *before* truncation.
   - **No `map_seed` dependence** - unlike `basis_noise`/`spot_noise`, there is no
     `seed0` XOR. Confirmed: varying the map seed leaves the values unchanged.
   - taus88 state `s1 = s2 = s3 = word` (the shared `src/noise/taus88.ts`).

2. **Streamed across the batch, LAST element to FIRST.** The op's loop index counts
   down, so `positions[N-1]` gets taus draw 0 and `positions[0]` gets the last draw.

3. **`source <= 0` passes through and consumes NO draw** (the documented "source
   must be > 0"). The tile outputs its `source` unchanged and the stream does not
   advance for it.

Because of (1) and (2), the value at a given `(x, y)` depends on the entire batch
and its order. A bare `calculate_tile_properties` probe of `random_penalty` is
therefore **not** a faithful per-tile oracle in isolation (same lesson as M2's
`get_tile` vs `calculate_tile_properties`): the oracle returns whatever the batch
produced, seeded from the batch's first point. The RE'd model reproduces measured
oracle batches exactly (3 batches + 2 singletons, plus the committed 5-config
fixture, to the f32 floor).

## The disassembly

```
lldb -b -o "disassemble --name '_ZNK15NoiseOperations13RandomPenalty3runER10NoiseCache'" "$FACTORIO_BIN"
```

lldb disassembles by mangled symbol name and annotates source lines - the fastest
oracle here (objdump's `--start-address/--stop-address` are broken on this Mach-O,
as noted in `noise-oracle-basis-measurements`). Key instructions:

- `w24 = 0x3FBE2C`; `madd w9, x_int, #7919, w24`; `mul w10, y_int, #7907`;
  `add w9, w10, w9` - the word, primes matching spot_noise.
- `fadd s0, y, ucvtf(seed_const)` before `fcvtzs` - `seed` folded into `y`.
- `cmp w9, #0x155; csel w9, w9, #341, hi` - unsigned clamp to >= 341.
- `dup.2s v0, w9` + scalar `w9` - taus88 state seeded to the word (2 lanes + scalar).
- loop: `fcmp source, #0.0; b.ls skip` (source<=0 guard); taus88 update (the
  `eor/ushl/bfxil` block, params 13/19/12, 2/25/4, 3/11/17 - canonical taus88);
  `ucvtf` the u32 draw, `* -2^-32` (`mov x12, #-0x4210000000000000`), `* amplitude`
  (`[x19,#0x1c]`), `+ source`.
- Op register/constant layout: out `+0x8`, x `+0xc`, y `+0x10`, source `+0x14`,
  seed const `+0x18`, amplitude const `+0x1c` (matches `ComplexExpression<...,3,2,0>`:
  3 register inputs + 2 constants).

## Open for M3 (composition, not the primitive)

The primitive is fully solved. What M3a/M3b must still pin empirically is **how the
game batches `random_penalty` inside the spot expressions** - `spot_quantity`
(`random_penalty_between(0.25, 2, 1) * ...`) and `spot_favorability`
(`... + random_penalty_at(0.5, 1)`) are evaluated at spot positions during spot
selection, so the batch = the spot list and the order = the game's spot-evaluation
order. That order determines each spot's `U`, and thus which spots survive the trim.
Determine it against the probability/richness oracle when wiring
`resource_autoplace_all_patches`.

# M3 resources - session handoff (2026-07-19, late)

Paste-ready context for resuming in a fresh session. Working branch:
**`feat/m3-resources`** (off `main`). This doc is maintained live; the durable RE
finding also lives in `docs/noise/random-penalty-NOTES.md`.

## Where we are

Milestone 3 = client-side resource patch overlay. Brainstormed + spec'd. The first
spike (`random_penalty`) is **DONE, tested, and committed** on `feat/m3-resources`.
Next session starts at **writing-plans for M3a** (regular patches).

### DONE this session (committed on feat/m3-resources)
- Spec (commit aee1ef8).
- `random_penalty` spike (next commit): `src/noise/randomPenalty.ts`,
  `test/randomPenalty.spec.ts` (6 tests, oracle-validated < 1e-6),
  `test/fixtures/oracle-random-penalty.seed123456.json`, `captureRandomPenalty` in
  `test/oracle/capture.ts`, and `docs/noise/random-penalty-NOTES.md`. Full suite
  632/632 green, `pnpm vp check` clean.

### M3a plan WRITTEN: `docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md`
10 tasks (catalog -> math -> oracle -> core field -> resolve -> controls -> render
-> worker -> UI -> eyeball). The ONE risk is isolated to **Task 4**: how the game
batches `random_penalty` when evaluating spot quantities in selection. Task 3
captures a pure-regular oracle (probe with `has_starting_area_placement=0`,
`regular_patch_set_count=1`) so Task 4's composition cannot pass wrong. Primary
hypothesis: singleton-per-spot (U = draw0 seeded from the spot's own x,y, fits
selectSpots' per-spot closure); fallback = batch all region spots. Resolve against
the oracle in Task 4, record the winner in random-penalty-NOTES.md.

### NEXT / IN PROGRESS
Executing M3a task-by-task on `feat/m3-resources` (see the plan). Progress tracked
below as tasks land.

## Decisions locked (in the spec)

Spec: `docs/superpowers/specs/2026-07-19-milestone3-resources-design.md` (committed,
aee1ef8). Key decisions:

- **Full scope, all 6 resources** (iron/copper/coal/stone/uranium/crude-oil),
  regular + starting patches.
- **Oracle-validate probability + richness** point-by-point (M2 rigor).
- **Solid-footprint render**: opaque where `clamp(probability,0,1) >= 0.5`.
- **Order-priority overlap** (order "b" beats "c"; game-faithful), not richest-wins.
- **Single worker render pass** (`view: "resources"`), one overlay toggle (no
  per-resource checkboxes).
- **Per-tile placement roll (stipple) deferred to M3.5** (needs a separate,
  un-RE'd entity-placement RNG).
- **Sequencing**: (0) random_penalty spike FIRST -> (M3a) regular patches ->
  (M3b) starting patches. Split into two build plans, not one.

## Spike status: random_penalty - SOLVED

Reverse-engineered from the non-stripped Factorio 2.1.11 binary via
`lldb -b -o "disassemble --name '_ZNK15NoiseOperations13RandomPenalty3runER10NoiseCache'"`
(lldb disassembles by mangled name WITH source-line annotations - the fastest
oracle here; objdump range flags are broken, as the memory notes warned).

**The algorithm** (`NoiseOperations::RandomPenalty::run`, RandomPenalty.cpp):

```
output[i] = source[i] - amplitude * (taus88_next() / 2^32)      // U in [0,1)
```

- **word = max(341, 0x3FBE2C + 7919*trunc(x0) + 7907*trunc(y0 + seed))**  (u32 math)
  - Same RNG family/constants as spot_noise (base 0x3FBE2C, primes 7919/7907, 341
    clamp). NO map_seed dependence. `seed` is folded into y (y+seed) BEFORE trunc.
  - `trunc` = fcvtzs (toward zero). x0,y0 = the **first batch position** only.
- taus88 state s1=s2=s3=word (the exact taus88 already in `src/noise/spotSelection.ts`).
- **Batch semantics**: it is a BATCH op. Seeded once from position[0], then the
  taus88 stream is consumed across the batch, **processed last element -> first**
  (index counts down). `source <= 0` outputs source unchanged and consumes NO draw
  ("source must be > 0" guard).
- This batch/order dependence is real (verified: same tile gives different U in
  different batches), so **a bare `calculate_tile_properties` probe is NOT a
  faithful per-tile oracle** for random_penalty in isolation - same lesson as M2's
  get_tile. It matters for how the primitive composes inside spot expressions.

**Verified**: `src/noise/randomPenalty.ts` reproduces the game's values to < 1e-6
(oracle fixture, 5 configs incl. odd seeds + the source<=0 guard). Scratch verifier
already deleted.

Wrappers (`core/prototypes/noise-functions.lua`):
- `random_penalty_at(v, seed)` = random_penalty{source=v, amplitude=v}
- `random_penalty_between(from, to, seed)` = random_penalty{source=to, amplitude=to-from}
- `random_penalty_inverse(seed, penalty)` = random_penalty{source=1, amplitude=1/penalty}
- `1 - random_penalty{...}` shows up too. NB comment: "source must be > 0".

## Spike follow-through - all DONE (see "NEXT" at top for what remains)

randomPenalty.ts built (reuses shared `src/noise/taus88.ts`), fixture captured,
spec green, notes written, scratch deleted, ready to commit. The remaining M3 work
is the two build plans (M3a regular, M3b starting) - start at writing-plans for M3a.

## Ground truth / recipes

- Factorio bin present: `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio` (non-stripped, has NoiseOperations symbols).
- Game data dump: `~/Downloads/factorio 4/data` (resources.lua, noise-functions.lua, resource-autoplace.lua). API JSON: `~/Downloads/factorioluaapi/`.
- Oracle harness: `test/oracle/oracle.ts` (`sampleExpression`), captures via `node --experimental-strip-types test/oracle/capture.ts`.
- Disasm a symbol: `lldb -b -o "disassemble --name '<mangled>'" "$BIN"`.
- Tests: `pnpm vp test`, single `pnpm vp test test/<f>.spec.ts`, lint `pnpm vp check --fix`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: <url>`. Hyphens, not em/en dashes. Commit/push only when Eric asks.

## Per-resource params (from resources.lua) - for M3a/M3b

All share seed1=100 (default), region_size=1024 (regular). Skip mechanism: the 6
share ONE candidate stream, partitioned by skip_span=6 / skip_offset=patch_set_index
(init order: iron0 copper1 coal2 stone3 crude-oil4 uranium5). Starting set: only
iron/copper/coal/stone, region_size=240, skip_span=4.

| resource | base_density | reg_rq_mult | start_rq_mult | cand_spot_count | notes |
|---|---|---|---|---|---|
| iron-ore | 10 | 1.10 | 1.5 | 22 | order b, starting yes |
| copper-ore | 8 | 1.10 | 1.2 | 22 | order b, starting yes |
| coal | 8 | 1.0 | 1.1 | 21(def) | order b, starting yes |
| stone | 4 | 1.0 | 1.1 | 21(def) | order b, starting yes |
| uranium-ore | 0.9 | 1 | - | 21(def) | order c, base_spots_per_km2=1.25, spot_size 2..4, NO starting |
| crude-oil | 8.2 | 1 | - | 21(def) | order c, base_spots_per_km2=1.8, random_probability=1/48, additional_richness=220000, spot_size 1..1, NO starting |

map_color (0-255 scale in render): iron {106,134,148}, copper {205,99,55}, coal {0,0,0},
stone {176,156,109}, uranium {0,179,0}, crude-oil {199,51,196}. (Cross-check byte-exact.)

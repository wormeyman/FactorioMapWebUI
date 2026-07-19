# Faithful near-spawn starting lakes (`starting_lake_positions`)

Date: 2026-07-18
Status: design (approved for planning)
Follows: `2026-07-18-m1-elevation-lakes-preview-design.md` (M1)

## Problem

M1 ported the `elevation_lakes` tree and renders it client-side, but with
`startingLakePositions = []`. That is faithful only in the far field, where the
game's own `starting_lake_distance` saturates at its 1024 cap. Near spawn the game
places real starting lakes, so the client render is missing the near-origin
coastline the player actually sees. See M1's "Two distance regimes" analysis.

The API mirror is explicit that this is recoverable, not runtime-random:

> `starting_lake_positions (MapPositionList): calculated from starting positions
> and map seed`

So the positions are a pure, deterministic function of `(starting_positions,
map_seed)` with **no dependency on the elevation field** - there is no
chicken-and-egg. Recovering that function makes the near-spawn render faithful for
any seed while staying fully offline.

## Scope

In scope:

- Recover `MapGenSettings::getStartingLakePositions()` and port it to TS.
- Feed the computed positions into the existing `renderElevation` pipeline.
- Cross-validate against a headless-Factorio oracle dump.

Out of scope (unchanged from M1): the larger `elevation_nauvis` tree, graded
elevation shading (still a binary water/land mask), and per-pixel table-rebuild
perf (spec deferral N6).

## What the disassembly already tells us (feasibility)

`MapGenSettings::getStartingLakePositions() const` is a single non-stripped
function, arm64 `0x10160a2fc`-`0x10160a710` (x86_64 `0x101736b10`-`0x101736f40`,
~1072 bytes). Read off the arm64 disasm prologue and head:

- Reads the `starting_positions` vector at `MapGenSettings+0x58` (begin/end
  pointers `x24`/`x23`); computes count and allocates an output vector proportional
  to the input count (`operator new`). So it emits lake position(s) per starting
  position and returns empty when there are no starting positions.
- Seeds the RNG with the pattern already reverse-engineered in this repo:
  `word = max(settings.seed [+0x4c], 0x155)` - the taus88 seeding from
  `basisNoiseTablesFromSeed` / `spotCandidates`. **The RNG is already ported here;
  this is not a from-scratch crack.**
- Loads `0x401921FB54442D18` (= 2*pi) and `0x3B800000` (= 1/256 as f32), with heavy
  d8-d15 register saves - i.e. polar placement (angle + radius) quantized to the
  `/256` fixed point that `distanceFromNearestPoint` already uses.
- May call the sibling `StartingAreaDistribution` helpers (`::operator()`,
  `::isSeparatedEnough`, `::reduceMinDistance`) also present as named symbols;
  Task 0 determines whether they are on the lake path or only the spawn path.

This is a moderate, tractable function reusing machinery we have solved before -
the same class as the spot-noise selection RE, which landed exact.

## Architecture

Three small, independently testable units plus a docs touch-up.

### 1. `src/noise/startingLakes.ts` (new)

```ts
export function startingLakePositions(
  seed0: number,
  startingPositions: Point[],
): Point[]
```

- A 1:1 port of `getStartingLakePositions`, pure and I/O-free.
- Reuses the existing taus88 RNG helpers rather than re-deriving seeding.
- Returns world-tile positions (`Point`, matching `distanceFromNearestPoint`'s
  `/256` fixed-point convention - confirmed in Task 0).
- Depends on: the RNG helpers and `Point`. Nothing depends on its internals; the
  only consumer calls the one exported function.

### 2. Wiring into the render (`ctx.ts` / `elevationLakes.ts` / `renderElevation.ts`)

The renderer already threads `startingLakePositions` through
`distanceFromNearestPoint`, so the tree is untouched. The change is the **default**:
when a caller does not supply `startingLakePositions`, derive it from
`startingLakePositions(seed0, startingPositions)` instead of defaulting to `[]`.
`startingPositions` keeps its `[{x:0,y:0}]` default.

Decision (approved): computed positions become the default, not an opt-in flag - the
faithful result is what every caller wants, and an explicit `[]` is still accepted
for tests that need the old far-field behavior.

Exact wiring point (single source of the default) is a Task-0/planning detail:
either `withCtxDefaults` in `ctx.ts` or `makeElevationLakes` in `elevationLakes.ts`,
whichever keeps one owner of the default so the two entry points cannot desync.

### 3. Oracle validation (`test/oracle/capture.ts` + fixture + spec)

- New capture case dumping the game's real `starting_lake_positions` for the M1
  fixture seed (123456) via the existing headless dumper-mod recipe.
- Committed fixture `test/fixtures/oracle-starting-lakes.seed123456.json`
  (read-only ground truth).
- `test/startingLakes.spec.ts` asserts the TS port reproduces the dumped positions
  exactly, and that near-spawn `elevation_lakes` parity now holds at points that M1
  could only assert in the saturated far field.

### 4. Docs

Update the far-from-spawn caveat in `renderElevation.ts` and the `elevationLakes.ts`
header, and the M1 memory, to record that near-spawn lakes are now faithful.

## Data flow

```
seed0, startingPositions
        |
        v
startingLakePositions(seed0, startingPositions)   <- the new RE'd function
        |
        v  (as ctx.startingLakePositions default)
distanceFromNearestPoint(x, y, lakePts, max=1024)  <- starting_lake_distance
        |
        v
finish_elevation terms 2-4  ->  elevation_lakes  ->  water mask  ->  ImageData
```

## Risks and mitigations

- **R1 - the placement algorithm is more involved than the head suggests** (e.g.
  rejection/separation loop via `StartingAreaDistribution`). Mitigation: Task 0 is a
  disasm-first de-risk spike (as in M1) that fully traces the function and its
  callees before any port is written; the design does not commit to a placement
  shape beyond "RNG-seeded polar offsets per starting position."
- **R2 - fixed-point / coordinate convention mismatch** (tiles vs `/256`, integer
  truncation). Mitigation: the oracle dump is the arbiter; the port matches the
  dumped integer positions exactly, not a re-derived formula.
- **R3 - multi-lake or count-dependent output.** Mitigation: the oracle fixture is
  captured from the real game, so whatever count/shape the game produces is what the
  test asserts; we do not assume one-lake-per-spawn.

## Success criteria

1. `startingLakePositions(123456, [{0,0}])` matches the game's dumped positions
   exactly (integer-equal).
2. Near-spawn `elevation_lakes` parity holds where M1's test could not assert it.
3. The full suite stays green; the change is additive (no codec/model/UI-store
   behavior change beyond the render default).
4. Renderer output visibly shows the near-spawn lake(s) at the origin.

## Task 0 (de-risk, before any port)

Fully disassemble `getStartingLakePositions` (and any `StartingAreaDistribution`
callees on the lake path), and dump the game's `starting_lake_positions` for seed
123456 via the headless recipe. Deliverable: a written trace of the algorithm +
the oracle fixture, sufficient to write the port with confidence. Only after Task 0
is the TS port authored (test-first).

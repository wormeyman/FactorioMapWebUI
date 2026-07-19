# Faithful near-spawn starting lakes (`starting_lake_positions`)

Date: 2026-07-18
Status: design (approved for planning; RE verified by independent disasm review)
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
map_seed)` with **no dependency on the elevation field** - no chicken-and-egg.
Recovering that function makes the near-spawn render faithful for any seed while
staying fully offline.

## Scope

In scope: recover `MapGenSettings::getStartingLakePositions()`, port it to TS, feed
the result into the existing `renderElevation` pipeline, and cross-validate against
a headless-Factorio oracle dump.

Out of scope (unchanged from M1): the larger `elevation_nauvis` tree, graded
elevation shading (still a binary water/land mask), and per-pixel table-rebuild
perf (M1 deferral N6).

## The algorithm (fully recovered from the arm64 disasm)

`MapGenSettings::getStartingLakePositions() const`, arm64 `0x10160a2fc`-`0x10160a760`
(~1072 bytes), non-stripped. An independent disasm review verified the full body.
It is **simpler and lower-risk than a rejection/placement search** - a plain 1-in,
1-out map with a single RNG draw per lake:

1. **Input / output shape.** Reads the `starting_positions` vector at
   `MapGenSettings+0x58` (begin/end at `+0x58`; `subs` gives byte length). Allocates
   an output vector of the **same byte count** (`operator new`, then `asr #3` =>
   8-byte elements = one `MapPosition{int32 x, int32 y}` out per one in). So the
   output is **exactly one lake per starting position, in order** - not multi-lake,
   not count-scaled. Empty input => empty output (early return at `+120`).

2. **RNG seeding (a third, simplest variant).** `word = max(seed [+0x4c], 0x155)`
   (`ldr w8,[x21,#0x4c]; cmp #0x155; csel hi`). taus88 with `s1 = s2 = s3 = word`
   (`dup.2s` seeds the two vector lanes; the scalar holds the third). Seeded **once,
   outside the loop**; the stream is continuous across lakes. **No `seed1` combine**
   (unlike basis noise) and **no `^ seed0`** (unlike spot noise) - `word` is just
   `max(seed0, 0x155)`.

3. **Per lake: one draw, fixed radius, random angle.**
   - One taus88 step -> `u = draw * 2^-32` in `[0, 1)`.
   - `angle = u * 2*pi` (constant `0x401921FB54442D18` = 2*pi; `1/(2*pi)` also loaded).
   - **Radius is a fixed constant `R = 75.0` tiles** (`0x4052C00000000000`), *not*
     random. Only the angle varies. The port must **not** draw a second RNG value.
   - `sin`/`cos` via an inlined **fast-sine minimax polynomial** with an
     intermediate **f32 round-trip** (`fcvt s,d; fcvt d,s`); the second axis uses a
     `-0.25` turn phase shift. All polynomial coefficients are present in the disasm
     (Task 0 transcribes them exactly).

4. **Fixed-point conversion.** Spawn input int32 is `* 1/256` (`0x3B800000` f32) to
   tiles; output is `trunc(spawn_tiles + R * trig)` via `fcvtzs` (**truncate toward
   zero**, i.e. `Math.trunc`, not `Math.floor` - differs on negative coords) then
   `<< 8` back to the `/256` int32 `MapPosition`.

5. **No callees on the lake path.** Every `bl` in the function is `operator new`
   (x2), `operator delete`, `__throw_*` (x3), `_Unwind_Resume`. The
   `StartingAreaDistribution` helpers are **not** called here (they live on the
   starting-area path). There is no separation/rejection loop.

The only genuine porting subtlety is transcribing the fast-sine polynomial +
f32 round-trip bit-exactly; the oracle fixture is the final arbiter.

## Architecture

Four small, independently testable units plus a docs touch-up.

### 1. `src/noise/taus88.ts` (new - extraction)

The taus88 core currently exists but is **not reusable**: `taus88Next`/`Taus88State`
are module-private and duplicated in `basisNoise.ts` and `spotCandidates.ts`, and
`spotSelection.ts` inlines a third copy. None of the exported seeding helpers match
`word = max(seed0, 0x155)`.

Extract the canonical step + state into `src/noise/taus88.ts` (`export`
`taus88Next`, `Taus88State`, `seededState(word)`). Refactor `basisNoise.ts` and
`spotCandidates.ts` to import it - a behavior-preserving dedupe covered by their
existing bit-exact tests. This keeps the new lake seeding from adding a fourth copy.

### 2. `src/noise/startingLakes.ts` (new)

```ts
export function startingLakePositions(
  seed0: number,
  startingPositions: Point[],
): Point[]
```

- 1:1 port of the algorithm above; pure, I/O-free.
- Seeding: `word = max(seed0, 0x155)`, `s1=s2=s3=word`, one draw per position,
  `angle = draw*2^-32 * 2*pi`, `R = 75`, fast-sine poly (+ f32 round-trip),
  `trunc` toward zero, `/256` fixed-point round-trip.
- Coordinate convention: `Point` is already in **tiles**; treat `startingPositions`
  as tiles (do **not** re-apply `/256` on input - that scaling models the game's
  int32->tile read, already done). Output `Point`s are tiles, matching
  `distanceFromNearestPoint`'s `quantise` (a no-op on integer tiles).
- Depends only on `taus88.ts` and `Point`. Sole consumer calls the one export.

### 3. Wiring the default (single owner = `makeElevationLakes`)

`makeElevationLakes` becomes the **single** owner of the lake-positions default:
when `params.startingLakePositions` is `undefined`, it computes
`startingLakePositions(seed0, startingPositions)`; an explicit array (including `[]`)
is honored as-is. This covers **both** entry points, because
`renderElevation.ts:38` calls `makeElevationLakes` directly and `elevationLakes()`
calls it via `withCtxDefaults`.

To avoid the desync the two-owner approach risks, **`withCtxDefaults` stops forcing
`startingLakePositions` to `[]`** (leaves it `undefined` when unset) so the single
owner in `makeElevationLakes` always decides. This is a deliberate behavior change:
`test/eval/ctx.spec.ts:10` currently asserts the default is `[]` and **must be
updated** (a legitimate test change - not a fixture edit). Tests that need the old
far-field behavior pass an explicit `[]`.

The elevation tree itself is untouched.

### 4. Oracle validation

- New capture case in `test/oracle/capture.ts` dumping, for the M1 seed (123456),
  **both** the input `starting_positions` and the output `starting_lake_positions`
  from the headless dumper mod (dumping only the output would make an input mismatch
  look like a port bug).
- Fixture `test/fixtures/oracle-starting-lakes.seed123456.json` (read-only truth).
- `test/startingLakes.spec.ts` feeds the **dumped input** to the port and asserts
  integer-exact equality with the dumped output.

### 5. Docs

Update the far-from-spawn caveat in `renderElevation.ts` and the `elevationLakes.ts`
header, and the M1 memory, to record that near-spawn lakes are now faithful.

## Data flow

```
seed0, startingPositions (tiles)
        |
        v
startingLakePositions(seed0, startingPositions)   <- new RE'd port
   word=max(seed0,0x155); per pos: u*2pi angle, R=75, trunc->/256
        |
        v  (makeElevationLakes default when unset)
distanceFromNearestPoint(x, y, lakePts, max=1024)  <- starting_lake_distance
        |
        v
finish_elevation terms 2-4  ->  elevation_lakes  ->  water mask  ->  ImageData
```

## Risks and mitigations

- **R1 (placement search / separation loop) - DISSOLVED.** The disasm shows no
  `StartingAreaDistribution` calls and no rejection loop; it is a 1-in-1-out map.
- **R2 - fast-sine bit-exactness.** The minimax poly + intermediate f32 round-trip
  must be transcribed exactly, or points near half-integers flip a tile after
  truncation. Mitigation: Task 0 captures every coefficient and the `fcvt` round-trip
  from the disasm; the oracle fixture is the arbiter.
- **R3 - truncation direction.** `fcvtzs` truncates toward zero; using `Math.floor`
  would flip negative-coordinate tiles. Mitigation: spec mandates `Math.trunc`.
- **R4 - double-scaling coordinates.** `Point` is already tiles; re-applying `/256`
  on input would be wrong. Mitigation: convention stated in unit 2.

## Success criteria

1. `startingLakePositions(123456, <dumped starting_positions>)` equals the dumped
   `starting_lake_positions` exactly (integer-equal).
2. Each output lake is `R = 75.0` tiles from its spawn before truncation
   (`toBeCloseTo(75)`) - an oracle-independent sanity guard.
3. Near-spawn `elevation_lakes` parity holds where M1's test could not assert it;
   the M1 far-field saturated points still saturate under the new default (a lake at
   radius 75 leaves far points saturated - verify, don't assume).
4. The full suite is green **after** the planned `ctx.spec.ts` update; the taus88
   extraction is behavior-preserving (its existing bit-exact tests still pass). No
   codec/model/store change (all edits live in the noise/preview layer).
5. Renderer output visibly shows the near-spawn lake(s) at the origin.

## Task 0 (de-risk, before the port) - rescoped

The algorithm is already recovered (above), so Task 0 is narrow:
1. Transcribe the fast-sine polynomial coefficients and the intermediate f32
   round-trip exactly from the disasm (`lldb -b -o "disassemble -n
   'MapGenSettings::getStartingLakePositions'"`).
2. Capture the oracle fixture for seed 123456: both `starting_positions` (input) and
   `starting_lake_positions` (output), via the headless dumper-mod recipe.

Deliverable: the exact sine transcription + the oracle fixture. Only then is the
port authored, test-first.

## Edge cases to test

- Empty `startingPositions` => empty output (the early-return path).
- Multiple starting positions => N lakes off one continuous RNG stream, in order
  (fixture worth adding if multi-spawn is ever supported).
- Far-field regression on `elevationLakes.spec.ts` under the new default.

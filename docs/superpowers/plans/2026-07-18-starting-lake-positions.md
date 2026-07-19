# Faithful near-spawn starting lakes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the game's real `starting_lake_positions` client-side so `renderElevation` shows the true near-spawn coastline for any seed, fully offline.

**Architecture:** Port `MapGenSettings::getStartingLakePositions()` (fully recovered from the arm64 disasm, verified exact against the existing oracle fixture) to a new `src/noise/startingLakes.ts`, reusing an extracted shared taus88 RNG. Wire it as the default lake-position source in `makeElevationLakes` (the single owner), leaving the elevation tree untouched.

**Tech Stack:** TypeScript, Vitest-compatible `vite-plus/test`. Run tests with `pnpm vp test <file>`.

## Global Constraints

- Run test/lint tools through pnpm: `pnpm vp test`, `pnpm vp check --fix` (bare `vp` fails `EBADDEVENGINES`).
- Use hyphens, never em/en dashes, in all files.
- All new code lives in the `src/noise/` preview layer; **do not** touch `src/codec/*`, the store, or model conversion (byte-exact codec invariant must stay untouched).
- `Point` is world **tiles** (integer); `distanceFromNearestPoint`'s `quantise` is a no-op on integer tiles. Never re-apply `/256` scaling to a `Point`.
- Fixtures under `test/fixtures/` are read-only ground truth; never edit one to make a test pass.

## The recovered algorithm (reference for Task 2)

`getStartingLakePositions(seed0, startingPositions)`: one lake per starting position, in order; empty input -> empty output.

- Seed once: `word = max(seed0, 0x155)`; taus88 state `s1 = s2 = s3 = word`. No `seed1`, no `^ seed0`.
- Per position (spawn `sx, sy` in tiles), one taus88 draw `u32`:
  - `u = draw * 2^-32` (in `[0,1)`)
  - `t = fround(u * TWO_PI) * INV_TWO_PI` (angle normalised to turns; note the intermediate f32 round-trip via `Math.fround`)
  - `lakeX = trunc(sx + 75 * sinlike(t))`, `lakeY = trunc(sy + 75 * sinlike(t - 0.25))` (`trunc` = toward zero, i.e. `Math.trunc`)
- `sinlike(t)` is an inlined minimax approximation of `cos(2*pi*t)` (so axis 1 = cos, axis 2 with the -0.25 turn = sin):

```
sinlike(t):
  sign = t > 0 ? 0.5 : -0.5
  r    = Math.trunc(t + sign)          // round to nearest
  x    = 0.25 - Math.abs(t - r)        // triangle wave in [-0.25, 0.25]
  x2 = x*x; x4 = x2*x2; x8 = x4*x4
  poly = (C2 - x2*C1) + x4*(C4 - x2*C3)
  poly = x8*C5 + poly
  return x * poly
```

Exact double constants (verified: `sinlike` matches `cos(2*pi*t)` to 6e-9, and lake `(45,-59)` for seed 123456 reproduces every near-spawn fixture distance to 0.000):

| name | value | hex (f64) |
|------|-------|-----------|
| `TWO_PI` | 6.283185307179586 | `0x401921FB54442D18` |
| `INV_TWO_PI` | 0.15915494309189535 | `0x3FC45F306DC9C883` |
| `TWO_POW_NEG32` | 2.3283064365386963e-10 | `0x3DF0000000000000` |
| `RADIUS` | 75.0 | `0x4052C00000000000` |
| `C1` | 41.34167506665737 | `0x4044ABBC02329376` |
| `C2` | 6.283185269630412 | `0x401921FB51BF1614` |
| `C3` | 76.56887678023256 | `0x405324687A27A35E` |
| `C4` | 81.60201529595571 | `0x405466876B29F494` |
| `C5` | 39.65735524898863 | `0x4043D4243780214B` |

`MIN_SEED_WORD = 0x155`.

**Oracle note:** no new headless capture is needed. `test/fixtures/oracle-elevation-lakes.seed123456.json` already holds the game's real `startingLakeDistance[]` at 26 sample points (9 near-spawn), which the port must reproduce exactly - a sufficient independent oracle. The M1 map had a single origin spawn (`distance[0] == hypot`), so one lake at `(45,-59)`.

---

### Task 1: Extract a shared taus88 RNG

The canonical taus88 step is currently module-private and duplicated in `basisNoise.ts` and `spotCandidates.ts`. Extract it so the new lake seeding reuses it instead of adding a fourth copy. Behavior-preserving; the existing bit-exact tests for basis/spot noise are the safety net.

**Files:**
- Create: `src/noise/taus88.ts`
- Modify: `src/noise/spotCandidates.ts` (remove local `Taus88State`/`taus88Next`, import from taus88)
- Modify: `src/noise/basisNoise.ts` (remove its local copy, import from taus88)
- Test: `test/noise/taus88.spec.ts`

**Interfaces:**
- Produces:
  - `interface Taus88State { s1: number; s2: number; s3: number; }`
  - `function seededState(word: number): Taus88State` - returns `{ s1: word, s2: word, s3: word }`
  - `function taus88Next(st: Taus88State): number` - one canonical step, output taken after update (identical to the current `spotCandidates.ts` body)

- [ ] **Step 1: Write the failing test**

`test/noise/taus88.spec.ts`:
```ts
import { describe, expect, it } from "vite-plus/test";
import { seededState, taus88Next } from "../../src/noise/taus88";

describe("taus88", () => {
  it("seededState sets all three words equal", () => {
    expect(seededState(0x155)).toEqual({ s1: 0x155, s2: 0x155, s3: 0x155 });
  });

  it("produces the canonical stream for a known seed", () => {
    // Captured from the current spotCandidates taus88 (word=123456), first 3 draws.
    const st = seededState(123456);
    expect([taus88Next(st), taus88Next(st), taus88Next(st)]).toEqual([
      2401021493, 3113706674, 1948098711,
    ]);
  });
});
```

- [ ] **Step 2: Confirm the expected stream values**

Before trusting the literals above, generate them from the CURRENT code so the test pins real behavior (do this once, paste the numbers into the test):
Run:
```bash
pnpm vp test -t "canonical stream" 2>/dev/null; node --experimental-strip-types -e '
import("./src/noise/spotCandidates.ts").then(()=>{});' 2>/dev/null || true
```
If the extraction module does not exist yet the test fails to import - that is the expected initial failure. (The three integers are placeholders to be replaced with the values Step 4 prints.)

- [ ] **Step 3: Create `src/noise/taus88.ts`**

Copy the exact bodies from `src/noise/spotCandidates.ts` (lines 42-54):
```ts
/**
 * L'Ecuyer taus88, the generator underlying Factorio's noise RNG. Extracted from
 * spotCandidates/basisNoise so every seeding variant shares one bit-exact step.
 * Verified against Factorio 2.1.11.
 */
export interface Taus88State {
  s1: number;
  s2: number;
  s3: number;
}

/** Seed all three state words to the same value (the game's seeding shape). */
export function seededState(word: number): Taus88State {
  return { s1: word >>> 0, s2: word >>> 0, s3: word >>> 0 };
}

/** One canonical taus88 step (output taken after the update). */
export function taus88Next(st: Taus88State): number {
  st.s1 = ((((st.s1 & 0xfffffffe) << 12) >>> 0) ^ ((((st.s1 << 13) >>> 0) ^ st.s1) >>> 19)) >>> 0;
  st.s2 = ((((st.s2 & 0xfffffff8) << 4) >>> 0) ^ ((((st.s2 << 2) >>> 0) ^ st.s2) >>> 25)) >>> 0;
  st.s3 = ((((st.s3 & 0xfffffff0) << 17) >>> 0) ^ ((((st.s3 << 3) >>> 0) ^ st.s3) >>> 11)) >>> 0;
  return (st.s1 ^ st.s2 ^ st.s3) >>> 0;
}
```

- [ ] **Step 4: Fill the real stream literals and run**

Run:
```bash
node --experimental-strip-types -e '
import { seededState, taus88Next } from "./src/noise/taus88.ts";
const st = seededState(123456);
console.log([taus88Next(st), taus88Next(st), taus88Next(st)]);
'
```
Paste the printed three integers into the Step 1 test (replacing the placeholders). Then:
Run: `pnpm vp test test/noise/taus88.spec.ts`
Expected: PASS

- [ ] **Step 5: Refactor `spotCandidates.ts` and `basisNoise.ts` to import**

In `src/noise/spotCandidates.ts`: delete the local `Taus88State` interface and `taus88Next` function; add `import { taus88Next, type Taus88State } from "./taus88";`. Replace its seeding `{ s1: word, s2: word, s3: word }` with `seededState(word)` (import it too).
In `src/noise/basisNoise.ts`: delete its private taus88 copy; import `taus88Next`/`seededState`/`Taus88State` from `./taus88` and use them in the same places.

- [ ] **Step 6: Run the full suite to prove the refactor is behavior-preserving**

Run: `pnpm vp test`
Expected: PASS (the existing bit-exact basis/spot tests validate the extraction; 492+ tests green).

- [ ] **Step 7: Commit**

```bash
git add src/noise/taus88.ts src/noise/spotCandidates.ts src/noise/basisNoise.ts test/noise/taus88.spec.ts
git commit -m "refactor(noise): extract shared taus88 RNG (taus88.ts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HTpSND92mqjJ7JMBiXxgJJ"
```

---

### Task 2: Port `getStartingLakePositions` to `src/noise/startingLakes.ts`

**Files:**
- Create: `src/noise/startingLakes.ts`
- Test: `test/noise/startingLakes.spec.ts`

**Interfaces:**
- Consumes: `taus88Next`, `seededState` from `./taus88`; `Point` from `./distanceFromNearestPoint`.
- Produces: `function startingLakePositions(seed0: number, startingPositions: readonly Point[]): Point[]` - one lake `Point` (tiles) per starting position, in order.

- [ ] **Step 1: Write the failing test**

`test/noise/startingLakes.spec.ts`:
```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "../fixtures/oracle-elevation-lakes.seed123456.json";
import { startingLakePositions } from "../../src/noise/startingLakes";
import { distanceFromNearestPoint } from "../../src/noise/distanceFromNearestPoint";

describe("startingLakePositions (RE of MapGenSettings::getStartingLakePositions)", () => {
  it("computes the game's real starting lake for seed 123456", () => {
    // Trilaterated exactly from the fixture's 9 near-spawn startingLakeDistance values.
    expect(startingLakePositions(123456, [{ x: 0, y: 0 }])).toEqual([{ x: 45, y: -59 }]);
  });

  it("reproduces every near-spawn startingLakeDistance in the fixture", () => {
    const lakes = startingLakePositions(fixture.seed0, [{ x: 0, y: 0 }]);
    let worst = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      const p = fixture.positions[i];
      const d = distanceFromNearestPoint(p.x, p.y, lakes, 1024);
      worst = Math.max(worst, Math.abs(d - fixture.startingLakeDistance[i]));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("places each lake at radius 75 from its spawn (pre-truncation invariant)", () => {
    const [lake] = startingLakePositions(999, [{ x: 0, y: 0 }]);
    expect(Math.hypot(lake.x, lake.y)).toBeGreaterThan(73);
    expect(Math.hypot(lake.x, lake.y)).toBeLessThanOrEqual(75);
  });

  it("returns one lake per starting position, in order", () => {
    const lakes = startingLakePositions(123456, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]);
    expect(lakes).toHaveLength(2);
    // second lake is near its own spawn (within radius 75)
    expect(Math.hypot(lakes[1].x - 1000, lakes[1].y)).toBeLessThanOrEqual(75);
  });

  it("returns empty for empty starting positions", () => {
    expect(startingLakePositions(123456, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/noise/startingLakes.spec.ts`
Expected: FAIL ("Cannot find module '../../src/noise/startingLakes'").

- [ ] **Step 3: Write the implementation**

`src/noise/startingLakes.ts`:
```ts
/**
 * Factorio's `starting_lake_positions`, reverse-engineered from
 * `MapGenSettings::getStartingLakePositions() const` (non-stripped 2.1.11 Mach-O,
 * arm64 0x10160a2fc). One lake per starting position, in order: a single taus88
 * draw picks an angle; the lake sits at a FIXED radius of 75 tiles around the
 * spawn. Verified exact against test/fixtures/oracle-elevation-lakes.seed123456
 * (lake (45,-59) reproduces all 9 near-spawn distances to 0). See
 * docs/superpowers/specs/2026-07-18-starting-lake-positions-design.md.
 *
 * NOT random beyond the angle: radius, phase-quantisation and the fast-sine poly
 * are all fixed. The intermediate f32 round-trip (Math.fround) and truncation
 * toward zero (Math.trunc) are load-bearing - do not "clean them up".
 */
import { seededState, taus88Next } from "./taus88";
import type { Point } from "./distanceFromNearestPoint";

const MIN_SEED_WORD = 0x155;
const TWO_POW_NEG32 = 2.3283064365386963e-10; // 0x3DF0000000000000
const TWO_PI = 6.283185307179586; // 0x401921FB54442D18
const INV_TWO_PI = 0.15915494309189535; // 0x3FC45F306DC9C883
const RADIUS = 75.0; // 0x4052C00000000000

// Minimax coefficients (0x4044ABBC02329376 .. 0x4043D4243780214B).
const C1 = 41.34167506665737;
const C2 = 6.283185269630412;
const C3 = 76.56887678023256;
const C4 = 81.60201529595571;
const C5 = 39.65735524898863;

/** Inlined fast approximation of cos(2*pi*t) for t in turns (matches the game). */
function sinlike(t: number): number {
  const r = Math.trunc(t + (t > 0 ? 0.5 : -0.5));
  const x = 0.25 - Math.abs(t - r);
  const x2 = x * x;
  const x4 = x2 * x2;
  const x8 = x4 * x4;
  let poly = C2 - x2 * C1 + x4 * (C4 - x2 * C3);
  poly = x8 * C5 + poly;
  return x * poly;
}

/**
 * The game's `starting_lake_positions`: one lake per starting position, computed
 * from `(seed0, startingPositions)` alone. Positions are world tiles.
 */
export function startingLakePositions(
  seed0: number,
  startingPositions: readonly Point[],
): Point[] {
  const word = Math.max(seed0 >>> 0, MIN_SEED_WORD);
  const st = seededState(word);
  const lakes: Point[] = [];
  for (const spawn of startingPositions) {
    const u = taus88Next(st) * TWO_POW_NEG32;
    const t = Math.fround(u * TWO_PI) * INV_TWO_PI;
    lakes.push({
      x: Math.trunc(spawn.x + RADIUS * sinlike(t)),
      y: Math.trunc(spawn.y + RADIUS * sinlike(t - 0.25)),
    });
  }
  return lakes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/noise/startingLakes.spec.ts`
Expected: PASS (all five cases, especially the exact `(45,-59)` and the fixture-distance reproduction).

- [ ] **Step 5: Commit**

```bash
git add src/noise/startingLakes.ts test/noise/startingLakes.spec.ts
git commit -m "feat(noise): port getStartingLakePositions (starting_lake_positions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HTpSND92mqjJ7JMBiXxgJJ"
```

---

### Task 3: Wire computed lakes as the default in `makeElevationLakes`

Make `makeElevationLakes` the single owner of the lake default so both entry points (`renderElevation` direct, `elevationLakes()` via ctx) get faithful lakes without desync. `withCtxDefaults` stops forcing `[]`.

**Files:**
- Modify: `src/noise/expressions/elevationLakes.ts:38` (default) and its imports
- Modify: `src/noise/eval/ctx.ts` (make field optional, stop forcing `[]`)
- Modify: `test/eval/ctx.spec.ts:10` (assert the new default)

**Interfaces:**
- Consumes: `startingLakePositions` from `../startingLakes`.

- [ ] **Step 1: Update the ctx test to the new contract (failing first)**

In `test/eval/ctx.spec.ts`, change line 10 from `expect(ctx.startingLakePositions).toEqual([]);` to:
```ts
    expect(ctx.startingLakePositions).toBeUndefined();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vp test test/eval/ctx.spec.ts`
Expected: FAIL (current `withCtxDefaults` returns `[]`, not undefined).

- [ ] **Step 3: Make the field optional and stop forcing `[]` in `ctx.ts`**

In `src/noise/eval/ctx.ts`:
- Change the interface field (line 21) to `startingLakePositions?: Point[];`.
- Remove `startingLakePositions: [] as Point[],` from `DEFAULT_CTX_FIELDS`.
- Change the `withCtxDefaults` return line 47 to pass through unchanged:
  ```ts
    startingLakePositions: input.startingLakePositions,
  ```

- [ ] **Step 4: Make `makeElevationLakes` compute the default**

In `src/noise/expressions/elevationLakes.ts`:
- Add import: `import { startingLakePositions as computeStartingLakes } from "../startingLakes";`
- Change line 38 from `const startingLakePositions = params.startingLakePositions ?? [];` to:
  ```ts
  const startingLakePositions =
    params.startingLakePositions ?? computeStartingLakes(seed0, startingPositions);
  ```
  (`startingPositions` is already defaulted just above at line 37, so this uses the resolved spawn list.)

- [ ] **Step 5: Run the ctx + full suite**

Run: `pnpm vp test test/eval/ctx.spec.ts`
Expected: PASS.
Run: `pnpm vp test`
Expected: PASS - but `test/elevationLakes.spec.ts` now runs with computed lakes; Task 4 strengthens it. If any elevationLakes assertion regresses here, STOP (a computed lake that changed a saturated point means the port or wiring is wrong).

- [ ] **Step 6: Commit**

```bash
git add src/noise/eval/ctx.ts src/noise/expressions/elevationLakes.ts test/eval/ctx.spec.ts
git commit -m "feat(noise): compute starting lakes by default in makeElevationLakes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HTpSND92mqjJ7JMBiXxgJJ"
```

---

### Task 4: Assert near-spawn elevation parity now holds

With faithful lakes, the elevation tree should match the game near spawn too, not only where `startingLakeDistance` saturated. Broaden `elevationLakes.spec.ts` to prove it.

**Files:**
- Modify: `test/elevationLakes.spec.ts`

- [ ] **Step 1: Add a near-spawn parity test**

Append a new `it` inside the existing `describe` in `test/elevationLakes.spec.ts` (the file already builds `evalAt = makeElevationLakes({ seed0: fixture.seed0 })`, which now uses the computed lakes):
```ts
  it("now matches near-spawn elevation too (computed starting lakes)", () => {
    let worst = 0;
    let worstLabel = "";
    for (let i = 0; i < fixture.positions.length; i++) {
      if (SATURATED(i)) continue; // the previously-unassertable near-spawn band
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    // Near spawn there is no offset_x=10000 f32 blow-up, so parity is tight.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vp test test/elevationLakes.spec.ts`
Expected: PASS. If `worst` exceeds 8e-3, do NOT loosen the bound - investigate (the near-spawn band has no far-field f32 excuse; a real miss means the lakes or a term is wrong). Print the worst value and label first.

- [ ] **Step 3: Commit**

```bash
git add test/elevationLakes.spec.ts
git commit -m "test(noise): assert near-spawn elevation_lakes parity with real lakes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HTpSND92mqjJ7JMBiXxgJJ"
```

---

### Task 5: Update the fidelity caveats and lint

The far-from-spawn caveats in the renderer/tree are now stale.

**Files:**
- Modify: `src/noise/preview/renderElevation.ts` (the "Far-from-spawn fidelity" doc block, lines 27-30)
- Modify: `src/noise/expressions/elevationLakes.ts` (any far-from-spawn wording in the header)

- [ ] **Step 1: Update `renderElevation.ts` doc comment**

Replace the "Far-from-spawn fidelity" paragraph (lines 27-30) with:
```ts
 * Near-spawn fidelity: the render computes the game's real starting lake positions
 * (see startingLakes.ts) by default, so the coastline is faithful near spawn as
 * well as far out. Callers may still pass an explicit `ctx.startingLakePositions`
 * (including `[]`) to override.
```

- [ ] **Step 2: Update the `makeElevationLakes` header note**

In `src/noise/expressions/elevationLakes.ts`, adjust any "far-from-spawn" phrasing in the file/JSDoc header to note lakes are computed by default via `startingLakes.ts`. Keep it to one sentence.

- [ ] **Step 3: Lint and full suite**

Run: `pnpm vp check --fix`
Expected: clean.
Run: `pnpm vp test`
Expected: PASS (whole suite green).

- [ ] **Step 4: Commit**

```bash
git add src/noise/preview/renderElevation.ts src/noise/expressions/elevationLakes.ts
git commit -m "docs(noise): near-spawn lakes now faithful (drop far-from-spawn caveat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HTpSND92mqjJ7JMBiXxgJJ"
```

---

## Self-Review notes

- **Spec coverage:** taus88 extraction (Task 1), port (Task 2), single-owner default + ctx test (Task 3), near-spawn parity (Task 4), docs (Task 5). The spec's "new oracle capture" is intentionally dropped: planning proved the existing fixture is a sufficient, independent oracle (lake `(45,-59)` reproduces all near-spawn distances exactly) - noted in the spec amendment.
- **Type consistency:** `startingLakePositions(seed0, startingPositions)` signature is identical in Task 2 (definition) and Task 3 (consumption, aliased `computeStartingLakes`). `Taus88State`/`seededState`/`taus88Next` names match across Tasks 1-2.
- **No new headless dependency:** every test uses the committed fixture; no Factorio process required.
- **Memory:** after Task 5, update `m1-elevation-lakes-shipped.md` / MEMORY.md to record near-spawn lakes shipped (out-of-band, not a code task).

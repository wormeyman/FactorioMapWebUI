# Rocks Overlay (Session 1 / Option C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Nauvis "rocks" preview overlay driven by the three charted rock prototypes' autoplace probability, oracle-validated, rendered as an interim coverage-tuned footprint.

**Architecture:** Mirror the existing enemy-base overlay. A new `makeRockDensity` returns `max_i probability_i` over the 3 rock prototypes (per-tile arbitration is max probability, same as trees). A new `renderRocks` paints `ROCK_MAP_COLOR` where that field clears a threshold, reusing the terrain water-skip. Wire a `view: "rocks"` through the worker render request, the preview ctx, and a dev-mode toggle. The probability field is validated against the game's `rock_density` named expression via the existing oracle harness.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Vitest-compatible `vite-plus/test`. Noise primitives already ported: `makeMultioctaveNoise`, `makeMoisture`, `makeAux`, `distanceFromNearestPoint`.

## Global Constraints

- Run `vp` **through pnpm**: `pnpm vp test <file>`, `pnpm vp check --fix`. Bare `vp`/`npx vp` fails with `EBADDEVENGINES`.
- `pnpm run verify` = `vp check` + `vp test` + `preview:test`. Expect **906 passed / 2 skipped** (app) before this work; each new test file raises the app count.
- Prose and comments use hyphens (`-`), never em/en dashes.
- `test/fixtures/*` are game-captured ground truth and read-only. Never weaken a tolerance or edit an expected value to make a test pass.
- Do NOT "tidy" float arithmetic order in ported noise math; addition is not associative and order is load-bearing.
- The renderer is a per-pixel pure function of world coordinate; every render path must stay byte-identical under tiling (`test/tiledEquality.spec.ts`). Never key any rock computation on pixel index, tile index, or render order.
- Game data source: `~/GitHub/factorio-data` at tag `2.1.11` only. Never `~/Downloads/factorio 4/data` (2.0.77, stale).
- Rock prototype facts (factorio-data @ 2.1.11, `base/prototypes/decorative/decoratives.lua`, `base/prototypes/noise-expressions.lua`):
  - All 3 charted rocks share `map_color = {129, 105, 78}`.
  - `probability = multiplier * control:rocks:size * (region_box + rock_density - penalty)`
  - `rock_density = rock_noise - max(0, 1.1 - distance/32)`
  - `rock_noise = multioctave_noise{seed1=137, octaves=4, persistence=0.9, input_scale=0.15*control:rocks:frequency, output_scale=1} + 0.25 + 0.75*(slider_rescale(control:rocks:size, 1.5) - 1)`
  - huge-rock: `multiplier=0.07`, `penalty=1.7`, `region_box=range_select_base(moisture, 0.35, 1, 0.2, -10, 0)`
  - big-rock: `multiplier=0.17`, `penalty=1.6`, `region_box=range_select_base(moisture, 0.35, 1, 0.2, -10, 0)`
  - big-sand-rock: `multiplier=0.10`, `penalty=1.6`, `region_box=min(range_select_base(aux, 0.3, 1, 0.3, -10, 0), range_select_base(moisture, 0, 0.3, 0.2, -10, 0))`
  - `range_select_base(input, from, to, slope, min, max) = clamp(min(input - from, to - input)/slope, min, max)`
  - `slider_rescale(v, n) = 2^(log2(v)/log2(6)*log2(n))`

---

## File Structure

- **Create `src/noise/rocks/rockCatalog.ts`** - constants (`ROCK_SEED1`, `ROCK_MAP_COLOR`, `ROCK_FOOTPRINT_THRESHOLD`), the two pure helpers (`rangeSelectBase`, `sliderRescale`), and the `RockControls` type. One file, self-contained data + trivial math.
- **Create `src/noise/rocks/rockField.ts`** - `makeRockDensity(params): (x,y) => number`, the `max_i probability_i` field. Depends on rockCatalog + the existing noise primitives.
- **Create `src/noise/preview/renderRocks.ts`** - `renderRocks(base, opts)`, the overlay. Clone of `renderEnemies.ts`.
- **Modify `src/noise/preview/elevationRenderRequest.ts`** - add `"rocks"` to the `view` union, add the `rockControls` request field, and a `renderRocks` block composited after trees / before resources.
- **Modify `src/model/elevationPreviewCtx.ts`** - add `rockControls` to the ctx type and populate it from `preset.autoplaceControls.rocks`.
- **Modify `src/components/ElevationPreviewPanel.vue`** - add `"rocks"` to the `view` ref union, pass `rockControls`, and add a Rocks dev-mode toggle button.
- **Modify `test/tiledEquality.spec.ts`** - add `"rocks"` to the `VIEWS` list.
- **Modify `test/oracle/capture.ts`** - add a `rock_density` capture pass.
- **Create `test/fixtures/oracle-rock-density.seed123456.json`** - captured ground truth (requires local Factorio).
- **Create `test/rockField.spec.ts`** - self-consistency unit tests + oracle validation.
- **Create `test/renderRocks.spec.ts`** - overlay unit tests.

---

## Task 1: Rock catalog + math helpers

**Files:**
- Create: `src/noise/rocks/rockCatalog.ts`
- Test: `test/rockCatalog.spec.ts`

**Interfaces:**
- Produces: `ROCK_SEED1: number`, `ROCK_MAP_COLOR: readonly [number, number, number]`, `ROCK_FOOTPRINT_THRESHOLD: number`, `type RockControls = { frequency: number; size: number }`, `rangeSelectBase(input, from, to, slope, min, max): number`, `sliderRescale(v: number, n: number): number`.

- [ ] **Step 1: Write the failing test**

Create `test/rockCatalog.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { rangeSelectBase, sliderRescale, ROCK_MAP_COLOR } from "../src/noise/rocks/rockCatalog";

describe("rangeSelectBase", () => {
  // range_select_base(input, from, to, slope, min, max) =
  //   clamp(min(input - from, to - input)/slope, min, max)
  it("is 0 exactly at the from and to markers", () => {
    expect(rangeSelectBase(0.35, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(0, 12);
    expect(rangeSelectBase(1, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(0, 12);
  });
  it("descends below the range when min < 0 (rocks use min=-10)", () => {
    // input 0.15 is 0.2 below `from`; (0.15-0.35)/0.2 = -1, clamped within [-10,0]
    expect(rangeSelectBase(0.15, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(-1, 12);
  });
  it("clamps at the max ceiling inside the range", () => {
    // deep inside 0.35..1 the raw value exceeds max=0, so it clamps to 0
    expect(rangeSelectBase(0.7, 0.35, 1, 0.2, -10, 0)).toBe(0);
  });
});

describe("sliderRescale", () => {
  it("maps the default slider value 1 to exactly 1", () => {
    expect(sliderRescale(1, 1.5)).toBe(1);
  });
  it("maps the endpoints of the 1/6..6 slider range to 1/n..n", () => {
    expect(sliderRescale(6, 1.5)).toBeCloseTo(1.5, 6);
    expect(sliderRescale(1 / 6, 1.5)).toBeCloseTo(1 / 1.5, 6);
  });
});

describe("ROCK_MAP_COLOR", () => {
  it("is the game's charted rock color", () => {
    expect([...ROCK_MAP_COLOR]).toEqual([129, 105, 78]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/rockCatalog.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/rocks/rockCatalog`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/rocks/rockCatalog.ts`:

```ts
// Constants and pure helpers for the Nauvis rocks overlay, transcribed from
// factorio-data @ 2.1.11 (base/prototypes/decorative/decoratives.lua and
// base/prototypes/noise-expressions.lua). All three charted rock prototypes
// (huge-rock, big-rock, big-sand-rock) share this map_color.
export const ROCK_SEED1 = 137;
export const ROCK_MAP_COLOR: readonly [number, number, number] = [129, 105, 78];

// Interim footprint threshold: rock probabilities are tiny (peak ~0.02-0.17),
// so this is NOT 0.5. Tuned in the plan's final task to match real-render rock
// coverage; the session-2 dither replaces this render entirely.
export const ROCK_FOOTPRINT_THRESHOLD = 0.02;

export type RockControls = {
  frequency: number;
  size: number;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * `range_select_base` (core/prototypes/noise-functions.lua): selects a from-to
 * range, 0 or above inside it, descending outside when `min` < 0.
 *   clamp(min(input - from, to - input) / slope, min, max)
 */
export function rangeSelectBase(
  input: number,
  from: number,
  to: number,
  slope: number,
  min: number,
  max: number,
): number {
  return clamp(Math.min(input - from, to - input) / slope, min, max);
}

/**
 * `slider_rescale` (core/prototypes/noise-functions.lua): maps the 1/6..6 slider
 * output to a 1/n..n range: `2^(log2(v)/log2(6)*log2(n))`. At the default v=1 this
 * is exactly 1, which is the only value the oracle validates point-by-point (non-
 * default size is a faithful port but not point-validated, same as moisture/aux).
 */
export function sliderRescale(v: number, n: number): number {
  if (v === 1) return 1;
  return 2 ** ((Math.log2(v) / Math.log2(6)) * Math.log2(n));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/rockCatalog.spec.ts`
Expected: PASS (all 6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/noise/rocks/rockCatalog.ts test/rockCatalog.spec.ts
git commit -m "feat(rocks): rock catalog constants + range_select_base/slider_rescale helpers"
```

---

## Task 2: The rock density field

**Files:**
- Create: `src/noise/rocks/rockField.ts`
- Test: `test/rockField.spec.ts` (self-consistency portion; oracle portion added in Task 3)

**Interfaces:**
- Consumes: `ROCK_SEED1`, `rangeSelectBase`, `sliderRescale` (Task 1); `makeMultioctaveNoise(params)` from `src/noise/multioctaveNoise.ts` (returns `(x,y)=>number`); `makeMoisture(params)` from `src/noise/expressions/moisture.ts`; `makeAux(params)` from `src/noise/expressions/aux.ts`; `distanceFromNearestPoint(x, y, points)` and `type Point` from `src/noise/distanceFromNearestPoint.ts`; `clamp` from `src/noise/eval/math.ts`.
- Produces: `interface RockFieldParams` and `makeRockDensity(params: RockFieldParams): (x: number, y: number) => number` returning `clamp(max_i probability_i, 0, 1)`.

- [ ] **Step 1: Write the failing test**

Create `test/rockField.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { makeRockDensity } from "../src/noise/rocks/rockField";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { makeMoisture } from "../src/noise/expressions/moisture";
import { makeAux } from "../src/noise/expressions/aux";
import { distanceFromNearestPoint } from "../src/noise/distanceFromNearestPoint";
import { rangeSelectBase, sliderRescale, ROCK_SEED1 } from "../src/noise/rocks/rockCatalog";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// Independently recompute max_i probability_i from the same primitives, so a
// wrong seed1, penalty, multiplier, or region_box band fails loudly. This is NOT
// the game oracle (that is Task 3) - it locks the wiring/composition.
function expected(seed0: number, x: number, y: number): number {
  const spawn = [{ x: 0, y: 0 }];
  const noise = makeMultioctaveNoise({
    seed0, seed1: ROCK_SEED1, octaves: 4, persistence: 0.9, inputScale: 0.15, outputScale: 1,
  });
  const moisture = makeMoisture({ seed0, startingPositions: [...spawn] });
  const aux = makeAux({ seed0 });
  const rockNoise = noise(x, y) + 0.25 + 0.75 * (sliderRescale(1, 1.5) - 1);
  const distance = distanceFromNearestPoint(x, y, spawn);
  const rockDensity = rockNoise - Math.max(0, 1.1 - distance / 32);
  const m = moisture(x, y);
  const a = aux(x, y);
  const moistBand = rangeSelectBase(m, 0.35, 1, 0.2, -10, 0);
  const sandBand = Math.min(
    rangeSelectBase(a, 0.3, 1, 0.3, -10, 0),
    rangeSelectBase(m, 0, 0.3, 0.2, -10, 0),
  );
  const pHuge = 0.07 * 1 * (moistBand + rockDensity - 1.7);
  const pBig = 0.17 * 1 * (moistBand + rockDensity - 1.6);
  const pSand = 0.1 * 1 * (sandBand + rockDensity - 1.6);
  return clamp(Math.max(pHuge, pBig, pSand), 0, 1);
}

describe("makeRockDensity", () => {
  const seed0 = 123456;
  const field = makeRockDensity({ seed0 });
  for (const [x, y] of [
    [300, -180], [512, 512], [-800, 640], [40, 40],
  ] as const) {
    it(`composes max_i probability_i at (${x},${y})`, () => {
      expect(field(x, y)).toBeCloseTo(expected(seed0, x, y), 10);
    });
  }
  it("clamps to [0,1] and is 0 on most far tiles (rocks are sparse)", () => {
    const v = field(5000, 5000);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/rockField.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/rocks/rockField`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/rocks/rockField.ts`:

```ts
/**
 * The Nauvis rocks placement-probability field: `clamp(max_i probability_i, 0, 1)`
 * over the three charted rock prototypes (huge-rock, big-rock, big-sand-rock).
 * Per-tile arbitration is max probability (docs/noise/placement-roll-NOTES.md), so
 * the max is exact - it is the probability the game rolls where a rock wins, i.e.
 * the expected value the overlay shades and the session-2 dither will quantize.
 *
 * probability = multiplier * control:rocks:size * (region_box + rock_density - penalty)
 * See rockCatalog.ts / the plan header for the per-prototype constants.
 */
import { clamp } from "../eval/math";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { makeAux } from "../expressions/aux";
import { makeMoisture } from "../expressions/moisture";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { rangeSelectBase, sliderRescale, ROCK_SEED1 } from "./rockCatalog";

export interface RockFieldParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:rocks:frequency; default 1. */
  readonly rocksFrequency?: number;
  /** control:rocks:size; default 1. */
  readonly rocksSize?: number;
  /** control:water:frequency; default 1. Threads into moisture/aux shared noise. */
  readonly segmentationMultiplier?: number;
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly auxFrequency?: number;
  readonly auxBias?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function makeRockDensity(params: RockFieldParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const freq = params.rocksFrequency ?? 1;
  const size = params.rocksSize ?? 1;
  const spawn: readonly Point[] = params.startingPositions ?? [{ x: 0, y: 0 }];

  const noise = makeMultioctaveNoise({
    seed0,
    seed1: ROCK_SEED1,
    octaves: 4,
    persistence: 0.9,
    inputScale: 0.15 * freq,
    outputScale: 1,
  });
  const moisture = makeMoisture({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingPositions: [...spawn],
  });
  const aux = makeAux({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    frequency: params.auxFrequency,
    bias: params.auxBias,
  });

  // control:rocks:size enters twice: as the outer multiplier and inside rock_noise
  // via slider_rescale. sizeTerm is the size-dependent, position-independent tail
  // of rock_noise, hoisted out of the per-pixel loop.
  const sizeTerm = 0.25 + 0.75 * (sliderRescale(size, 1.5) - 1);

  return (x: number, y: number): number => {
    const rockNoise = noise(x, y) + sizeTerm;
    const distance = distanceFromNearestPoint(x, y, spawn as Point[]);
    const rockDensity = rockNoise - Math.max(0, 1.1 - distance / 32);

    const m = moisture(x, y);
    const moistBand = rangeSelectBase(m, 0.35, 1, 0.2, -10, 0);
    const pHuge = 0.07 * size * (moistBand + rockDensity - 1.7);
    const pBig = 0.17 * size * (moistBand + rockDensity - 1.6);

    const a = aux(x, y);
    const sandBand = Math.min(
      rangeSelectBase(a, 0.3, 1, 0.3, -10, 0),
      rangeSelectBase(m, 0, 0.3, 0.2, -10, 0),
    );
    const pSand = 0.1 * size * (sandBand + rockDensity - 1.6);

    return clamp(Math.max(pHuge, pBig, pSand), 0, 1);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/rockField.spec.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/noise/rocks/rockField.ts test/rockField.spec.ts
git commit -m "feat(rocks): makeRockDensity field (max over 3 rock prototypes)"
```

---

## Task 3: Oracle-validate rock_density against the game

**Requires a local Factorio install** (the oracle harness runs headless Factorio). This is the same gating every prior oracle fixture used; the fixture is captured once and committed, then CI runs the comparison without Factorio. If Factorio is unavailable to the executing agent, capture Step 1-2's fixture is a hand-off to Eric; Steps 3-5 proceed once the fixture file exists.

**Files:**
- Modify: `test/oracle/capture.ts`
- Create: `test/fixtures/oracle-rock-density.seed123456.json`
- Modify: `test/rockField.spec.ts`

**Interfaces:**
- Consumes: `sampleExpression(expression, positions, { workDir, seed })` from `test/oracle/oracle.ts` (already imported in capture.ts); the fixture shape `{ seed0, positions: {x,y}[], values: number[] }`.
- Produces: a committed fixture `test/fixtures/oracle-rock-density.seed123456.json` and a `rock_density vs oracle` test block.

- [ ] **Step 1: Add a rock_density capture to `test/oracle/capture.ts`**

Find the existing capture blocks (each builds `positions`, calls `sampleExpression`, and writes a fixture JSON). Add an analogous block that captures the game's `rock_density` named expression at the default seed:

```ts
// rock_density is a base-game named noise expression
// (base/prototypes/noise-expressions.lua) = rock_noise - max(0, 1.1 - distance/32).
// Validating it point-by-point validates the rocks-specific noise + distance term;
// the range_select_base bands and the multiplier/penalty composition are unit-
// tested in test/rockField.spec.ts, and moisture/aux are already oracle-validated.
{
  const seed = 123456;
  const positions = gridPositions();
  const workDir = /* reuse the same workDir the surrounding captures build */;
  const values = await sampleExpression("rock_density", positions, { workDir, seed });
  const out = "test/fixtures/oracle-rock-density.seed123456.json";
  writeFileSync(
    out,
    JSON.stringify(
      { seed0: seed, positions: positions.map((p) => ({ x: p.x, y: p.y })), values },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${out} (${positions.length} points)`);
}
```

Match the exact `workDir`/`gridPositions`/`writeFileSync` idioms already in the file - do not invent new helpers.

- [ ] **Step 2: Run the capture to produce the committed fixture**

Run the capture the same way the repo already runs it (check `test/oracle/README.md` for the exact command and the `FMW_*` gate; it needs the local Factorio binary). Confirm `test/fixtures/oracle-rock-density.seed123456.json` now exists with ~a few hundred non-trivial values.

Expected: a JSON file with `positions` and `values` arrays of equal length.

- [ ] **Step 3: Add the oracle validation test to `test/rockField.spec.ts`**

Append to `test/rockField.spec.ts`:

```ts
import rockDensityFixture from "./fixtures/oracle-rock-density.seed123456.json";
import { makeMultioctaveNoise as _mon } from "../src/noise/multioctaveNoise";

// Reconstruct rock_density = rock_noise - max(0, 1.1 - distance/32) from the ported
// primitives and compare to the game. abs<0.001 OR rel<1e-2 accommodates the known
// far-field basisNoise f32 floor without masking near-field errors (same combined
// tolerance the enemy/resource oracle specs use).
describe("rock_density vs oracle", () => {
  it("matches the game's rock_density named expression at seed 123456", () => {
    const seed0 = rockDensityFixture.seed0;
    const noise = _mon({
      seed0, seed1: ROCK_SEED1, octaves: 4, persistence: 0.9, inputScale: 0.15, outputScale: 1,
    });
    const spawn = [{ x: 0, y: 0 }];
    let worstAbs = 0;
    let worstRel = 0;
    for (let i = 0; i < rockDensityFixture.positions.length; i++) {
      const p = rockDensityFixture.positions[i];
      const game = rockDensityFixture.values[i];
      const rockNoise = noise(p.x, p.y) + 0.25; // slider_rescale(1,1.5)=1 at default size
      const distance = distanceFromNearestPoint(p.x, p.y, spawn);
      const port = rockNoise - Math.max(0, 1.1 - distance / 32);
      const abs = Math.abs(port - game);
      const rel = abs / Math.max(1, Math.abs(game));
      if (abs > worstAbs) worstAbs = abs;
      if (rel > worstRel) worstRel = rel;
    }
    expect(worstAbs < 1e-3 || worstRel < 1e-2).toBe(true);
  });
});
```

- [ ] **Step 4: Run the oracle test**

Run: `pnpm vp test test/rockField.spec.ts`
Expected: PASS. If it fails, the porting of `rock_noise`/`rock_density` is wrong (seed1, octaves, persistence, input_scale, or the distance term) - a real finding, not a tolerance to loosen.

- [ ] **Step 5: Commit**

```bash
git add test/oracle/capture.ts test/fixtures/oracle-rock-density.seed123456.json test/rockField.spec.ts
git commit -m "test(rocks): oracle-validate rock_density against the game (seed 123456)"
```

---

## Task 4: The rocks overlay renderer

**Files:**
- Create: `src/noise/preview/renderRocks.ts`
- Test: `test/renderRocks.spec.ts`

**Interfaces:**
- Consumes: `makeRockDensity`, `RockFieldParams` (Task 2); `ROCK_MAP_COLOR`, `ROCK_FOOTPRINT_THRESHOLD`, `RockControls` (Task 1); `WATER_TILE_COLORS` from `src/noise/preview/renderResources.ts`; `type Point`.
- Produces: `interface RenderRocksOptions` and `renderRocks(base: ImageData, opts: RenderRocksOptions): void` (mutates `base` in place).

- [ ] **Step 1: Write the failing test**

Create `test/renderRocks.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { renderRocks } from "../src/noise/preview/renderRocks";
import { makeRockDensity } from "../src/noise/rocks/rockField";
import { ROCK_MAP_COLOR, ROCK_FOOTPRINT_THRESHOLD } from "../src/noise/rocks/rockCatalog";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";

function solidImage(w: number, h: number, rgb: readonly [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("renderRocks", () => {
  const seed0 = 123456;
  const W = 48;
  const H = 48;
  const originX = 288;
  const originY = -216;

  it("paints ROCK_MAP_COLOR exactly where max_i probability_i clears the threshold", () => {
    const field = makeRockDensity({ seed0, startingPositions: [{ x: 0, y: 0 }] });
    const img = solidImage(W, H, [100, 100, 100]); // non-water land
    renderRocks(img, { seed0, originX, originY, startingPositions: [{ x: 0, y: 0 }] });
    let painted = 0;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const o = (py * W + px) * 4;
        const isRock =
          img.data[o] === ROCK_MAP_COLOR[0] &&
          img.data[o + 1] === ROCK_MAP_COLOR[1] &&
          img.data[o + 2] === ROCK_MAP_COLOR[2];
        const shouldRock = field(originX + px, originY + py) >= ROCK_FOOTPRINT_THRESHOLD;
        expect(isRock).toBe(shouldRock);
        if (isRock) painted++;
      }
    }
    // Sparse but present in this region (guards against "painted nothing"/"painted all").
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(W * H);
  });

  it("never paints over water pixels", () => {
    const water = WATER_TILE_COLORS[0];
    const img = solidImage(W, H, water);
    renderRocks(img, { seed0, originX, originY, startingPositions: [{ x: 0, y: 0 }] });
    for (let i = 0; i < W * H; i++) {
      expect(img.data[i * 4]).toBe(water[0]);
      expect(img.data[i * 4 + 1]).toBe(water[1]);
      expect(img.data[i * 4 + 2]).toBe(water[2]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/renderRocks.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/preview/renderRocks`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/preview/renderRocks.ts`:

```ts
/**
 * Composite the rocks overlay onto a terrain ImageData: sweep the same pixel grid
 * as renderTerrain/renderEnemies, and where `max_i rock_probability_i` clears the
 * footprint threshold, paint ROCK_MAP_COLOR opaque; leave the terrain pixel
 * untouched elsewhere. Mutates `base` in place.
 *
 * Interim fidelity: rocks are sparse (peak per-tile probability ~0.02-0.17), so an
 * expected-value alpha shade would be near-invisible - a threshold footprint reads
 * as the scattered specks the game shows. The session-2 world-position dither
 * (docs/superpowers/specs/2026-07-22-rocks-overlay-and-density-dither-design.md)
 * replaces this render. 1 pixel per rock cell, no legibility block: rocks are
 * point-like, and a block would merge scattered rocks into a blob.
 *
 * Rocks collide with water, so water pixels are skipped, reusing renderTerrain's
 * exact water decision via WATER_TILE_COLORS the same way renderResources does.
 * Cliff exclusion is not wired, matching the existing ore-on-cliffs deferred item.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeRockDensity } from "../rocks/rockField";
import { ROCK_FOOTPRINT_THRESHOLD, ROCK_MAP_COLOR, type RockControls } from "../rocks/rockCatalog";
import { WATER_TILE_COLORS } from "./renderResources";

export interface RenderRocksOptions {
  readonly seed0: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** control:rocks:frequency/size. Defaults to { frequency: 1, size: 1 }. */
  readonly controls?: RockControls;
  readonly segmentationMultiplier?: number;
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly auxFrequency?: number;
  readonly auxBias?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function renderRocks(base: ImageData, opts: RenderRocksOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const density = makeRockDensity({
    seed0: opts.seed0,
    rocksFrequency: opts.controls?.frequency ?? 1,
    rocksSize: opts.controls?.size ?? 1,
    segmentationMultiplier: opts.segmentationMultiplier,
    moistureFrequency: opts.moistureFrequency,
    moistureBias: opts.moistureBias,
    auxFrequency: opts.auxFrequency,
    auxBias: opts.auxBias,
    startingPositions: opts.startingPositions,
  });

  const isWater = (r: number, g: number, b: number): boolean => {
    for (const [wr, wg, wb] of WATER_TILE_COLORS) {
      if (r === wr && g === wg && b === wb) return true;
    }
    return false;
  };

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      // Rocks never sit on water - skip water tiles (and the field call for them).
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const wx = originX + px * tpp;
      if (density(wx, wy) < ROCK_FOOTPRINT_THRESHOLD) continue;
      base.data[o] = ROCK_MAP_COLOR[0];
      base.data[o + 1] = ROCK_MAP_COLOR[1];
      base.data[o + 2] = ROCK_MAP_COLOR[2];
      base.data[o + 3] = 255;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/renderRocks.spec.ts`
Expected: PASS (both cases). If "painted > 0" fails, the chosen `originX/originY` region is barren for this seed - pick a region nearer spawn where rocks appear, do not lower the threshold to force a pass.

- [ ] **Step 5: Commit**

```bash
git add src/noise/preview/renderRocks.ts test/renderRocks.spec.ts
git commit -m "feat(rocks): renderRocks footprint overlay (threshold, water-skipped)"
```

---

## Task 5: Wire rocks into the worker render request + tiled-equality gate

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (view union ~line 56; request fields ~line 86; render blocks ~line 186-204)
- Modify: `test/tiledEquality.spec.ts:87`

**Interfaces:**
- Consumes: `renderRocks`, `RenderRocksOptions` (Task 4); `RockControls` (Task 1).
- Produces: `"rocks"` as a valid `view`, a `rockControls?: RockControls` request field, and a `renderRocks` invocation for `view === "rocks" || view === "all"`.

- [ ] **Step 1: Extend the tiled-equality gate first (failing test)**

In `test/tiledEquality.spec.ts:87`, add `"rocks"` to the `VIEWS` tuple:

```ts
const VIEWS = ["elevation", "terrain", "resources", "enemies", "cliffs", "trees", "rocks", "all"] as const;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: FAIL - `view: "rocks"` is not yet a valid request view / not rendered, so the type or the render diverges.

- [ ] **Step 3: Add the view union member and request field**

In `src/noise/preview/elevationRenderRequest.ts`:

Add `"rocks"` to the `view` union (the line currently ending `... | "trees" | "all"`):

```ts
  view?: "elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "trees" | "rocks" | "all";
```

Add the request field next to `treeControls?` (import `RockControls` at the top from `../rocks/rockCatalog`):

```ts
  /**
   * The `rocks` autoplace control's frequency/size (control:rocks:*) - consumed
   * only when `view: "rocks"` or `"all"`. Defaults to `{ frequency: 1, size: 1 }`.
   */
  rockControls?: RockControls;
```

Add `"rocks"` to the terrain-view guard (the `req.view === "trees" || req.view === "all"` group of `||` checks around line 161-166):

```ts
    req.view === "rocks" ||
```

- [ ] **Step 4: Add the renderRocks block (composite order: after trees, before resources)**

Import at the top:

```ts
import { renderRocks } from "./renderRocks";
```

Immediately AFTER the `if (req.view === "trees" || req.view === "all") { renderTrees(...); }` block and BEFORE the resources block, insert:

```ts
    if (req.view === "rocks" || req.view === "all") {
      renderRocks(image, {
        seed0: req.seed0,
        originX: req.originX,
        originY: req.originY,
        tilesPerPixel: req.tilesPerPixel,
        controls: req.rockControls ?? { frequency: 1, size: 1 },
        segmentationMultiplier: req.segmentationMultiplier,
        moistureFrequency: req.moistureFrequency,
        moistureBias: req.moistureBias,
        auxFrequency: req.auxFrequency,
        auxBias: req.auxBias,
        startingPositions: req.startingPositions,
      });
    }
```

- [ ] **Step 5: Run to verify the gate passes**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: PASS on all views including `rocks` (byte-identical under tiling, because `renderRocks` is a pure function of world coordinate).

- [ ] **Step 6: Commit**

```bash
git add src/noise/preview/elevationRenderRequest.ts test/tiledEquality.spec.ts
git commit -m "feat(rocks): wire view:rocks into the render request + tiled-equality gate"
```

---

## Task 6: Wire rocks controls through the preview ctx and the panel toggle

**Files:**
- Modify: `src/model/elevationPreviewCtx.ts` (ctx type ~line 55; control read ~line 107; return object ~line 122)
- Modify: `src/components/ElevationPreviewPanel.vue` (view ref union ~line 46; render request ~line 115; toggle buttons ~line 206-216)

**Interfaces:**
- Consumes: `RockControls` shape `{ frequency, size }`; the request field `rockControls` (Task 5).
- Produces: `rockControls` on the preview ctx, and a Rocks dev-mode toggle that sets `view = 'rocks'`.

- [ ] **Step 1: Add `rockControls` to the ctx type and populate it**

In `src/model/elevationPreviewCtx.ts`, add to the ctx interface next to `treeControls` (~line 55):

```ts
  /**
   * The `rocks` autoplace control's frequency/size (control:rocks:*) - consumed
   * only by the `view: "rocks"` overlay (renderRocks). Absent defaults to
   * `{ frequency: 1, size: 1 }`. Nauvis-only, same as the other overlays.
   */
  rockControls: { readonly frequency: number; readonly size: number };
```

Add the control read next to `const tc = preset.autoplaceControls.trees;` (~line 107):

```ts
  const rk = preset.autoplaceControls.rocks;
```

Add to the returned object next to `treeControls:` (~line 122):

```ts
    rockControls: rk ? { frequency: rk.frequency, size: rk.size } : { frequency: 1, size: 1 },
```

- [ ] **Step 2: Pass `rockControls` into the render request in the panel**

In `src/components/ElevationPreviewPanel.vue`, add `"rocks"` to the `view` ref union (~line 46):

```ts
const view = ref<"elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "trees" | "rocks" | "all">(
```

Next to `treeControls: info.treeControls,` (~line 115) in the render request, add:

```ts
        rockControls: info.rockControls,
```

- [ ] **Step 3: Add the Rocks toggle button**

In `src/components/ElevationPreviewPanel.vue`, insert a Rocks `FButton` between the Trees button (ends ~line 216) and the All button (starts ~line 217):

```vue
        <FButton
          data-test="view-rocks"
          :variant="effectiveView === 'rocks' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Rocks view is only available for the Nauvis map type'
          "
          @click="view = 'rocks'"
        >
          Rocks
        </FButton>
```

- [ ] **Step 4: Type-check and run the app test suite**

Run: `pnpm vp check --fix`
Expected: no type errors (the `rockControls` types line up across ctx, request, and panel).

Run: `pnpm vp test`
Expected: PASS, app test count = prior 906 + the new rock tests, 2 skipped unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/model/elevationPreviewCtx.ts src/components/ElevationPreviewPanel.vue
git commit -m "feat(rocks): expose rockControls on the preview ctx + a Rocks view toggle"
```

---

## Task 7: Tune the interim threshold + final verification + eyeball

**Files:**
- Modify: `src/noise/rocks/rockCatalog.ts` (`ROCK_FOOTPRINT_THRESHOLD` only, if tuning warrants)

- [ ] **Step 1: Render the rocks view in the app and compare coverage to the game**

Run the app (`pnpm localpreview` or `pnpm vp dev`), enable Debug mode, seed 123456, select the Rocks toggle. Compare the painted-pixel density against a real `factorio --generate-map-preview` of the same seed/region (rocks chart as `[129,105,78]` pixels in the game's own preview - the same ground-truth pixel color the trees/cliffs work used).

- [ ] **Step 2: Adjust `ROCK_FOOTPRINT_THRESHOLD` if coverage is clearly off**

If the overlay is far denser or sparser than the game's rock coverage, adjust `ROCK_FOOTPRINT_THRESHOLD` in `src/noise/rocks/rockCatalog.ts` toward matching the painted-pixel fraction. Document the chosen value's basis in the constant's comment. This is interim - the session-2 dither supersedes it - so tune only to "roughly matches, clearly reads as scattered rocks", not to a tight ratio.

Re-run `pnpm vp test test/renderRocks.spec.ts` after any change (the "painted > 0 and < all" guard must still hold).

- [ ] **Step 3: Full verify**

Run: `pnpm run verify`
Expected: `vp check` clean, all app tests pass (906 + new rock tests, 2 skipped), `preview:test` 12 passed. If anything fails, it is a real regression - fix before proceeding.

- [ ] **Step 4: Commit any tuning**

```bash
git add src/noise/rocks/rockCatalog.ts
git commit -m "feat(rocks): tune interim footprint threshold to game rock coverage"
```

- [ ] **Step 5: Confirm the branch is green and hand back**

Report: the `rocks` view renders scattered specks on Nauvis land, absent on water and in the cleared spawn area, responds to the rocks frequency/size sliders, and is byte-identical under tiling. Session 2 (the shared blue-noise dither for trees + rocks) is a separate plan.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-22-rocks-overlay-and-density-dither-design.md`, "Session 1 - C"):
- 3 rock fields with exact formulas -> Tasks 1-2 (constants/helpers + `makeRockDensity`).
- Primitives (`range_select_base`, `slider_rescale`) -> Task 1.
- `rockField.ts` / `renderRocks.ts` mirroring the enemy overlay -> Tasks 2, 4.
- Water exclusion via `WATER_TILE_COLORS`, cliff exclusion unwired -> Task 4 (in code + comment).
- `view: "rocks"`, composite after trees / before resources, `tiledEquality` "rocks" -> Task 5.
- Panel Rocks toggle, Nauvis-gated, sliders already registered -> Task 6.
- Oracle-validate the fields -> Task 3.
- Interim coverage-tuned 1px footprint (not a 5x5 block) -> Task 4 code + Task 7 tuning.
- Deliverable = the validated field; interim visual superseded by session-2 dither -> stated in Task 4/7.

**Placeholder scan:** `ROCK_FOOTPRINT_THRESHOLD` ships with a real starting value (0.02) and a tuning task, not a TODO. Task 3's `workDir` is explicitly "match the existing capture idiom" (the file has one canonical helper) rather than invented. No `TBD`/`handle edge cases`/`similar to Task N`.

**Type consistency:** `RockControls = { frequency, size }` (Task 1) matches the request field `rockControls?: RockControls` (Task 5), the ctx `rockControls: { frequency, size }` (Task 6), and `renderRocks` `controls?: RockControls` (Task 4). `makeRockDensity(RockFieldParams)` returns `(x,y)=>number`, consumed by `renderRocks` (Task 4) and tested in Task 2. `ROCK_SEED1`/`ROCK_MAP_COLOR`/`ROCK_FOOTPRINT_THRESHOLD` names are identical across Tasks 1, 3, 4.

**Known dependency:** Task 3 requires a local Factorio install to capture the fixture (same as every prior oracle fixture). Flagged in the task; Steps 3-5 proceed once the committed fixture exists.

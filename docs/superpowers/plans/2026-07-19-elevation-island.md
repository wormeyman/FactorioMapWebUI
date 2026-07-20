# elevation_island Client Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the "Island" map type client-side (the last unported elevation tree), validated against the headless Factorio oracle to the same f32 floor as lakes.

**Architecture:** `elevation_island` is `elevation_lakes` with `bias = -1000` and `segmentation_multiplier / 4`. Parameterize the shared `makeElevationLakes` builder with an optional `bias` (default 20), add a thin `makeElevationIsland` wrapper that fixes `bias = -1000` and divides segmentation by 4, then widen the preview render pipeline's map-type union so `"island"` dispatches to the new builder and reports `supported: true`.

**Tech Stack:** TypeScript, Vue 3, Vitest-compatible (`vite-plus/test`), headless Factorio oracle harness (`test/oracle/`).

## Global Constraints

- Run everything through pnpm: `pnpm vp test`, `pnpm vp test test/<file>.spec.ts`, `pnpm vp check --fix`. A bare/`npx` `vp` fails (`EBADDEVENGINES`). Node 24.18.0.
- `src/**` relative imports are EXTENSIONLESS. Tests import from `"vite-plus/test"`.
- Oracle fixtures are read-only ground truth. NEVER loosen a parity tolerance to force a pass - a mismatch is a real finding.
- No `.vue`/`.ts` type-check gate exists; verify by running tests, not by trusting LSP diagnostics.
- Commit footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
  ```
- Writing style: hyphens, never em/en dashes.

---

### Task 1: Thread a `bias` parameter through `makeElevationLakes`

The two branches of `make_0_12like_lakes` are `max(bias + varPers1, 20 + water_level - ... + varPers2)`. Branch 1 uses the `bias` parameter; branch 2 uses a literal 20. At lakes they coincide (bias 20); island needs `bias = -1000` in branch 1 only. Result is monotonic non-decreasing in `bias` (raising the branch-1 term can only raise the `max`, and `finish_elevation`'s outer `min` is non-decreasing in elevation).

**Files:**
- Modify: `src/noise/expressions/elevationLakes.ts` (add `bias?` to `ElevationLakesParams`; use it in branch 1 of `make0_12likeLakes`)
- Test: `test/elevationLakes.spec.ts` (add a `bias` describe block)

**Interfaces:**
- Produces: `ElevationLakesParams` gains `readonly bias?: number` (default 20). `makeElevationLakes(params)` unchanged signature otherwise; returns `(x: number, y: number) => number`.

- [ ] **Step 1: Write the failing test**

Append to `test/elevationLakes.spec.ts`:

```ts
describe("makeElevationLakes bias parameter", () => {
  const GRID: Array<[number, number]> = [
    [0.5, 0.25],
    [2200.5, 0.25],
    [-1600.5, 1200.25],
    [12345.75, 6789.125],
  ];

  it("defaults bias to 20 (omitted === explicit 20)", () => {
    const def = makeElevationLakes({ seed0: 123456 });
    const explicit = makeElevationLakes({ seed0: 123456, bias: 20 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("is monotonic non-decreasing in bias and actually takes effect", () => {
    const def = makeElevationLakes({ seed0: 123456 });
    const low = makeElevationLakes({ seed0: 123456, bias: -1000 });
    let strictlyLowerSomewhere = false;
    for (const [x, y] of GRID) {
      // Lowering bias can only lower or keep max(branch1, branch2) -> lower or keep the tree.
      expect(low(x, y)).toBeLessThanOrEqual(def(x, y) + 1e-9);
      if (low(x, y) < def(x, y) - 1e-6) strictlyLowerSomewhere = true;
    }
    expect(strictlyLowerSomewhere).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationLakes.spec.ts`
Expected: FAIL - `bias` not accepted / no effect (the monotonic test's `strictlyLowerSomewhere` stays false because bias is ignored, or a TS-level unused-property if strict; the default-equality test passes trivially).

- [ ] **Step 3: Write minimal implementation**

In `src/noise/expressions/elevationLakes.ts`, add the field to the interface (after `startingLakePositions`):

```ts
  /**
   * make_0_12like_lakes `bias` (branch 1's additive term). Default 20 (elevation_lakes).
   * elevation_island passes -1000. Branch 2's literal 20 is independent of this.
   */
  readonly bias?: number;
```

In `makeElevationLakes`, replace the `const bias = 20;` line with:

```ts
  const bias = params.bias ?? 20;
```

The existing NOTE comment at branch 2 already documents the literal-20/bias split; update it to name island:

```ts
    const branch1 = bias + varPers1(x, y, p);
    // NOTE: literal 20, not `bias` (they coincide at elevation_lakes; elevation_island
    // sets bias = -1000 so branch 2 keeps 20 while branch 1 collapses).
    const branch2 = 20 + waterLevel - 0.1 * seg * distance + varPers2(x, y, p);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationLakes.spec.ts`
Expected: PASS (all existing lakes parity tests still green - default bias 20 preserves behavior).

- [ ] **Step 5: Commit**

```bash
git add src/noise/expressions/elevationLakes.ts test/elevationLakes.spec.ts
git commit -m "$(cat <<'EOF'
feat(noise): thread bias param through make_0_12like_lakes

Branch 1 uses the bias parameter (default 20 = elevation_lakes); branch 2
keeps its literal 20. Prep for elevation_island (bias = -1000). Result is
monotonic in bias; lakes behavior unchanged at the default.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 2: `makeElevationIsland` wrapper

Island delegates to the lakes builder with `bias = -1000` and `segmentationMultiplier / 4` (the game defines `segmentation_mult = segmentation_multiplier / 4` and passes it to both `make_0_12like_lakes` and `finish_elevation`). Callers pass the RAW user segmentation; the /4 is applied inside, matching the game.

**Files:**
- Create: `src/noise/expressions/elevationIsland.ts`
- Test: `test/elevationIsland.spec.ts` (delegation unit tests; oracle parity comes in Task 3)

**Interfaces:**
- Consumes: `makeElevationLakes(params)` and `ElevationLakesParams` from Task 1; `EvalCtxInput` / `withCtxDefaults` from `../eval/ctx`; `Point` from `../distanceFromNearestPoint`.
- Produces:
  - `ElevationIslandParams` = `Omit<ElevationLakesParams, "bias">` (bias is fixed internally, not exposed).
  - `makeElevationIsland(params: ElevationIslandParams): (x: number, y: number) => number`.
  - `elevationIsland(ctx: EvalCtxInput): number`.

- [ ] **Step 1: Write the failing test**

Create `test/elevationIsland.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { makeElevationIsland, elevationIsland } from "../src/noise/expressions/elevationIsland";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";

const GRID: Array<[number, number]> = [
  [0.5, 0.25],
  [2200.5, 0.25],
  [-1600.5, 1200.25],
  [12345.75, 6789.125],
];

describe("makeElevationIsland delegates to lakes with bias=-1000 and seg/4", () => {
  it("equals makeElevationLakes with bias -1000 and segmentation/4 (default seg 1)", () => {
    const island = makeElevationIsland({ seed0: 123456 });
    const lakes = makeElevationLakes({ seed0: 123456, bias: -1000, segmentationMultiplier: 0.25 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("divides an explicit segmentationMultiplier by 4", () => {
    const island = makeElevationIsland({ seed0: 123456, segmentationMultiplier: 2 });
    const lakes = makeElevationLakes({ seed0: 123456, bias: -1000, segmentationMultiplier: 0.5 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("passes waterLevel and startingPositions through", () => {
    const opts = { seed0: 123456, waterLevel: 15, startingPositions: [{ x: 300, y: -400 }] };
    const island = makeElevationIsland(opts);
    const lakes = makeElevationLakes({ ...opts, bias: -1000, segmentationMultiplier: 0.25 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("elevationIsland(ctx) matches makeElevationIsland(...)(x, y)", () => {
    const at = makeElevationIsland({ seed0: 123456 });
    expect(elevationIsland({ seed0: 123456, x: 2200.5, y: 0.25 })).toBe(at(2200.5, 0.25));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationIsland.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/expressions/elevationIsland`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/expressions/elevationIsland.ts`:

```ts
import { makeElevationLakes, type ElevationLakesParams } from "./elevationLakes";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";

/** Same free variables as elevation_lakes; `bias` is fixed at -1000 internally. */
export type ElevationIslandParams = Omit<ElevationLakesParams, "bias">;

/**
 * Compile the `elevation_island` tree for one seed into a `(x, y) => elevation`
 * evaluator. Island is `elevation_lakes` with `bias = -1000` and
 * `segmentation_multiplier / 4` (the game's `segmentation_mult`), fed to both
 * make_0_12like_lakes and finish_elevation. Callers pass the RAW user
 * segmentation; the /4 is applied here. See noise-programs.lua `elevation_island`.
 */
export function makeElevationIsland(
  params: ElevationIslandParams,
): (x: number, y: number) => number {
  const seg = params.segmentationMultiplier ?? 1;
  return makeElevationLakes({
    ...params,
    bias: -1000,
    segmentationMultiplier: seg / 4,
  });
}

/**
 * Evaluate `elevation_island` at a single point. Convenience over
 * {@link makeElevationIsland} - for sweeping a grid, call makeElevationIsland once
 * and reuse the returned evaluator.
 */
export function elevationIsland(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationIsland({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationIsland.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/noise/expressions/elevationIsland.ts test/elevationIsland.spec.ts
git commit -m "$(cat <<'EOF'
feat(noise): add makeElevationIsland (lakes with bias=-1000, seg/4)

Thin wrapper over makeElevationLakes matching noise-programs.lua's
elevation_island. Delegation verified against the lakes builder; oracle
parity added next.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 3: Oracle fixture + `elevation_island` parity gate

Capture ground truth for `elevation_island` from headless Factorio (same grid and structure as the lakes/nauvis captures), then assert `makeElevationIsland` reproduces it to the f32 floor. This is the real validation of the port.

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureElevationIsland()`, register a `want("elevation-island")` gate)
- Create: `test/fixtures/oracle-elevation-island.seed123456.json` (generated by running the capture)
- Create: `test/elevationIsland.spec.ts` parity block (append to the file from Task 2)

**Interfaces:**
- Consumes: `sampleExpression`, `Position`, `oracleAvailable`, `FIXTURES` (existing in `capture.ts`); `makeElevationIsland` from Task 2.
- Produces: fixture JSON with `{ seed0, positions, elevation, distance, startingLakeDistance }` (identical shape to `oracle-elevation-lakes.seed123456.json`).

- [ ] **Step 1: Add the capture function**

In `test/oracle/capture.ts`, add after `captureElevationNauvis()` (mirror it exactly, swapping the expression and output path):

```ts
/**
 * The full `elevation_island` tree routed onto `elevation`, plus the two free-var
 * distances. Same grid as captureElevationLakes/Nauvis (near-origin band, far rings
 * at r=2200/3300, one deep-field point). elevation_island = elevation_lakes with
 * bias=-1000 and segmentation_multiplier/4.
 */
async function captureElevationIsland(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 11 - 11 + 0.5, y: gy * 13 - 13 + 0.25 });
    }
  }
  for (const r of [2200, 3300]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
    }
  }
  positions.push({ x: 12345.75, y: 6789.125 });

  const sample = async (expression: string): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  const elevation = await sample("elevation_island");
  console.log("  captured elevation_island tree");
  const distance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_positions}",
  );
  console.log("  captured distance (starting_positions)");
  const startingLakeDistance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_lake_positions, maximum_distance = 1024}",
  );
  console.log("  captured starting_lake_distance");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_island (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-island",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-island.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}
```

And register the gate alongside the others at the bottom of the file:

```ts
if (want("elevation-island")) await captureElevationIsland();
```

- [ ] **Step 2: Generate the fixture (requires headless Factorio)**

Run: `node --experimental-strip-types test/oracle/capture.ts elevation-island`
Expected: prints `captured elevation_island tree` ... and `wrote .../oracle-elevation-island.seed123456.json (27 points)`. Confirm the file exists and has 27 positions with numeric `elevation`.

- [ ] **Step 3: Write the failing parity test**

Append to `test/elevationIsland.spec.ts` (mirror `test/elevationLakes.spec.ts`, swapping the fixture and factory). Add the import at the top of the file:

```ts
import fixture from "./fixtures/oracle-elevation-island.seed123456.json";
```

Then append:

```ts
// Parity is asserted only where the game's own starting_lake_distance saturated at
// 1024 (the empty-lake far-from-spawn ctx is exact there); plus a near-spawn block
// that uses the computed starting lakes. Mirrors elevationLakes.spec.ts.
const SATURATED = (i: number) => fixture.startingLakeDistance[i] >= 1024;

describe("elevationIsland reproduces the game's elevation_island tree", () => {
  const evalAt = makeElevationIsland({ seed0: fixture.seed0 });

  it("has parity-testable (saturated) points", () => {
    expect(fixture.positions.filter((_p, i) => SATURATED(i)).length).toBeGreaterThanOrEqual(12);
  });

  it("matches the water mask (elevation < 0) away from the coastline", () => {
    for (let i = 0; i < fixture.positions.length; i++) {
      if (!SATURATED(i)) continue;
      const exp = fixture.elevation[i];
      if (Math.abs(exp) < 1e-3) continue; // coastline: sign ambiguous within the floor
      const p = fixture.positions[i];
      expect(evalAt(p.x, p.y) < 0).toBe(exp < 0);
    }
  });

  it("matches the numeric elevation to the f32 coordinate floor", () => {
    let worst = 0;
    let worstLabel = "";
    for (let i = 0; i < fixture.positions.length; i++) {
      if (!SATURATED(i)) continue;
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    // Same f32 regime as lakes (offset_x=10000). CALIBRATE this bound just above the
    // observed `worst` printed on first run; do NOT loosen beyond what the data shows.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });

  it("matches near-spawn elevation too (computed starting lakes)", () => {
    let worst = 0;
    let worstLabel = "";
    let checked = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      if (SATURATED(i)) continue;
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      checked++;
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });
});
```

- [ ] **Step 4: Run test; calibrate the bound from the observed worst**

Run: `pnpm vp test test/elevationIsland.spec.ts`
Expected: PASS. If a numeric test fails, read the printed `worst <label>` value. If it is a hair above 8e-3 and the water mask holds, raise the bound to just above the observed worst (as lakes did at ~7.37e-3 -> `< 8e-3`) - and record the value in the comment. If it is large (e.g. > 0.05) or the water mask fails at a well-away-from-zero point, STOP: that is a real finding in the port (bias/seg wiring), not a tolerance to relax - debug with `superpowers:systematic-debugging`.

- [ ] **Step 5: Commit**

```bash
git add test/oracle/capture.ts test/fixtures/oracle-elevation-island.seed123456.json test/elevationIsland.spec.ts
git commit -m "$(cat <<'EOF'
test(noise): oracle parity for elevation_island to the f32 floor

Capture elevation_island ground truth from headless Factorio and assert
makeElevationIsland reproduces it on saturated far-field points and the
near-spawn band (computed starting lakes).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 4: Dispatch `"island"` through the render pipeline

Widen the map-type union so the renderer and worker request carry `"island"`, and make `renderElevation` pick `makeElevationIsland` for it.

**Files:**
- Modify: `src/noise/preview/renderElevation.ts` (union + 3-way factory pick)
- Modify: `src/noise/preview/elevationRenderRequest.ts:19` (union)
- Test: `test/renderElevation.spec.ts` (island dispatch block)

**Interfaces:**
- Consumes: `makeElevationIsland` from Task 2; existing `makeElevationLakes`, `makeElevationNauvis`.
- Produces: `RenderElevationOptions.mapType` and `elevationRenderRequest`'s `mapType` become `"lakes" | "nauvis" | "island"`. `renderElevation` dispatches `"island"` to `makeElevationIsland`.

- [ ] **Step 1: Write the failing test**

Append to the `renderElevation map-type dispatch` describe in `test/renderElevation.spec.ts` (and add the import at the top):

```ts
import { makeElevationIsland } from "../src/noise/expressions/elevationIsland";
```

```ts
  it("uses the island factory when mapType is 'island'", () => {
    const img = renderElevation({
      seed0: 123456,
      width,
      height,
      originX,
      originY,
      tilesPerPixel,
      mapType: "island",
    });
    const evalAt = makeElevationIsland({ seed0: 123456 });
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const wx = originX + px * tilesPerPixel;
        const wy = originY + py * tilesPerPixel;
        const expected = evalAt(wx, wy) < 0 ? WATER_RGBA : LAND_RGBA;
        const o = (py * width + px) * 4;
        expect([img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]).toEqual(expected);
      }
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/renderElevation.spec.ts`
Expected: FAIL - `mapType: "island"` currently falls into the lakes branch, so pixels match lakes, not island (mismatch at points where they disagree). (If the whole tile happens to agree in sign, the test is still valid once implemented; expand `width`/`height` is unnecessary - the 4x4 far-field grid at origin (-1,2) step 3 discriminates.)

- [ ] **Step 3: Write minimal implementation**

In `src/noise/preview/renderElevation.ts`, add the import:

```ts
import { makeElevationIsland } from "../expressions/elevationIsland";
```

Widen the union:

```ts
  /** Which elevation tree to render. Default "lakes". */
  readonly mapType?: "lakes" | "nauvis" | "island";
```

Replace the ternary:

```ts
  const make =
    opts.mapType === "nauvis"
      ? makeElevationNauvis
      : opts.mapType === "island"
        ? makeElevationIsland
        : makeElevationLakes;
```

In `src/noise/preview/elevationRenderRequest.ts:19`, widen the field:

```ts
  mapType?: "lakes" | "nauvis" | "island";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/renderElevation.spec.ts`
Expected: PASS (all three dispatch tests green).

- [ ] **Step 5: Commit**

```bash
git add src/noise/preview/renderElevation.ts src/noise/preview/elevationRenderRequest.ts test/renderElevation.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): dispatch the island map type to makeElevationIsland

Widen the render/worker-request mapType union to include "island" and add
the 3-way factory pick.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 5: Mark Island supported in the preview ctx (and re-point the unsupported-case tests)

Flip `elevationCtxFromPreset` so island reports `supported: true, mapType: "island"`. Two existing tests use island as their "unsupported" example; re-point them to a modded/unknown elevation (which stays unsupported).

**Files:**
- Modify: `src/model/elevationPreviewCtx.ts` (union + supported logic)
- Test: `test/elevationPreviewCtx.spec.ts:28-34` (island now supported; add a modded-unsupported case)
- Test: `test/elevationPreviewPanel.spec.ts` (widen `setup` param; swap the unsupported example to a modded elevation)

**Interfaces:**
- Consumes: `readMapType` (existing); a modded elevation value read back as `{ id: value, label: value, writeValue: value }` with `supported === false`.
- Produces: `ElevationPreviewCtx.mapType` becomes `"lakes" | "nauvis" | "island"`; `elevationCtxFromPreset` returns `supported: true, mapType: "island"` for island presets.

- [ ] **Step 1: Write the failing tests**

In `test/elevationPreviewCtx.spec.ts`, replace the "marks an Island preset unsupported" test (lines 28-34) with:

```ts
  it("marks an Island preset supported with its label and map type", () => {
    const p = getBuiltinPreset("Default");
    writeMapType(p.propertyExpressionNames, "island");
    const r = elevationCtxFromPreset(p);
    expect(r.supported).toBe(true);
    expect(r.mapTypeLabel).toBe("Island elevation");
    expect(r.mapType).toBe("island");
  });

  it("marks a modded/unknown elevation unsupported, preserving its label", () => {
    const p = getBuiltinPreset("Default");
    p.propertyExpressionNames["elevation"] = "elevation_modded_x";
    const r = elevationCtxFromPreset(p);
    expect(r.supported).toBe(false);
    expect(r.mapTypeLabel).toBe("elevation_modded_x");
  });
```

In `test/elevationPreviewPanel.spec.ts`, widen the `setup` signature (line 19) and re-point the unsupported test (~line 95). Change:

```ts
function setup(mapTypeId: "nauvis" | "lakes" | "island", renderer: ElevationRenderer) {
```
to:
```ts
function setup(mapTypeId: string, renderer: ElevationRenderer) {
```

And change the unsupported test body:

```ts
  it("shows a message and does not render for an unsupported map type", async () => {
    const renderer = okRenderer();
    const w = setup("elevation_modded_x", renderer);
    expect(w.find('[data-test="unsupported"]').text()).toContain("elevation_modded_x");
    expect(w.find('[data-test="generate"]').attributes("disabled")).toBeDefined();
    await w.find('[data-test="generate"]').trigger("click");
    expect(renderer.render).not.toHaveBeenCalled();
  });
```

(`writeMapType(pen, "elevation_modded_x")` writes the value verbatim - an id not in MAP_TYPES writes itself - so `setup` needs no other change.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts test/elevationPreviewPanel.spec.ts`
Expected: FAIL - `elevationCtxFromPreset` still returns `supported: false, mapType: "lakes"` for island.

- [ ] **Step 3: Write minimal implementation**

In `src/model/elevationPreviewCtx.ts`, widen the interface field:

```ts
  /** Which client renderer to use when supported. */
  mapType: "lakes" | "nauvis" | "island";
```

Update the doc comment on `supported` (drop "Island" from the unsupported list) and change the resolution in `elevationCtxFromPreset`:

```ts
  const supported = mt.id === "nauvis" || mt.id === "lakes" || mt.id === "island";
  const mapType = mt.id === "nauvis" ? "nauvis" : mt.id === "island" ? "island" : "lakes";
  return {
    supported,
    mapType,
    mapTypeLabel: mt.label,
    ctx: {
      waterLevel: 10 * Math.log2(size),
      segmentationMultiplier: water?.frequency ?? 1,
      startingPositions,
    },
  };
```

Update the top-of-comment `false =>` note to read `(unknown/modded map type)` instead of naming Island.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts test/elevationPreviewPanel.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + lint**

Run: `pnpm vp test`
Expected: PASS (full suite, now including the island specs).
Run: `pnpm vp check`
Expected: clean (no lint/format errors).

- [ ] **Step 6: Commit**

```bash
git add src/model/elevationPreviewCtx.ts test/elevationPreviewCtx.spec.ts test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): render the Island map type client-side

elevationCtxFromPreset now reports Island supported with mapType "island";
the unsupported path is reserved for modded/unknown elevation expressions.
Completes client rendering for all three base map types.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 6: Roadmap + manual verification

Update the roadmap note and eyeball the render in the running app.

**Files:**
- Modify: `docs/noise/client-preview-ROADMAP.md` (mark the island variant done)

- [ ] **Step 1: Update the roadmap**

In `docs/noise/client-preview-ROADMAP.md`, update the island line (~line 94) from "is [not yet ported]" to note it now renders client-side (match the surrounding done-marker style used for nauvis/lakes - check how those were marked and mirror it).

- [ ] **Step 2: Manual smoke test**

Run: `pnpm vp dev`
In the app: Terrain tab -> Map type -> Island. On the Preview tab, click Generate. Expected: a large central landmass surrounded by water (island-in-ocean), NOT the "Client preview is not available for Island elevation yet" message.

- [ ] **Step 3: Commit**

```bash
git add docs/noise/client-preview-ROADMAP.md
git commit -m "$(cat <<'EOF'
docs(preview): mark elevation_island client render done

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- bias parameterization of make_0_12like_lakes -> Task 1. ✓
- makeElevationIsland wrapper (bias -1000, seg/4) + convenience -> Task 2. ✓
- Oracle fixture + f32-floor parity gate -> Task 3. ✓
- Render dispatch union widen + 3-way pick (renderElevation, elevationRenderRequest) -> Task 4. ✓
- elevationPreviewCtx supported/island -> Task 5. ✓
- Validation gate (tolerance from observed worst, never loosened) -> Task 3 Step 4. ✓
- Out of scope (codec/model, climate) -> untouched; mapType.ts already emits elevation_island. ✓
- Test plan (island spec, unchanged existing specs, full suite, lint, manual) -> Tasks 3-6. ✓

**Placeholder scan:** No TBD/TODO. The one calibration point (island's numeric bound) has an explicit procedure and a concrete fallback value (8e-3, as lakes), not a placeholder.

**Type consistency:** `mapType` union is `"lakes" | "nauvis" | "island"` in all three sites (renderElevation, elevationRenderRequest, elevationPreviewCtx). `makeElevationIsland` signature `(ElevationIslandParams) => (x, y) => number` matches its use in Tasks 3-4. `ElevationIslandParams = Omit<ElevationLakesParams, "bias">` and `bias?` added to `ElevationLakesParams` in Task 1 are consistent.

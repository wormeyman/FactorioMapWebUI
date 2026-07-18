# M1 elevation_lakes Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Factorio 2.1.9 `elevation_lakes` map type to a canvas entirely in TypeScript by hand-porting the named noise tree over the already-solved layer-1 primitives, validated against a game-captured oracle fixture.

**Architecture:** A thin-ctx hand-port (no DSL parser). Small pure modules under `src/noise/eval/` (math helpers, `EvalCtx`, a basis expression adapter) and `src/noise/expressions/elevationLakes.ts` (the `make_0_12like_lakes` / `finish_elevation` / `elevationLakes` port). `src/noise/preview/renderElevation.ts` sweeps a pixel grid into an `ImageData` (elevation < 0 => water). Ground truth comes from the existing oracle harness (`test/oracle/`), which routes a named expression onto `elevation` and reads back `calculate_tile_properties`.

**Tech Stack:** TypeScript, Vite-plus (`vite-plus/test`), the existing `src/noise/*` primitives, the `test/oracle/` headless-Factorio harness.

## Global Constraints

- Run everything through pnpm: `pnpm vp test` (full suite), `pnpm vp test test/<file>.spec.ts` (single), `pnpm vp check --fix` (lint + format, the ONLY lint step). Node 24.18.0. A bare/`npx` `vp` fails with `EBADDEVENGINES`.
- Tests import from `"vite-plus/test"` (`describe`, `it`, `expect`).
- `src/noise/*.ts` use **extensionless** relative imports. Spec files import from `../src/noise/...` extensionless.
- Oracle capture scripts run with `node --experimental-strip-types test/oracle/capture.ts <name>` and need a local Factorio 2.1 install (macOS Steam default path is auto-detected; ~1.7 s/run). CI specs never run Factorio - they read committed fixtures.
- Noise floor: the game's own stack self-disagrees by ~2e-6 (fastapprox). Absolute tolerances at near-origin coordinates land around `1e-5`-`1e-4`; large world coordinates diverge further (documented f32 floor) and need a looser far bound.
- All tree constants are already verified against `core/prototypes/noise-programs.lua` in the spec (`docs/superpowers/specs/2026-07-18-m1-elevation-lakes-preview-design.md`). Do NOT re-derive them; copy from the spec.
- Commit style: `feat(noise): ...` for shippable code, `research(noise): ...` for docs/fixtures. Do NOT push (main is auto-mode; commit locally only).
- Commit-message footer (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
  ```
- Writing style: hyphens, not em/en dashes.

## The tree (verified; copy verbatim, do not re-derive)

```
elevationLakes(x, y) = finish_elevation(make_0_12like_lakes(x, y), x, y)

make_0_12like_lakes(x, y):   # bias = 20, terrain_octaves = 8
  seg        = segmentationMultiplier            # default 1
  inputScale = seg / 2
  offsetX    = 10000 / seg
  p          = clamp(amplitude_corrected{seed1=1, octaves=terrain_octaves-2=6,
                       inputScale, offsetX, persistence=0.7, amplitude=0.5} + 0.3, 0.1, 0.9)
  branch1    = 20 + varPers{seed1=1, octaves=8, inputScale, outputScale=0.125, offsetX, p}
  branch2    = 20 + waterLevel - 0.1*seg*distance(x,y)
                  + varPers{seed1=2, octaves=6, inputScale, outputScale=0.125, offsetX, p}
  return max(branch1, branch2)
  # NOTE branch2 uses the LITERAL 20, not the bias param (they coincide here).

finish_elevation(elevation, x, y):
  seg  = segmentationMultiplier
  sld  = distance_from_nearest_point(x, y, startingLakePositions, maximumDistance=1024)
  sln  = quick_multioctave_noise_persistence{seed1=14, inputScale=1/8, outputScale=1,
             octaves=5, octaveInputScaleMultiplier=0.5, persistence=0.75}
  term1 = (elevation - waterLevel) / seg
  term2 = basis{seed1=123, inputScale=1/8, outputScale=1.5} + sld/4 - 4
  term3 = -1 + (sld + sln) / 16
  term4 = max(2, 2 + sld/16 + sln/2)
  return min(term1, term2, term3, term4)

distance(x, y) = distance_from_nearest_point(x, y, startingPositions)   # NO cap
```

## Primitive signatures (from `src/noise/`; consume exactly these)

- `variablePersistenceMultioctaveNoise(x, y, persistence, params, tables?)` and
  `makeVariablePersistenceMultioctaveNoise(params) => (x, y, persistence) => number`.
  `params = { seed0, seed1, octaves, inputScale, outputScale, offsetX }`.
- `amplitudeCorrectedMultioctaveNoise(x, y, params)` with
  `params = { seed0, seed1, octaves, inputScale, offsetX, persistence, amplitude }`.
- `quickMultioctaveNoisePersistence(x, y, params)` with
  `params = { seed0, seed1, octaves, inputScale, outputScale, octaveInputScaleMultiplier, persistence }`.
- `basisNoise(x, y, tables)` (x, y already in **noise space**) and
  `basisNoiseTablesFromSeed(seed0, seed1) => BasisNoiseTables`.
- `distanceFromNearestPoint(x, y, points, maximumDistance = Infinity)`; `Point = { x, y }`.

## File Structure

- Create `src/noise/eval/math.ts` - `clamp`, `lerp`, varargs `min`/`max`, `log2`.
- Create `src/noise/eval/ctx.ts` - `EvalCtx` type, `Point` re-export, `DEFAULT_CTX`, `withCtxDefaults`.
- Create `src/noise/eval/primitives.ts` - `basisNoiseExpr` (scale/offset/output wrapper over `basisNoise`).
- Create `src/noise/expressions/elevationLakes.ts` - `makeElevationLakes`, `elevationLakes`, internal `make_0_12like_lakes` / `finish_elevation`.
- Create `src/noise/preview/renderElevation.ts` - `renderElevation` grid sweep -> `ImageData`.
- Modify `test/oracle/capture.ts` - add `captureElevationLakes()`.
- Create fixture `test/fixtures/oracle-elevation-lakes.seed123456.json` (committed, from Task 0).
- Create `test/eval/math.spec.ts`, `test/eval/primitives.spec.ts`, `test/elevationLakes.spec.ts`, `test/renderElevation.spec.ts`.

---

### Task 0: Oracle spike - prove full-tree sampling and pin the ctx assumption

De-risks the whole milestone (spec C1): nothing has ever sampled a full named tree through the harness, and the `startingPositions=[{0,0}]` / `startingLakePositions=[]` assumption is unverified. This task runs the live game (needs Factorio) and commits the fixture the CI spec (Task 4) reads. It produces no pure-TS code, so it is not red/green TDD; its deliverable is the committed fixture plus a recorded ctx decision.

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureElevationLakes`)
- Create: `test/fixtures/oracle-elevation-lakes.seed123456.json`

**Interfaces:**
- Consumes: `sampleExpression(expression, positions, { workDir, seed })` from `test/oracle/oracle.ts`.
- Produces: fixture shape `{ seed0: number, positions: {x,y}[], elevation: number[], distance: number[], startingLakeDistance: number[] }`, consumed by Task 4.

- [ ] **Step 1: Add the capture function**

Add to `test/oracle/capture.ts` (after `captureMultioctaveWrappers`, before the `oracleAvailable()` guard):

```ts
/**
 * The full `elevation_lakes` tree - the first NAMED TREE sampled through the
 * harness. Also captures the two free-var distances (`distance` over
 * starting_positions, and starting_lake_distance capped at 1024) so the CI spec
 * can both drive the EvalCtx assumption and validate distanceFromNearestPoint
 * end-to-end. The grid spans a near-origin band AND far (>1200 tile) points so
 * both `distance` regimes (hypot-driven near spawn, branch2-collapsed far out)
 * are exercised.
 */
async function captureElevationLakes(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  // Near-origin band (exercises branch2 competition + hypot distance).
  for (let gy = 0; gy < 5; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      positions.push({ x: gx * 11 - 22 + 0.5, y: gy * 13 - 26 + 0.25 });
    }
  }
  // Far points (>1200 tiles: branch1 dominates, starting_lake_distance saturates).
  positions.push(
    { x: 1500.5, y: 0.25 },
    { x: -1800.5, y: 900.75 },
    { x: 3000.25, y: -2500.5 },
    { x: 12345.75, y: 6789.125 },
  );

  const sample = async (expression: string): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  const elevation = await sample("elevation_lakes");
  console.log("  captured elevation_lakes tree");
  const distance = await sample("distance_from_nearest_point{x = x, y = y, points = starting_positions}");
  console.log("  captured distance (starting_positions)");
  const startingLakeDistance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_lake_positions, maximum_distance = 1024}",
  );
  console.log("  captured starting_lake_distance");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_lakes (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-lakes",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-lakes.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}
```

Then register it in the CLI dispatch block at the bottom:

```ts
if (want("elevation-lakes")) await captureElevationLakes();
```

- [ ] **Step 2: Run the capture**

Run: `node --experimental-strip-types test/oracle/capture.ts elevation-lakes`
Expected: three "captured ..." lines then `wrote .../oracle-elevation-lakes.seed123456.json (29 points)`. If it errors with "oracle produced no dump", read the printed Factorio stderr tail - a free var not being available at `on_init` would show here (that is exactly the risk this task exists to surface).

- [ ] **Step 3: Record the ctx decision**

Open the fixture. For every point compare `distance[i]` against `Math.hypot(positions[i].x, positions[i].y)`:
- If they match to ~1e-3 for all points => the game's `starting_positions` is the single origin spawn `[{0,0}]`; `EvalCtx` default `startingPositions=[{x:0,y:0}]` is faithful everywhere.
- If `startingLakeDistance[i]` is `1024` at every point => `starting_lake_positions` is empty; default `startingLakePositions=[]` is faithful.
- If EITHER differs, note the actual behavior. Task 4's spec ctx must then use whatever reproduces the fixture (e.g. read the points implied by the distances), and the render's far-from-spawn fidelity limit must be documented in `renderElevation.ts`.

Append a short "Task 0 result" note to the spec file (`docs/superpowers/specs/2026-07-18-m1-elevation-lakes-preview-design.md`) recording which branch held.

- [ ] **Step 4: Commit**

```bash
git add test/oracle/capture.ts test/fixtures/oracle-elevation-lakes.seed123456.json docs/superpowers/specs/2026-07-18-m1-elevation-lakes-preview-design.md
git commit -m "research(noise): capture elevation_lakes tree + free-var distances oracle fixture

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 1: eval/math.ts - tiny math helpers

**Files:**
- Create: `src/noise/eval/math.ts`
- Test: `test/eval/math.spec.ts`

**Interfaces:**
- Produces: `clamp(v, lo, hi)`, `lerp(a, b, t)`, `min(...xs)`, `max(...xs)`, `log2(x)` - all `(number) => number`.

- [ ] **Step 1: Write the failing test**

Create `test/eval/math.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { clamp, lerp, max, min, log2 } from "../../src/noise/eval/math";

describe("eval/math", () => {
  it("clamps into [lo, hi]", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it("lerps endpoints and midpoint", () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });

  it("min/max take varargs", () => {
    expect(min(3, 1, 2)).toBe(1);
    expect(max(3, 1, 2)).toBe(3);
    expect(min(-1)).toBe(-1);
  });

  it("log2 matches Math.log2 (default size => 0)", () => {
    expect(log2(1)).toBe(0);
    expect(log2(8)).toBeCloseTo(3, 12);
    expect(log2(0.5)).toBeCloseTo(-1, 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/eval/math.spec.ts`
Expected: FAIL - cannot resolve `../../src/noise/eval/math`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/eval/math.ts`:

```ts
/**
 * Tiny math helpers matching the game's noise DSL operators, so a hand-ported
 * named expression reads 1:1 with the Lua (`min(a, b, c)`, `clamp(x, lo, hi)`, ...).
 */

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolate: `a` at `t=0`, `b` at `t=1`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Variadic min (the DSL's `min(...)`). */
export function min(...xs: number[]): number {
  return Math.min(...xs);
}

/** Variadic max (the DSL's `max(...)`). */
export function max(...xs: number[]): number {
  return Math.max(...xs);
}

/**
 * Base-2 log (the DSL's `log2`, used by `water_level = 10 * log2(control:water:size)`).
 * Plain `Math.log2`; the game's fastapprox variant only matters once the
 * water-coverage slider is wired (default size = 1 => 0, exact either way).
 */
export function log2(x: number): number {
  return Math.log2(x);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/eval/math.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/noise/eval/math.ts test/eval/math.spec.ts
git commit -m "feat(noise): eval/math helpers (clamp, lerp, min, max, log2)

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 2: eval/ctx.ts - EvalCtx type and defaults

**Files:**
- Create: `src/noise/eval/ctx.ts`
- Test: `test/eval/ctx.spec.ts`

**Interfaces:**
- Consumes: `Point` from `../distanceFromNearestPoint`.
- Produces:
  - `interface EvalCtx { x; y; seed0; waterLevel; segmentationMultiplier; startingPositions: Point[]; startingLakePositions: Point[] }`
  - `type EvalCtxInput = { seed0: number } & Partial<Omit<EvalCtx, "seed0">>`
  - `withCtxDefaults(input: EvalCtxInput): EvalCtx`
  - `DEFAULT_CTX_FIELDS` (the non-coordinate defaults).

- [ ] **Step 1: Write the failing test**

Create `test/eval/ctx.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { withCtxDefaults } from "../../src/noise/eval/ctx";

describe("eval/ctx", () => {
  it("fills the far-from-spawn defaults", () => {
    const ctx = withCtxDefaults({ seed0: 123456, x: 3, y: 4 });
    expect(ctx.waterLevel).toBe(0);
    expect(ctx.segmentationMultiplier).toBe(1);
    expect(ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
    expect(ctx.startingLakePositions).toEqual([]);
    expect(ctx.x).toBe(3);
    expect(ctx.y).toBe(4);
    expect(ctx.seed0).toBe(123456);
  });

  it("lets callers override any default", () => {
    const ctx = withCtxDefaults({
      seed0: 1,
      x: 0,
      y: 0,
      segmentationMultiplier: 0.25,
      startingLakePositions: [{ x: 10, y: 10 }],
    });
    expect(ctx.segmentationMultiplier).toBe(0.25);
    expect(ctx.startingLakePositions).toEqual([{ x: 10, y: 10 }]);
    // untouched defaults still apply
    expect(ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/eval/ctx.spec.ts`
Expected: FAIL - cannot resolve `../../src/noise/eval/ctx`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/eval/ctx.ts`:

```ts
import type { Point } from "../distanceFromNearestPoint";

export type { Point };

/**
 * The complete free-variable environment the `elevation_lakes` tree needs. Every
 * field maps to a game noise variable: `seed0 = map_seed`,
 * `waterLevel = 10*log2(control:water:size)`, `segmentationMultiplier =
 * control:water:frequency`, and the two spawn/lake point lists. `distance` is NOT
 * stored - it is derived from `startingPositions` at evaluation time (single source
 * of truth). No `control:*` constant is referenced by elevation_lakes, so none are
 * plumbed.
 */
export interface EvalCtx {
  x: number;
  y: number;
  seed0: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  startingLakePositions: Point[];
}

/** Everything except the required `seed0` may be omitted and defaulted. */
export type EvalCtxInput = { seed0: number } & Partial<Omit<EvalCtx, "seed0">>;

/** The far-from-spawn MVP defaults (see the M1 design spec). */
export const DEFAULT_CTX_FIELDS = {
  x: 0,
  y: 0,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }] as Point[],
  startingLakePositions: [] as Point[],
};

/** Apply the M1 defaults over a partial input. Array defaults are fresh per call. */
export function withCtxDefaults(input: EvalCtxInput): EvalCtx {
  return {
    x: input.x ?? DEFAULT_CTX_FIELDS.x,
    y: input.y ?? DEFAULT_CTX_FIELDS.y,
    seed0: input.seed0,
    waterLevel: input.waterLevel ?? DEFAULT_CTX_FIELDS.waterLevel,
    segmentationMultiplier:
      input.segmentationMultiplier ?? DEFAULT_CTX_FIELDS.segmentationMultiplier,
    startingPositions: input.startingPositions ?? [{ x: 0, y: 0 }],
    startingLakePositions: input.startingLakePositions ?? [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/eval/ctx.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/noise/eval/ctx.ts test/eval/ctx.spec.ts
git commit -m "feat(noise): EvalCtx type + far-from-spawn defaults

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 3: eval/primitives.ts - basis expression adapter

The one primitive whose game form (`basis_noise{input_scale, output_scale}`) is not already wrapped. `basisNoise(x, y, tables)` takes **noise-space** coords and has no output scale; this adapter applies `offset_x`, `input_scale`, `output_scale` exactly as the DSL does.

**Files:**
- Create: `src/noise/eval/primitives.ts`
- Test: `test/eval/primitives.spec.ts`

**Interfaces:**
- Consumes: `basisNoise`, `basisNoiseTablesFromSeed`, `BasisNoiseTables` from `../basisNoise`.
- Produces: `basisNoiseExpr(x, y, params, tables?)` where
  `params = { seed0, seed1, inputScale, outputScale, offsetX? }` (offsetX defaults 0).

- [ ] **Step 1: Write the failing test**

Create `test/eval/primitives.spec.ts` (validates the scale/output wrapping against the committed basis fixture, which was captured at `input_scale = 0.125, output_scale = 1, offset_x = 0`):

```ts
import { describe, expect, it } from "vite-plus/test";
import basisFixture from "../fixtures/basis-noise.seed123456.json";
import type { BasisNoiseTables } from "../../src/noise/basisNoise";
import { basisNoiseExpr } from "../../src/noise/eval/primitives";

const tables: BasisNoiseTables = {
  sigma: basisFixture.sigma,
  a: basisFixture.a,
  b: basisFixture.b,
};

describe("eval/primitives basisNoiseExpr", () => {
  it("reproduces the game's basis_noise with input/output scale (output_scale=1)", () => {
    let worst = 0;
    for (const p of basisFixture.points) {
      const got = basisNoiseExpr(
        p.x,
        p.y,
        { seed0: basisFixture.seed0, seed1: basisFixture.seed1, inputScale: basisFixture.inputScale, outputScale: 1 },
        tables,
      );
      worst = Math.max(worst, Math.abs(got - p.v));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("scales linearly with output_scale", () => {
    const base = basisNoiseExpr(3.5, -2.25, { seed0: 1, seed1: 123, inputScale: 1 / 8, outputScale: 1 });
    const scaled = basisNoiseExpr(3.5, -2.25, { seed0: 1, seed1: 123, inputScale: 1 / 8, outputScale: 1.5 });
    expect(scaled).toBeCloseTo(base * 1.5, 12);
  });

  it("applies offset_x before input_scale", () => {
    const withOffset = basisNoiseExpr(0, 1.5, { seed0: 1, seed1: 123, inputScale: 1 / 8, outputScale: 1, offsetX: 16 });
    const shifted = basisNoiseExpr(16, 1.5, { seed0: 1, seed1: 123, inputScale: 1 / 8, outputScale: 1 });
    expect(withOffset).toBeCloseTo(shifted, 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/eval/primitives.spec.ts`
Expected: FAIL - cannot resolve `../../src/noise/eval/primitives`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/eval/primitives.ts`:

```ts
import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "../basisNoise";

export interface BasisExprParams {
  /** Map seed (basis seed word). */
  readonly seed0: number;
  /** Per-call seed selector (e.g. 123 for finish_elevation's basis term). */
  readonly seed1: number;
  /** Noise units per world tile. */
  readonly inputScale: number;
  /** Overall output multiplier. */
  readonly outputScale: number;
  /** World-space x translation applied before input_scale. Default 0. */
  readonly offsetX?: number;
}

/**
 * `basis_noise{input_scale, output_scale, offset_x}` in expression form. The raw
 * {@link basisNoise} takes noise-space coords and has no output scale, so this
 * adapter maps world `(x, y)` through `((x + offset_x) * input_scale, y *
 * input_scale)` and multiplies by `output_scale` - exactly the game's DSL. Pass
 * prebuilt `tables` to skip the per-seed derivation when sweeping a grid.
 */
export function basisNoiseExpr(
  x: number,
  y: number,
  params: BasisExprParams,
  tables: BasisNoiseTables = basisNoiseTablesFromSeed(params.seed0, params.seed1),
): number {
  const offsetX = params.offsetX ?? 0;
  return (
    params.outputScale *
    basisNoise((x + offsetX) * params.inputScale, y * params.inputScale, tables)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/eval/primitives.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/noise/eval/primitives.ts test/eval/primitives.spec.ts
git commit -m "feat(noise): basisNoiseExpr adapter (input/output scale + offset_x)

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 4: expressions/elevationLakes.ts - the tree port

The core deliverable: `make_0_12like_lakes` + `finish_elevation` + `elevationLakes`, validated against the Task 0 fixture. `makeElevationLakes(params)` builds the two heavy varPers closures and the basis-123 tables ONCE (spec N6), then returns a per-point evaluator; the lighter amplitude-corrected and quick-persistence primitives are called per point (their table-hoisting is a deferred perf follow-up).

**Files:**
- Create: `src/noise/expressions/elevationLakes.ts`
- Test: `test/elevationLakes.spec.ts`

**Interfaces:**
- Consumes: `makeVariablePersistenceMultioctaveNoise`, `amplitudeCorrectedMultioctaveNoise` (`../variablePersistenceMultioctaveNoise`); `quickMultioctaveNoisePersistence` (`../quickMultioctaveNoise`); `basisNoiseTablesFromSeed` (`../basisNoise`); `basisNoiseExpr` (`../eval/primitives`); `distanceFromNearestPoint` (`../distanceFromNearestPoint`); `clamp`, `min`, `max` (`../eval/math`); `EvalCtx`, `EvalCtxInput`, `withCtxDefaults` (`../eval/ctx`).
- Produces:
  - `interface ElevationLakesParams { seed0; waterLevel?; segmentationMultiplier?; startingPositions?; startingLakePositions? }`
  - `makeElevationLakes(params: ElevationLakesParams) => (x: number, y: number) => number`
  - `elevationLakes(ctx: EvalCtxInput) => number`

- [ ] **Step 1: Write the failing test**

Create `test/elevationLakes.spec.ts`. It uses `makeElevationLakes` once and sweeps the fixture points. The CI-relevant invariant is the **water mask** (`elevation < 0`); numeric parity is asserted with a near/far split (large world coordinates hit the documented f32 floor). If Task 0 recorded a non-default ctx, set `ctxOverrides` accordingly (default `{}` for the confirmed far-from-spawn case).

```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-elevation-lakes.seed123456.json";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";

// If Task 0 proved the game's starting_positions is the origin spawn and
// starting_lake_positions is empty, the EvalCtx defaults are faithful and this
// stays empty. Otherwise set the points Task 0 recorded.
const ctxOverrides = {} as {
  startingPositions?: { x: number; y: number }[];
  startingLakePositions?: { x: number; y: number }[];
};

describe("elevationLakes reproduces the game's elevation_lakes tree", () => {
  const evalAt = makeElevationLakes({ seed0: fixture.seed0, ...ctxOverrides });

  it("matches the water mask (elevation < 0) away from the coastline", () => {
    for (let i = 0; i < fixture.positions.length; i++) {
      const exp = fixture.elevation[i];
      if (Math.abs(exp) < 1e-3) continue; // coastline: sign is ambiguous within the floor
      const p = fixture.positions[i];
      const got = evalAt(p.x, p.y);
      expect(got < 0).toBe(exp < 0);
    }
  });

  it("matches the numeric elevation to the noise floor (near) / f32 floor (far)", () => {
    let worstNear = 0;
    let worstFar = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      const p = fixture.positions[i];
      const got = evalAt(p.x, p.y);
      const err = Math.abs(got - fixture.elevation[i]);
      const far = Math.abs(p.x) > 500 || Math.abs(p.y) > 500;
      if (far) worstFar = Math.max(worstFar, err);
      else worstNear = Math.max(worstNear, err);
    }
    // Near-origin: a handful of stacked basis evals over the ~2e-6 floor.
    expect(worstNear).toBeLessThan(1e-3);
    // Far: the game's f32 coordinate pipeline diverges from our f64.
    expect(worstFar).toBeLessThan(1e-1);
  });
});
```

Note: the bounds are calibrated guardrails - after Step 4 tighten them to just above the observed `worstNear`/`worstFar` (do NOT loosen them to pass; a large error is a real bug to debug via systematic-debugging).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationLakes.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/expressions/elevationLakes`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/expressions/elevationLakes.ts`:

```ts
import { basisNoiseTablesFromSeed } from "../basisNoise";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp, max, min } from "../eval/math";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";
import { quickMultioctaveNoisePersistence } from "../quickMultioctaveNoise";
import {
  amplitudeCorrectedMultioctaveNoise,
  makeVariablePersistenceMultioctaveNoise,
} from "../variablePersistenceMultioctaveNoise";

export interface ElevationLakesParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** 10*log2(control:water:size); default 0. */
  readonly waterLevel?: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
  /** Spawn points for `distance` (uncapped). Default single origin spawn. */
  readonly startingPositions?: Point[];
  /** Lake points for `starting_lake_distance` (capped at 1024). Default empty. */
  readonly startingLakePositions?: Point[];
}

/**
 * Compile the `elevation_lakes` tree for one seed into a `(x, y) => elevation`
 * evaluator. The two heavy variable-persistence octave stacks (8 and 6 octaves)
 * and the basis-123 tables are derived once here; the lighter amplitude-corrected
 * persistence field and the quick-persistence lake noise are evaluated per point
 * (hoisting their tables is a deferred perf follow-up). Mirrors
 * core/prototypes/noise-programs.lua 1:1 - see the M1 design spec.
 */
export function makeElevationLakes(
  params: ElevationLakesParams,
): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const waterLevel = params.waterLevel ?? 0;
  const seg = params.segmentationMultiplier ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];
  const startingLakePositions = params.startingLakePositions ?? [];

  // make_0_12like_lakes locals (bias = 20, terrain_octaves = 8).
  const bias = 20;
  const terrainOctaves = 8;
  const inputScale = seg / 2;
  const offsetX = 10000 / seg;

  // Heavy octave stacks: build closures once (persistence still varies per tile).
  const varPers1 = makeVariablePersistenceMultioctaveNoise({
    seed0,
    seed1: 1,
    octaves: terrainOctaves,
    inputScale,
    outputScale: 0.125,
    offsetX,
  });
  const varPers2 = makeVariablePersistenceMultioctaveNoise({
    seed0,
    seed1: 2,
    octaves: 6,
    inputScale,
    outputScale: 0.125,
    offsetX,
  });

  // finish_elevation's basis term (seed1 = 123): derive tables once.
  const basisTables123 = basisNoiseTablesFromSeed(seed0, 123);

  const make0_12likeLakes = (x: number, y: number): number => {
    // persistence field: clamp(amplitude_corrected + 0.3, 0.1, 0.9), fed to BOTH branches.
    const p = clamp(
      amplitudeCorrectedMultioctaveNoise(x, y, {
        seed0,
        seed1: 1,
        octaves: terrainOctaves - 2,
        inputScale,
        offsetX,
        persistence: 0.7,
        amplitude: 0.5,
      }) + 0.3,
      0.1,
      0.9,
    );
    const distance = distanceFromNearestPoint(x, y, startingPositions);
    const branch1 = bias + varPers1(x, y, p);
    // NOTE: literal 20, not `bias` (they coincide at elevation_lakes).
    const branch2 = 20 + waterLevel - 0.1 * seg * distance + varPers2(x, y, p);
    return max(branch1, branch2);
  };

  const finishElevation = (elevation: number, x: number, y: number): number => {
    const sld = distanceFromNearestPoint(x, y, startingLakePositions, 1024);
    const sln = quickMultioctaveNoisePersistence(x, y, {
      seed0,
      seed1: 14,
      octaves: 5,
      inputScale: 1 / 8,
      outputScale: 1,
      octaveInputScaleMultiplier: 0.5,
      persistence: 0.75,
    });
    const term1 = (elevation - waterLevel) / seg;
    const term2 =
      basisNoiseExpr(x, y, { seed0, seed1: 123, inputScale: 1 / 8, outputScale: 1.5 }, basisTables123) +
      sld / 4 -
      4;
    const term3 = -1 + (sld + sln) / 16;
    const term4 = max(2, 2 + sld / 16 + sln / 2);
    return min(term1, term2, term3, term4);
  };

  return (x: number, y: number): number => finishElevation(make0_12likeLakes(x, y), x, y);
}

/**
 * Evaluate `elevation_lakes` at a single point. Convenience over
 * {@link makeElevationLakes} - for sweeping a grid, call makeElevationLakes once
 * and reuse the returned evaluator.
 */
export function elevationLakes(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationLakes({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationLakes.spec.ts`
Expected: PASS (2 tests). Read the actual `worstNear`/`worstFar` if a bound fails; if `worstNear` is far above `1e-3`, that is a real port bug - debug with systematic-debugging, do NOT loosen the bound. If it passes comfortably, tighten each bound to just above the observed worst and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/noise/expressions/elevationLakes.ts test/elevationLakes.spec.ts
git commit -m "feat(noise): port elevation_lakes tree (make_0_12like_lakes + finish_elevation)

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 5: preview/renderElevation.ts - grid sweep to ImageData

**Files:**
- Create: `src/noise/preview/renderElevation.ts`
- Test: `test/renderElevation.spec.ts`

**Interfaces:**
- Consumes: `makeElevationLakes`, `ElevationLakesParams` (`../expressions/elevationLakes`).
- Produces:
  - `interface RenderElevationOptions { seed0; width; height; originX?; originY?; tilesPerPixel?; ctx?: Omit<ElevationLakesParams, "seed0"> }`
  - `renderElevation(opts): ImageData`
  - `WATER_RGBA`, `LAND_RGBA` (exported `[r,g,b,a]` tuples).

- [ ] **Step 1: Write the failing test**

Create `test/renderElevation.spec.ts`. `ImageData` is a DOM type; the test constructs the tree evaluator's expected mask independently and checks a few pixels, and asserts dimensions. Guard against `ImageData` being undefined in the test env by falling back to a minimal shim only if needed.

```ts
import { describe, expect, it } from "vite-plus/test";
import { renderElevation, WATER_RGBA, LAND_RGBA } from "../src/noise/preview/renderElevation";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";

describe("renderElevation", () => {
  it("produces an ImageData of the requested size", () => {
    const img = renderElevation({ seed0: 123456, width: 8, height: 6 });
    expect(img.width).toBe(8);
    expect(img.height).toBe(6);
    expect(img.data.length).toBe(8 * 6 * 4);
  });

  it("colors each pixel by the sign of elevation at its world tile", () => {
    const width = 4;
    const height = 4;
    const originX = -1;
    const originY = 2;
    const tilesPerPixel = 3;
    const img = renderElevation({ seed0: 123456, width, height, originX, originY, tilesPerPixel });
    const evalAt = makeElevationLakes({ seed0: 123456 });
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/renderElevation.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/preview/renderElevation`.

- [ ] **Step 3: Write minimal implementation**

Create `src/noise/preview/renderElevation.ts`:

```ts
import { makeElevationLakes, type ElevationLakesParams } from "../expressions/elevationLakes";

/** RGBA for water (elevation < 0) and land, as [r, g, b, a] byte tuples. */
export const WATER_RGBA: [number, number, number, number] = [40, 90, 150, 255];
export const LAND_RGBA: [number, number, number, number] = [70, 120, 60, 255];

export interface RenderElevationOptions {
  /** Map seed (= map_seed / seed0). Callers resolve a null "random" seed first. */
  readonly seed0: number;
  /** Output pixel dimensions. */
  readonly width: number;
  readonly height: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** Non-seed tree params (waterLevel, segmentationMultiplier, spawn/lake points). */
  readonly ctx?: Omit<ElevationLakesParams, "seed0">;
}

/**
 * Sweep a `width x height` pixel grid over world space and return an `ImageData`
 * whose pixels are {@link WATER_RGBA} where `elevation_lakes < 0` and
 * {@link LAND_RGBA} otherwise. The tree evaluator is compiled once (heavy octave
 * closures built up front) and reused across pixels.
 *
 * Far-from-spawn fidelity: the render uses the EvalCtx spawn/lake defaults unless
 * overridden via `ctx`. Near the starting area the game's actual spawn/lake points
 * would shift the coastline; see the M1 design spec for the fidelity limit.
 */
export function renderElevation(opts: RenderElevationOptions): ImageData {
  const { width, height } = opts;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const evalAt = makeElevationLakes({ seed0: opts.seed0, ...opts.ctx });
  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const wx = originX + px * tpp;
      const rgba = evalAt(wx, wy) < 0 ? WATER_RGBA : LAND_RGBA;
      const o = (py * width + px) * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
  }

  return new ImageData(data, width, height);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/renderElevation.spec.ts`
Expected: PASS (2 tests). If `ImageData` is undefined in the test environment, the failure will be a `ReferenceError`; resolve by confirming the jsdom/happy-dom env is active for this spec (the repo's other DOM specs, e.g. `test/app.spec.ts`, establish the pattern - match their environment setup) rather than hand-rolling a shim.

- [ ] **Step 5: Commit**

```bash
git add src/noise/preview/renderElevation.ts test/renderElevation.spec.ts
git commit -m "feat(noise): renderElevation grid sweep -> ImageData water mask

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```

---

### Task 6: Full-suite green + lint, and manual coastline eyeball

**Files:** none (verification task).

- [ ] **Step 1: Run the full suite**

Run: `pnpm vp test`
Expected: all specs PASS (the prior 478 + the new eval/tree/render specs). If anything unrelated broke, debug with systematic-debugging.

- [ ] **Step 2: Lint + format**

Run: `pnpm vp check --fix`
Expected: clean (no remaining errors). Re-run `pnpm vp test` if `--fix` changed files.

- [ ] **Step 3: Manual coastline eyeball (gated on Factorio)**

Generate a real preview and compare the coastline shape (not pixel-exact) to a small `renderElevation` dump over the same window:

Run: `factorio --generate-map-preview /tmp/lakes.png --map-gen-settings <settings routing elevation=elevation_lakes> --map-gen-seed 123456`
(Reuse the oracle harness's settings-building approach if a standalone settings file is easier.) Confirm the land/water boundary matches the intent. Note (spec N7): confirm `elevation < 0 => water` aligns with the game's land/water boundary; if the game's shoreline sits at a non-zero threshold, record it for a follow-up.

- [ ] **Step 4: Commit any lint/format changes**

```bash
git add -A
git commit -m "chore(noise): lint/format after M1 elevation_lakes preview

$(cat <<'EOF'
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U2uhoT8vbYXnBKk9GWfAvg
EOF
)"
```
(Skip the commit if nothing changed.)

---

## Self-Review

**Spec coverage:**
- Far-from-spawn ctx (spec decision 1) -> Task 2 defaults + Task 0 validation.
- Thin-ctx hand-port (decision 2) -> Tasks 1-4 (plain TS, math helpers, no parser).
- elevation_lakes only (decision 3) -> Task 4; Nauvis deferred (not in any task).
- Tree fidelity constants -> Task 4 code copied from the spec's verified block.
- C1 oracle de-risking + Task 0 -> Task 0.
- S2 all-4-terms always computed -> Task 4 `finishElevation` computes term1..term4 unconditionally.
- S3 basis + starting_lake_noise adapters -> Task 3 (`basisNoiseExpr`) + Task 4 (`quickMultioctaveNoisePersistence` call).
- S4 distance uncapped vs 1024 -> Task 4 (`distanceFromNearestPoint(x,y,startingPositions)` no cap; `...startingLakePositions, 1024`).
- S5 literal 20 in branch2 -> Task 4 comment + code.
- N6 closure reuse -> Task 4 `makeElevationLakes` builds varPers closures + basis tables once.
- N7 water threshold eyeball -> Task 6 Step 3.
- N8 log2 not gold-plated -> Task 1 `log2` = `Math.log2` with a note.
- N9 seed resolution is caller's job -> Task 5 `seed0` is required and explicit; comment notes null-resolution upstream.

**Placeholder scan:** No TBD/TODO. The Task 4 numeric bounds are concrete guardrails with an explicit calibrate-tighter (never loosen) instruction, not placeholders. Task 0's ctx-branch note is a genuine capture-time decision with both branches specified.

**Type consistency:** `makeElevationLakes(params)` / `elevationLakes(ctx)` names and the `(x,y)=>number` evaluator shape are consistent across Tasks 4-5. `basisNoiseExpr(x, y, params, tables?)` signature matches between Task 3 definition and Task 4 consumption. `EvalCtxInput` / `withCtxDefaults` match between Tasks 2 and 4. `WATER_RGBA`/`LAND_RGBA` tuple types match between Task 5 definition and test.

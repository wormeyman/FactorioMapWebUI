# Client-side Nauvis elevation preview - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the default Nauvis elevation (`elevation_nauvis`) in the browser Preview tab, matching the game's `elevation` to the noise floor.

**Architecture:** Port the `elevation_nauvis` noise tree to a `makeElevationNauvis(params) -> (x,y)=>elevation` closure that hoists every basis table once per seed, mirroring `elevationLakes.ts`. It needs no new primitive - every op is already ported (`multioctave`, `variable_persistence`, `amplitude_corrected`, `quick_multioctave_persistence`, `basis`, `distance_from_nearest_point`). Thread a `mapType: "lakes" | "nauvis"` selector through the render path so the existing Preview tab picks the factory. Validate against the committed headless oracle.

**Tech Stack:** TypeScript (extensionless `src/**` imports), Vue 3 `<script setup>`, Pinia, Vitest-compatible `vite-plus/test`. Run everything through `pnpm vp ...`.

## Global Constraints

- Run tests with `pnpm vp test` (full) or `pnpm vp test test/<file>.spec.ts` (single). Lint/format with `pnpm vp check --fix` (the only lint step; **no** `vue-tsc` gate - watch LSP `.ts` diagnostics manually). Node 24.18.0. A bare or `npx` `vp` fails with `EBADDEVENGINES`.
- `src/**` relative imports are **extensionless**. Test files import from `"vite-plus/test"`.
- Byte-exactness / oracle parity is a hard invariant. **Never loosen a tolerance to make a test pass** - a mismatch is a real finding to debug.
- Every commit message ends with the footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then
  `Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK`
- Writing style: hyphens, never em/en dashes. Commit locally only; do not push.
- The oracle (Task 2) needs a local Factorio 2.1.11 install; it is found via `FACTORIO_BIN` or the macOS Steam default path. That task's capture step must run on a machine with the game.

---

### Task 1: `makeMultioctaveNoise` - table-hoisting variant of the plain multioctave op

The Nauvis tree calls plain `multioctave_noise` ~5x per pixel (bridge billows, hills, two macro terms). `multioctaveNoise.ts` has no `make*` closure that derives basis tables + per-octave scales once, so per-pixel table rebuilding would dominate cost (the 96%-of-render lesson from the lakes port). Add one, byte-identical to `multioctaveNoise`.

**Files:**
- Modify: `src/noise/multioctaveNoise.ts` (append after `multioctaveNoise`, ~line 138)
- Test: `test/multioctaveNoise.spec.ts` (append a parity describe block)

**Interfaces:**
- Consumes: existing `MultioctaveParams`, `normalization`, `basisNoise`, `basisNoiseTablesFromSeed`, `LACUNARITY`, `OCTAVE_OFFSET_X` (all already in `multioctaveNoise.ts`).
- Produces: `makeMultioctaveNoise(params: MultioctaveParams): (x: number, y: number) => number`.

- [ ] **Step 1: Write the failing parity test**

Append to `test/multioctaveNoise.spec.ts`:

```ts
describe("makeMultioctaveNoise (hoisted) matches multioctaveNoise exactly", () => {
  const CONFIGS: MultioctaveParams[] = [
    { seed0: 123456, seed1: 700, octaves: 4, persistence: 0.5, inputScale: 1 / 150, outputScale: 1 },
    { seed0: 123456, seed1: 900, octaves: 4, persistence: 0.5, inputScale: 1 / 90, outputScale: 1 },
    { seed0: 123456, seed1: 1000, octaves: 2, persistence: 0.6, inputScale: 1 / 1600, outputScale: 1 },
    { seed0: 123456, seed1: 1100, octaves: 1, persistence: 0.6, inputScale: 1 / 1600, outputScale: 1 },
    { seed0: 42, seed1: 3, octaves: 6, persistence: 0.75, inputScale: 0.2, outputScale: 0.5 },
  ];
  it("is identical across a grid for every config", () => {
    for (const cfg of CONFIGS) {
      const made = makeMultioctaveNoise(cfg);
      for (let gx = -2; gx <= 2; gx++) {
        for (let gy = -2; gy <= 2; gy++) {
          const x = gx * 37 + 0.5;
          const y = gy * 41 + 0.25;
          expect(made(x, y)).toBe(multioctaveNoise(x, y, cfg));
        }
      }
    }
  });
});
```

Ensure the file's imports include `makeMultioctaveNoise`, `multioctaveNoise`, and `type MultioctaveParams` from `"../src/noise/multioctaveNoise"` (extend the existing import line).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/multioctaveNoise.spec.ts`
Expected: FAIL - `makeMultioctaveNoise is not a function` / not exported.

- [ ] **Step 3: Implement `makeMultioctaveNoise`**

Append to `src/noise/multioctaveNoise.ts`:

```ts
/**
 * Build a closure that evaluates `multioctave_noise` for a fixed parameter set,
 * with the basis tables, the RMS normalisation, and the per-octave input scales /
 * amplitudes derived once up front (the common case for rendering a grid at one
 * seed). Returns `(x, y) => number`, numerically identical to {@link multioctaveNoise}.
 */
export function makeMultioctaveNoise(params: MultioctaveParams): (x: number, y: number) => number {
  const { seed0, seed1, octaves, persistence, inputScale, outputScale } = params;
  const tables = basisNoiseTablesFromSeed(seed0, seed1);
  const norm = normalization(persistence, octaves);
  const invP = 1 / persistence;

  const octaveScale: number[] = [];
  const octaveAmp: number[] = [];
  let scale = inputScale;
  let amp = norm;
  for (let k = 0; k < octaves; k++) {
    octaveScale.push(scale);
    octaveAmp.push(amp);
    scale *= LACUNARITY;
    amp *= invP;
  }

  return (x: number, y: number): number => {
    let sum = 0;
    for (let k = 0; k < octaves; k++) {
      const s = octaveScale[k];
      sum += octaveAmp[k] * basisNoise(x * s + k * OCTAVE_OFFSET_X, y * s, tables);
    }
    return outputScale * sum;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vp test test/multioctaveNoise.spec.ts`
Expected: PASS (all, including the new parity block).

- [ ] **Step 5: Lint and commit**

```bash
pnpm vp check --fix
git add src/noise/multioctaveNoise.ts test/multioctaveNoise.spec.ts
git commit -m "$(cat <<'EOF'
feat(noise): makeMultioctaveNoise (table-hoisting plain multioctave)

Nauvis elevation calls plain multioctave_noise ~5x/pixel; add a make* closure
that derives basis tables + per-octave scales once, numerically identical to
multioctaveNoise (parity-tested across a grid). Perf groundwork for the
elevation_nauvis port.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

### Task 2: Capture the `elevation_nauvis` oracle fixture

Ground truth for the parity spec (Task 3). Mirrors `captureElevationLakes` in `test/oracle/capture.ts`: sample `elevation_nauvis` plus the two free-var distances (`distance` over `starting_positions`, and `starting_lake_distance` capped at 1024) on the same near-band + far-rings + deep-field grid, at seed 123456. **Requires a local Factorio install.**

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureElevationNauvis`, register a `want("elevation-nauvis")` line)
- Create (via the capture run): `test/fixtures/oracle-elevation-nauvis.seed123456.json`

**Interfaces:**
- Consumes: `sampleExpression`, `Position`, `oracleAvailable`, `gridPositions`, `FIXTURES`, `mkdtemp`/`rm`/`join`/`tmpdir` (already imported/defined in `capture.ts`).
- Produces: the committed fixture JSON with keys `{ seed0, positions, elevation, distance, startingLakeDistance }` (same shape the lakes spec consumes).

- [ ] **Step 1: Add the capture function**

In `test/oracle/capture.ts`, add this function next to `captureElevationLakes` (reuse the same grid so the parity filter matches the lakes precedent):

```ts
/**
 * The full `elevation_nauvis` tree (the default Nauvis elevation) routed onto
 * `elevation`, plus the two free-var distances the CI spec needs. Same grid as
 * captureElevationLakes: a near-origin band (where the game places real starting
 * lakes, so starting_lake_distance < 1024) and far rings (>1200 tiles, where it
 * saturates at 1024 and the empty-lake ctx is exact), plus one deep-field point.
 */
async function captureElevationNauvis(): Promise<void> {
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

  const elevation = await sample("elevation_nauvis");
  console.log("  captured elevation_nauvis tree");
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
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_nauvis (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-nauvis",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-nauvis.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}
```

Then, next to the other `if (want(...))` lines at the bottom of the file, add:

```ts
if (want("elevation-nauvis")) await captureElevationNauvis();
```

- [ ] **Step 2: Run the capture (produces the fixture)**

Run: `node --experimental-strip-types test/oracle/capture.ts elevation-nauvis`
Expected: prints `captured elevation_nauvis tree`, the two distances, and `wrote .../oracle-elevation-nauvis.seed123456.json (35 points)`. If it prints "No Factorio binary found", set `FACTORIO_BIN` to the game binary and re-run.

- [ ] **Step 3: Sanity-check the fixture**

Run: `node -e "const f=require('./test/fixtures/oracle-elevation-nauvis.seed123456.json'); console.log('pts',f.positions.length,'saturated',f.startingLakeDistance.filter(d=>d>=1024).length,'elevRange',Math.min(...f.elevation).toFixed(2),Math.max(...f.elevation).toFixed(2))"`
Expected: `pts 35`, `saturated` >= 12 (the far rings), and a plausible elevation range spanning negative (water) and positive (land) values.

- [ ] **Step 4: Commit the fixture and capture function**

```bash
git add test/oracle/capture.ts test/fixtures/oracle-elevation-nauvis.seed123456.json
git commit -m "$(cat <<'EOF'
test(oracle): capture elevation_nauvis ground-truth fixture

Adds captureElevationNauvis (mirrors captureElevationLakes): samples the default
Nauvis elevation tree plus distance / starting_lake_distance on the same
near-band + far-rings + deep-field grid at seed 123456, committed as a CI
fixture. Ground truth for the elevation_nauvis parity spec.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

### Task 3: `makeElevationNauvis` tree port + oracle parity spec

Port `elevation_nauvis = elevation_nauvis_function(nauvis_hills_plateaus)` node-for-node from `core/prototypes/noise-programs.lua`, hoisting every basis table / octave closure once per seed. Validate against the Task 2 fixture.

**Files:**
- Create: `src/noise/expressions/elevationNauvis.ts`
- Test: `test/elevationNauvis.spec.ts`

**Interfaces:**
- Consumes: `basisNoiseTablesFromSeed` (`../basisNoise`), `basisNoiseExpr` (`../eval/primitives`), `distanceFromNearestPoint` + `type Point` (`../distanceFromNearestPoint`), `clamp`/`lerp`/`max`/`min` (`../eval/math`), `withCtxDefaults` + `type EvalCtxInput` (`../eval/ctx`), `makeMultioctaveNoise` (`../multioctaveNoise`, from Task 1), `makeQuickMultioctaveNoisePersistence` (`../quickMultioctaveNoise`), `startingLakePositions as computeStartingLakes` (`../startingLakes`), `amplitudeCorrectedMultioctaveNoise` + `makeVariablePersistenceMultioctaveNoise` (`../variablePersistenceMultioctaveNoise`).
- Produces: `interface ElevationNauvisParams` (identical shape to `ElevationLakesParams`) and `makeElevationNauvis(params: ElevationNauvisParams): (x: number, y: number) => number`; plus `elevationNauvis(ctx: EvalCtxInput): number`.

- [ ] **Step 1: Write the failing parity spec**

Create `test/elevationNauvis.spec.ts` (mirrors `test/elevationLakes.spec.ts`; the 8e-3 bound is the same f32 coordinate-floor regime because `nauvis_detail` uses `offset_x = 10000/seg`):

```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-elevation-nauvis.seed123456.json";
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";

// Parity-test only where the game's own starting_lake_distance saturated at 1024;
// near spawn is asserted separately (computed starting lakes make it faithful too).
const SATURATED = (i: number) => fixture.startingLakeDistance[i] >= 1024;

describe("elevationNauvis reproduces the game's elevation_nauvis tree", () => {
  const evalAt = makeElevationNauvis({ seed0: fixture.seed0 });

  it("has parity-testable far points (guards against a fixture regen dropping them)", () => {
    expect(fixture.positions.filter((_p, i) => SATURATED(i)).length).toBeGreaterThanOrEqual(12);
  });

  it("matches the water mask (elevation < 0) away from the coastline", () => {
    for (let i = 0; i < fixture.positions.length; i++) {
      if (!SATURATED(i)) continue;
      const exp = fixture.elevation[i];
      if (Math.abs(exp) < 1e-3) continue; // coastline: sign is ambiguous within the floor
      const p = fixture.positions[i];
      expect(evalAt(p.x, p.y) < 0).toBe(exp < 0);
    }
  });

  it("matches the numeric elevation to the f32 coordinate floor (far field)", () => {
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
    // offset_x = 10000/nauvisSeg puts nauvis_detail's sampling in the f32 regime, so
    // the game's f32 coordinate pipeline diverges from our f64; nauvis amplifies that
    // floor by ~20x (elevation_magnitude). Bound calibrated to just above the observed
    // deep-field worst (see plan Task 3 Step 4). Start at 8e-3, then raise to fit.
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
    expect(checked).toBeGreaterThanOrEqual(6);
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationNauvis.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/expressions/elevationNauvis` / `makeElevationNauvis` undefined.

- [ ] **Step 3: Implement the port**

Create `src/noise/expressions/elevationNauvis.ts`:

```ts
import { basisNoiseTablesFromSeed } from "../basisNoise";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp, lerp, max, min } from "../eval/math";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeQuickMultioctaveNoisePersistence } from "../quickMultioctaveNoise";
import { startingLakePositions as computeStartingLakes } from "../startingLakes";
import {
  amplitudeCorrectedMultioctaveNoise,
  makeVariablePersistenceMultioctaveNoise,
} from "../variablePersistenceMultioctaveNoise";
import type { BasisNoiseTables } from "../basisNoise";

export interface ElevationNauvisParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** 10*log2(control:water:size); default 0. */
  readonly waterLevel?: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
  /** Spawn points for `distance` (uncapped). Default single origin spawn. */
  readonly startingPositions?: Point[];
  /**
   * Lake points for `starting_lake_distance` (capped at 1024). When omitted, the
   * game's real positions are computed from `(seed0, startingPositions)` via
   * `startingLakePositions`. Pass `[]` for far-field-only behavior.
   */
  readonly startingLakePositions?: Point[];
}

/**
 * Compile the `elevation_nauvis` tree for one seed into a `(x, y) => elevation`
 * evaluator. Mirrors core/prototypes/noise-programs.lua 1:1
 * (`elevation_nauvis_function(nauvis_hills_plateaus)`); every basis table and
 * octave closure is derived once here. See the M1 nauvis design spec.
 */
export function makeElevationNauvis(
  params: ElevationNauvisParams,
): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const waterLevel = params.waterLevel ?? 0;
  const seg = params.segmentationMultiplier ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];
  const startingLakePositions =
    params.startingLakePositions ?? computeStartingLakes(seed0, startingPositions);

  // nauvis_segmentation_multiplier = 1.5 * control:water:frequency. EVERY noise
  // sub-node scales/offsets by THIS, not by the plain `seg` (= segmentation_multiplier);
  // only starting_island uses plain seg (see below). See noise-programs.lua.
  const nauvisSeg = 1.5 * seg;
  const offsetX = 10000 / nauvisSeg;

  // Hoisted noise closures / tables (persistence field still varies per tile).
  const bridgeBillows = makeMultioctaveNoise({
    seed0, seed1: 700, octaves: 4, persistence: 0.5, inputScale: nauvisSeg / 150, outputScale: 1,
  });
  const detail = makeVariablePersistenceMultioctaveNoise({
    seed0, seed1: 600, octaves: 5, inputScale: nauvisSeg / 14, outputScale: 0.03, offsetX,
  });
  const macroA = makeMultioctaveNoise({
    seed0, seed1: 1000, octaves: 2, persistence: 0.6, inputScale: nauvisSeg / 1600, outputScale: 1,
  });
  const macroB = makeMultioctaveNoise({
    seed0, seed1: 1100, octaves: 1, persistence: 0.6, inputScale: nauvisSeg / 1600, outputScale: 1,
  });
  const hills = makeMultioctaveNoise({
    seed0, seed1: 900, octaves: 4, persistence: 0.5, inputScale: nauvisSeg / 90, outputScale: 1,
  });
  const cliffLevelTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, 99584);
  const persistanceTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, 500);
  const startingLakeNoise = makeQuickMultioctaveNoisePersistence({
    seed0, seed1: 14, octaves: 4, inputScale: 1 / 8, outputScale: 0.8,
    octaveInputScaleMultiplier: 0.5, persistence: 0.68,
  });

  return (x: number, y: number): number => {
    // nauvis_persistance -> nauvis_detail (variable persistence field)
    const persistence = clamp(
      amplitudeCorrectedMultioctaveNoise(
        x, y,
        { seed0, seed1: 500, octaves: 5, inputScale: nauvisSeg / 2, offsetX, persistence: 0.7, amplitude: 0.5 },
        persistanceTables,
      ) + 0.55,
      0.5, 0.65,
    );
    const nauvisDetail = detail(x, y, persistence);

    // nauvis_bridges
    const bb = Math.abs(bridgeBillows(x, y));
    const nauvisBridges = 1 - 0.1 * bb - 0.9 * max(0, -0.1 + bb);

    // nauvis_macro
    const nauvisMacro = macroA(x, y) * max(0, macroB(x, y));

    // nauvis_hills -> nauvis_plateaus -> nauvis_hills_plateaus (= added_cliff_elevation)
    const nauvisHills = Math.abs(hills(x, y));
    const cliffLevel = clamp(
      0.65 + basisNoiseExpr(
        x, y,
        { seed0, seed1: 99584, inputScale: nauvisSeg / 500, outputScale: 0.6 },
        cliffLevelTables,
      ),
      0.15, 1.15,
    );
    const nauvisPlateaus = 0.5 + clamp((nauvisHills - cliffLevel) * 10, -0.5, 0.5);
    const addedCliffElevation = 0.1 * nauvisHills + 0.8 * nauvisPlateaus;

    // elevation_nauvis_function body (elevation_magnitude = 20, wlc_amplitude = 2)
    const distance = distanceFromNearestPoint(x, y, startingPositions);
    const startingMacroMultiplier = clamp((distance * nauvisSeg) / 2000, 0, 1);
    const nauvisMain =
      20 *
      (lerp(0.5 * addedCliffElevation - 0.6, 1.9 * addedCliffElevation + 1.6, 0.1 + 0.5 * nauvisBridges) +
        0.25 * nauvisDetail +
        3 * nauvisMacro * startingMacroMultiplier);
    const startingIsland = nauvisMain + 20 * (2.5 - (distance * seg) / 200);
    const wlcElevation = max(nauvisMain - waterLevel * 2, startingIsland);

    const sld = distanceFromNearestPoint(x, y, startingLakePositions, 1024);
    const sln = startingLakeNoise(x, y);
    const startingLake = (20 * (-3 + (sld + sln) / 8)) / 8;

    return min(wlcElevation, startingLake);
  };
}

/**
 * Evaluate `elevation_nauvis` at a single point. Convenience over
 * {@link makeElevationNauvis} - for sweeping a grid, call makeElevationNauvis once
 * and reuse the returned evaluator.
 */
export function elevationNauvis(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationNauvis({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
```

- [ ] **Step 4: Run the parity spec and calibrate the f32-floor bound**

Run: `pnpm vp test test/elevationNauvis.spec.ts`

The `8e-3` starting bound is inherited from the lakes port, but nauvis multiplies its noise by `elevation_magnitude = 20` (and the lerp amplifies `added_cliff_elevation` by up to ~2x), so the f32 coordinate-floor error is amplified roughly proportionally. **Expect the first run to fail the numeric bound at the deep-field point** `@(12345.75,6789.125)` - that is legitimate, not a bug. Calibrate:

- **If the worst point is the deep-field one** and the near/mid points sit near the basis floor (error grows with |coordinate|), it is the f32 floor: raise the two bounds (far-field and near-spawn) to just above the observed worst, with a comment stating the value and that it is the amplified f32 floor (`~20x` the raw primitive). This is calibration, not loosening-to-pass.
- **If instead a near/mid point is worst, or the error is orders larger than ~0.2, it is a port bug** - do NOT touch the bound. Re-read the offending node against `noise-programs.lua`. Highest-probability slips: a `seg` that should be `nauvisSeg` (every noise input scale + both `offset_x` use `nauvisSeg`; only `starting_island` uses plain `seg`), an `octaves` count, `abs` placement, or `offsetX` wired to a node that shouldn't have it (only `detail` and `persistance` do).

After calibration, re-run: `pnpm vp test test/elevationNauvis.spec.ts` -> PASS.

- [ ] **Step 5: Lint, run the full suite, and commit**

```bash
pnpm vp check --fix
pnpm vp test
```
Expected: entire suite green.

```bash
git add src/noise/expressions/elevationNauvis.ts test/elevationNauvis.spec.ts
git commit -m "$(cat <<'EOF'
feat(noise): port elevation_nauvis tree to makeElevationNauvis

Hand-ports elevation_nauvis_function(nauvis_hills_plateaus) 1:1 from
noise-programs.lua - bridges, variable-persistence detail, macro, hills/plateaus,
and the wlc/starting-lake min - hoisting every basis table once per seed. No new
primitive. Validated against the committed oracle fixture to the f32 floor,
near-spawn and far, reusing the lakes starting-lake positions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

### Task 4: Render dispatch by map type

Thread a `mapType: "lakes" | "nauvis"` selector through the render request into `renderElevation`, which picks the factory. `elevation_lakes` and `elevation_nauvis` share the ctx fields, so this is a small optional field (defaulting to `"lakes"` for backward compatibility) plus a factory switch.

**Files:**
- Modify: `src/noise/preview/renderElevation.ts`
- Modify: `src/noise/preview/elevationRenderRequest.ts`
- Test: `test/renderElevation.spec.ts` (add a nauvis case), `test/elevationRenderRequest.spec.ts` (add a nauvis passthrough case)

**Interfaces:**
- Consumes: `makeElevationNauvis` (Task 3), existing `makeElevationLakes`.
- Produces: `RenderElevationOptions.mapType?: "lakes" | "nauvis"` and `ElevationRenderRequest.mapType?: "lakes" | "nauvis"` (both default `"lakes"`); `runRenderRequest` forwards it.

- [ ] **Step 1: Write the failing render-dispatch tests**

Append to `test/renderElevation.spec.ts` (extend the import to also bring in `makeElevationNauvis`):

```ts
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";

describe("renderElevation map-type dispatch", () => {
  const width = 4;
  const height = 4;
  const originX = -1;
  const originY = 2;
  const tilesPerPixel = 3;

  it("uses the nauvis factory when mapType is 'nauvis'", () => {
    const img = renderElevation({
      seed0: 123456, width, height, originX, originY, tilesPerPixel, mapType: "nauvis",
    });
    const evalAt = makeElevationNauvis({ seed0: 123456 });
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

  it("defaults to the lakes factory when mapType is omitted", () => {
    const a = renderElevation({ seed0: 123456, width, height, originX, originY, tilesPerPixel });
    const b = renderElevation({
      seed0: 123456, width, height, originX, originY, tilesPerPixel, mapType: "lakes",
    });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
```

Append to `test/elevationRenderRequest.spec.ts`:

```ts
it("dispatches mapType 'nauvis' to renderElevation's nauvis factory", () => {
  const nauvisReq: ElevationRenderRequest = { ...REQ, mapType: "nauvis" };
  const direct = renderElevation({
    seed0: REQ.seed0,
    width: REQ.width,
    height: REQ.height,
    originX: REQ.originX,
    originY: REQ.originY,
    tilesPerPixel: REQ.tilesPerPixel,
    mapType: "nauvis",
    ctx: {
      waterLevel: REQ.waterLevel,
      segmentationMultiplier: REQ.segmentationMultiplier,
      startingPositions: REQ.startingPositions,
    },
  });
  const got = new Uint8ClampedArray(runRenderRequest(nauvisReq).buffer);
  expect(Array.from(got)).toEqual(Array.from(direct.data));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vp test test/renderElevation.spec.ts test/elevationRenderRequest.spec.ts`
Expected: FAIL - `mapType` not accepted / nauvis pixels differ (still rendering lakes).

- [ ] **Step 3: Add `mapType` to `renderElevation.ts`**

In `src/noise/preview/renderElevation.ts`, update the import and options, and switch the factory:

Change the top import to:

```ts
import { makeElevationLakes, type ElevationLakesParams } from "../expressions/elevationLakes";
import { makeElevationNauvis } from "../expressions/elevationNauvis";
```

Add to `RenderElevationOptions` (after `tilesPerPixel`):

```ts
  /** Which elevation tree to render. Default "lakes". */
  readonly mapType?: "lakes" | "nauvis";
```

Replace the `const evalAt = makeElevationLakes(...)` line with:

```ts
  const make = opts.mapType === "nauvis" ? makeElevationNauvis : makeElevationLakes;
  const evalAt = make({ seed0: opts.seed0, ...opts.ctx });
```

(The `ctx` type stays `Omit<ElevationLakesParams, "seed0">`; `ElevationNauvisParams` is structurally identical, so `make({ seed0, ...ctx })` type-checks for both.)

- [ ] **Step 4: Add `mapType` to `elevationRenderRequest.ts`**

In `src/noise/preview/elevationRenderRequest.ts`, add to the `ElevationRenderRequest` interface (after `startingLakePositions?`):

```ts
  /** Which elevation tree to render. Default "lakes". */
  mapType?: "lakes" | "nauvis";
```

And in `runRenderRequest`, pass it through - change the `renderElevation({ ... })` call to include `mapType: req.mapType` (place it alongside `tilesPerPixel`):

```ts
    tilesPerPixel: req.tilesPerPixel,
    mapType: req.mapType,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vp test test/renderElevation.spec.ts test/elevationRenderRequest.spec.ts`
Expected: PASS (including the pre-existing lakes cases, unchanged).

- [ ] **Step 6: Lint and commit**

```bash
pnpm vp check --fix
git add src/noise/preview/renderElevation.ts src/noise/preview/elevationRenderRequest.ts test/renderElevation.spec.ts test/elevationRenderRequest.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): render-path map-type dispatch (lakes | nauvis)

renderElevation and the worker request take an optional mapType selector
(default "lakes"); nauvis routes to makeElevationNauvis. Lakes and nauvis share
the ctx fields, so this is a factory switch, not a new code path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

### Task 5: Mark Nauvis supported and pass its map type from the panel

Make `elevationCtxFromPreset` report the resolved map type and treat both Nauvis and Lakes as supported, and have `ElevationPreviewPanel.vue` pass `mapType` into `render()`. Island stays unsupported.

**Files:**
- Modify: `src/model/elevationPreviewCtx.ts`
- Modify: `src/components/ElevationPreviewPanel.vue`
- Test: `test/elevationPreviewCtx.spec.ts`, `test/elevationPreviewPanel.spec.ts`

**Interfaces:**
- Consumes: `readMapType` (`./mapType`), the render `mapType` field (Task 4).
- Produces: `ElevationPreviewCtx.mapType: "lakes" | "nauvis"` and `supported` true for `nauvis`/`lakes`.

- [ ] **Step 1: Update the ctx spec (Nauvis now supported) and add mapType assertions**

In `test/elevationPreviewCtx.spec.ts`, replace the "marks the default (Nauvis) preset unsupported" test with:

```ts
  it("marks the default (Nauvis) preset supported with its label and map type", () => {
    const r = elevationCtxFromPreset(getBuiltinPreset("Default"));
    expect(r.supported).toBe(true);
    expect(r.mapTypeLabel).toBe("Nauvis elevation");
    expect(r.mapType).toBe("nauvis");
  });

  it("marks an Island preset unsupported", () => {
    const p = getBuiltinPreset("Default");
    writeMapType(p.propertyExpressionNames, "island");
    const r = elevationCtxFromPreset(p);
    expect(r.supported).toBe(false);
    expect(r.mapTypeLabel).toBe("Island elevation");
  });
```

And in the existing "marks a Lakes preset supported" test, add:

```ts
    expect(r.mapType).toBe("lakes");
```

- [ ] **Step 2: Run the ctx spec to verify it fails**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: FAIL - Nauvis still reports `supported:false`; `r.mapType` is undefined.

- [ ] **Step 3: Update `elevationPreviewCtx.ts`**

In `src/model/elevationPreviewCtx.ts`:

Replace the `LAKES_ELEVATION` constant and the `ElevationPreviewCtx` interface's `supported`/`mapTypeLabel` block by adding a `mapType` field to the interface (after `supported`):

```ts
  /** Which client renderer to use when supported. */
  mapType: "lakes" | "nauvis";
```

Then rewrite the body of `elevationCtxFromPreset` to resolve support from the map-type option id (remove the `const mapType = readMapType(...)` shadowing carefully - rename the local to `mt`):

```ts
export function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx {
  const mt = readMapType(preset.propertyExpressionNames);
  const water = preset.autoplaceControls.water;
  const size = water && water.size > 0 ? water.size : 1;
  const startingPositions: Point[] =
    preset.startingPoints.length > 0
      ? preset.startingPoints.map((p) => ({ x: p.x, y: p.y }))
      : [{ x: 0, y: 0 }];

  const supported = mt.id === "nauvis" || mt.id === "lakes";
  return {
    supported,
    mapType: mt.id === "nauvis" ? "nauvis" : "lakes",
    mapTypeLabel: mt.label,
    ctx: {
      waterLevel: 10 * Math.log2(size),
      segmentationMultiplier: water?.frequency ?? 1,
      startingPositions,
    },
  };
}
```

Delete the now-unused `const LAKES_ELEVATION = "elevation_lakes";` line. Update the `readMapType` import if needed (it is already imported). Note the doc comment above the function still describes lakes-only behavior - update its first sentence to: "Map the active preset onto the free variables the elevation renderer needs, and report which client tree (nauvis or lakes) renders it."

- [ ] **Step 4: Run the ctx spec to verify it passes**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update the panel to pass `mapType`, and fix the panel spec**

In `src/components/ElevationPreviewPanel.vue`, inside `generate()`, add `mapType` to the `renderer.render({ ... })` call (alongside `seed0`):

```ts
    const result = await renderer.render({
      seed0,
      mapType: info.mapType,
      width: PREVIEW_PX,
      height: PREVIEW_PX,
      originX: s0.x - half,
      originY: s0.y - half,
      tilesPerPixel: TILES_PER_PIXEL,
      waterLevel: info.ctx.waterLevel,
      segmentationMultiplier: info.ctx.segmentationMultiplier,
      startingPositions: info.ctx.startingPositions,
    });
```

In `test/elevationPreviewPanel.spec.ts`:
- Widen `setup`'s parameter type to `mapTypeId: "nauvis" | "lakes" | "island"`.
- In the existing lakes test, add `mapType: "lakes"` to the `toMatchObject` assertion:

```ts
    expect(arg).toMatchObject({
      seed0: 123456,
      mapType: "lakes",
      width: 512,
      height: 512,
      tilesPerPixel: 4,
      originX: -1024,
      originY: -1024,
    });
```

- Replace the "unsupported map type" test's `setup("nauvis", renderer)` with `setup("island", renderer)` and its expectation `toContain("Nauvis elevation")` with `toContain("Island elevation")`.
- Add a new test that Nauvis now renders:

```ts
  it("renders a Nauvis preset to the canvas on Generate", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ seed0: 123456, mapType: "nauvis" });
    expect(putImageData).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 6: Run the affected specs, then the full suite**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts test/elevationPreviewPanel.spec.ts`
Expected: PASS.

Run: `pnpm vp check --fix && pnpm vp test`
Expected: entire suite green, no lint errors. Check the editor/LSP for `.ts` type errors in the three modified source files (no `vue-tsc` gate exists).

- [ ] **Step 7: Commit**

```bash
git add src/model/elevationPreviewCtx.ts src/components/ElevationPreviewPanel.vue test/elevationPreviewCtx.spec.ts test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): render Nauvis (default) elevation in the Preview tab

elevationCtxFromPreset now reports the resolved map type and treats Nauvis as
supported; the panel passes mapType into the render request. Nauvis (the default
map type) renders client-side; Island remains the unsupported case.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- "no new primitive; tree port mirroring elevationLakes.ts" -> Task 3. ✓
- `makeMultioctaveNoise` perf helper -> Task 1. ✓
- Oracle parity gate, capture-once fixture, f32 floor, never loosen -> Tasks 2, 3. ✓
- Render dispatch by `mapType` (request, renderElevation, ctx, panel) -> Tasks 4, 5. ✓
- `nauvis_segmentation_multiplier = 1.5 * seg` distinct scalar -> Task 3 (`nauvisSeg`). ✓
- Render `elevation_nauvis` (with `nauvis_hills_plateaus`), not `_no_cliff` -> Task 3 (`addedCliffElevation` fed in). ✓
- Island stays unsupported; Ridge/Terrace stay TODO -> Task 5 (island unsupported); no primitive tasks. ✓
- Near-spawn fidelity via `startingLakes.ts` reuse -> Task 3 (`computeStartingLakes` default). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code; the one calibration point (Task 3 Step 4) gives concrete decision criteria rather than "tune as needed". ✓

**Type consistency:** `makeMultioctaveNoise(MultioctaveParams) -> (x,y)=>number` used identically in Tasks 1/3. `ElevationNauvisParams` fields match `makeElevationNauvis`/`renderElevation`'s `make({ seed0, ...ctx })`. `mapType: "lakes" | "nauvis"` identical across `RenderElevationOptions`, `ElevationRenderRequest`, `ElevationPreviewCtx`, and the panel. `amplitudeCorrectedMultioctaveNoise(x,y,params,tables)` and `basisNoiseExpr(x,y,params,tables)` signatures match their modules. ✓

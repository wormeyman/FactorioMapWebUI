# M4 - Enemy bases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Nauvis-gated **Enemies** overlay to the map preview - a red footprint over the terrain render where biter/spitter bases cluster, driven by the `control:enemy-base:frequency|size` levers, with the starting area clear.

**Architecture:** Port `enemy_base_probability` (`base/prototypes/noise-expressions.lua` @ 2.1.11) as a single spot field over the already-solved primitives (`selectSpots`, `basisNoise`, `distanceFromNearestPoint`), reusing the `regularPatches.ts` cone-render exactly. The render field is the deterministic spawner placement source `min(enemy_base_probability, 0.25)`; where it is `>= T` (a small positive threshold) paint the enemy `map_color`, skipping water like the resource overlay. A new `view: "enemies"` and toolbar button drive it. No `spot_noise` machinery change (the `candidate_point_count = 100` path was spike-confirmed to reduce to `candidateSpotCount = 100`). No `random_penalty` (a batch op, dropped for a threshold footprint).

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Pinia, vite-plus test. Headless Factorio 2.1.11 oracle (`test/oracle/`).

## Global Constraints

- **Oracle parity is a hard invariant.** The ported field matches the game to the f32 noise floor. The M4 spike already validated the port to `abs < 0.001` at 7 points (basement, near-spawn, five cone interiors); Task 2/3 widen that to a dense full-region fixture. Tolerance for the field spec is the combined `abs < max(ABS_TOL=1.0, REL_TOL=1e-2*|game|)` M3b uses. NEVER loosen a tolerance to pass; a mismatch is a real finding. Oracle fixtures are read-only ground truth - never hand-author or edit them.
- **`src/**` imports are EXTENSIONLESS.** Tests import from `"vite-plus/test"`. `test/oracle/*.ts` import oracle helpers WITH a `.ts` extension. `capture.ts` cannot import `src/**` (it runs under `node --experimental-strip-types`, no extensionless resolution) - inline any constants it needs.
- **Reuse the solved primitives**, do not re-derive: `src/noise/spotSelection.ts` (`selectSpots`), `src/noise/spotCandidates.ts` (`SpotRegionKey`), `src/noise/basisNoise.ts` (`basisNoise`, `basisNoiseTablesFromSeed`), `src/noise/distanceFromNearestPoint.ts` (`distanceFromNearestPoint`, `Point`). `selectSpots` is used UNCHANGED (`candidateSpotCount: 100`, `hardRegionTargetQuantity: false`, constant `favorability: () => 1` - no batch).
- **Cone geometry (from the spike, docs/noise/enemy-bases-NOTES.md):** an enemy spot has `radius = spot_radius` at the spot (NO `min(32, ...)` cap - that is resource-only) and `quantity = pi/90 * radius^3`, so `peak = 3q/(pi r^2) = r/30`. Render the cone in f32 (`Math.fround`), exactly as `regularPatches.ts` does; the blob term stays f64. `coneScale === 1` (no hard-target shrink).
- **No tsc/vue-tsc gate.** `vp check` is lint+format only; verify by running tests, not by trusting LSP diagnostics. Stale "cannot find module" diagnostics on new files are normal.
- **Commit footer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01UzUkD5aackJw3eCUvuukTc`. Hyphens, never em/en dashes. Work on branch `feat/m4-enemy-bases` (do NOT merge to main). Commit/push only when Eric asks - each task's "Commit" step is a local commit.
- **Node 24.18.0**, run everything through pnpm (`pnpm vp test`, `pnpm vp test test/<f>.spec.ts`, `pnpm vp check --fix`).

## Background: the field (verbatim, `noise-expressions.lua:1-49`)

```
enemy_base_intensity   = clamp(distance, 0, 2400) / 325
enemy_base_radius      = sqrt(control:enemy-base:size) * (15 + 4 * enemy_base_intensity)
enemy_base_frequency   = (1e-5 + 3e-6 * enemy_base_intensity) * control:enemy-base:frequency
spot_radius            = max(0, enemy_base_radius)
spot_quantity          = pi/90 * spot_radius^3
density                = spot_quantity * max(0, enemy_base_frequency)

enemy_base_probability =
    spot_noise{ density_expression=density, spot_quantity_expression=spot_quantity,
                spot_radius_expression=spot_radius, spot_favorability_expression=1,
                seed0=map_seed, seed1=123, region_size=512, candidate_point_count=100,
                hard_region_target_quantity=0, basement_value=-1000,
                maximum_spot_basement_radius=128 }
  + (blob(1/8,1) + blob(1/24,1) + blob(1/64,2) - 0.5) * spot_radius/150 * (0.1 + 0.9*clamp(distance/3000,0,1))
  - 0.3
  + min(0, 20/150 * distance - 20)                      -- starting_area_radius = 150

blob(is, os) = basis_noise{seed0=map_seed, seed1=123, input_scale=is, output_scale=os}
             = os * basisNoise(x*is, y*is, basisNoiseTablesFromSeed(seed0, 123))
```

Render field (deterministic spawner source, `distance_factor = 0`): `min(enemy_base_probability, 0.25)`. Footprint = tiles where that is `>= T` (start `T = 0.05`). See the spec (`docs/superpowers/specs/2026-07-20-milestone4-enemy-bases-design.md`) and `docs/noise/enemy-bases-NOTES.md` for the full RE.

## File structure

- `src/noise/enemies/enemyCatalog.ts` - NEW: constants + the pure enemy math functions (`enemyIntensity`, `enemySpotRadius`, `enemySpotQuantity`, `enemyDensity`).
- `src/noise/enemies/enemyBaseField.ts` - NEW: `makeEnemyBaseField(ctx)` -> `{ field(x,y), probability(x,y) }`.
- `src/noise/preview/renderEnemies.ts` - NEW: composite the footprint onto a terrain ImageData.
- `src/noise/preview/elevationRenderRequest.ts` - MODIFY: `view: "enemies"` + `enemyControls`, dispatch to `renderEnemies`.
- `src/model/elevationPreviewCtx.ts` - MODIFY: expose `enemyControls` read from `autoplaceControls["enemy-base"]`.
- `src/components/ElevationPreviewPanel.vue` - MODIFY: "Enemies" toolbar button + pass `enemyControls` in the request.
- `test/oracle/capture.ts` - MODIFY: add `captureEnemyBase`; register in the CLI dispatch.
- Fixture (generated): `test/fixtures/oracle-enemy-base.seed123456.json`.
- Tests: `test/enemyCatalog.spec.ts` (new), `test/enemyBaseField.spec.ts` (new, validates vs fixture), `test/renderEnemies.spec.ts` (new), `test/elevationRenderRequest.spec.ts` (extend), `test/elevationPreviewCtx.spec.ts` (extend).

---

## Task 1: Enemy catalog + math functions

**Files:**
- Create: `src/noise/enemies/enemyCatalog.ts`
- Test: `test/enemyCatalog.spec.ts`

**Interfaces:**
- Produces:
  - Constants: `ENEMY_CONTROL_NAME = "enemy-base"`, `ENEMY_SEED1 = 123`, `ENEMY_REGION_SIZE = 512`, `ENEMY_CANDIDATE_SPOT_COUNT = 100`, `ENEMY_SPACING = 45.254833995939045`, `ENEMY_BASEMENT = -1000`, `ENEMY_MAX_SPOT_BASEMENT_RADIUS = 128`, `ENEMY_PLACEMENT_CAP = 0.25`, `STARTING_AREA_RADIUS = 150`, `ENEMY_MAP_COLOR: readonly [number, number, number] = [255, 26, 26]`, `ENEMY_FOOTPRINT_THRESHOLD = 0.05`.
  - `EnemyControls = { frequency: number; size: number }`.
  - Pure functions on `(distance: number, controls: EnemyControls)`:
    - `enemyIntensity(distance): number` = `clamp(distance, 0, 2400) / 325`
    - `enemySpotRadius(distance, controls): number` = `max(0, sqrt(controls.size) * (15 + 4*enemyIntensity(distance)))`
    - `enemySpotQuantity(distance, controls): number` = `(PI/90) * enemySpotRadius^3`
    - `enemyFrequency(distance, controls): number` = `(1e-5 + 3e-6*enemyIntensity(distance)) * controls.frequency`
    - `enemyDensity(distance, controls): number` = `enemySpotQuantity * max(0, enemyFrequency)`

- [ ] **Step 1: Write the failing test** `test/enemyCatalog.spec.ts`. Hand-compute the default controls `{ frequency: 1, size: 1 }` (arithmetic in comments) and assert `toBeCloseTo(_, 6)`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  enemyDensity,
  enemyFrequency,
  enemyIntensity,
  enemySpotQuantity,
  enemySpotRadius,
} from "../src/noise/enemies/enemyCatalog";

const c = { frequency: 1, size: 1 };

describe("enemy catalog math (default controls)", () => {
  // intensity = clamp(d,0,2400)/325 : 0 at d=0, 1000/325=3.0769 at d=1000, 2400/325=7.3846 saturated
  it("intensity", () => {
    expect(enemyIntensity(0)).toBeCloseTo(0, 6);
    expect(enemyIntensity(1000)).toBeCloseTo(1000 / 325, 6);
    expect(enemyIntensity(3000)).toBeCloseTo(2400 / 325, 6); // clamped at 2400
  });
  // radius = sqrt(1)*(15 + 4*intensity): 15 at d=0; 15 + 4*3.0769 = 27.3077 at d=1000
  it("spot radius", () => {
    expect(enemySpotRadius(0, c)).toBeCloseTo(15, 6);
    expect(enemySpotRadius(1000, c)).toBeCloseTo(15 + 4 * (1000 / 325), 6);
  });
  // quantity = pi/90 * radius^3 : pi/90 * 15^3 at d=0
  it("spot quantity", () => {
    expect(enemySpotQuantity(0, c)).toBeCloseTo((Math.PI / 90) * 15 ** 3, 6);
  });
  // frequency = (1e-5 + 3e-6*intensity)*1 : 1e-5 at d=0
  it("frequency", () => {
    expect(enemyFrequency(0, c)).toBeCloseTo(1e-5, 12);
    expect(enemyFrequency(1000, c)).toBeCloseTo(1e-5 + 3e-6 * (1000 / 325), 12);
  });
  // density = quantity * max(0, frequency)
  it("density", () => {
    expect(enemyDensity(0, c)).toBeCloseTo((Math.PI / 90) * 15 ** 3 * 1e-5, 9);
  });
  // size 0 -> radius 0 -> quantity 0 -> density 0 (disabled enemies)
  it("size 0 collapses the field", () => {
    expect(enemySpotRadius(500, { frequency: 1, size: 0 })).toBe(0);
    expect(enemyDensity(500, { frequency: 1, size: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/enemyCatalog.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `enemyCatalog.ts`. Use a module-local `clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)`.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/enemyCatalog.spec.ts`.
- [ ] **Step 5: Commit** `feat(enemies): enemy-base catalog + math functions`.

---

## Task 2: Oracle fixture for `enemy_base_probability` (DE-RISK - before Task 3)

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureEnemyBase`, register `if (want("enemy-base")) await captureEnemyBase();` in the CLI dispatch next to the other `want(...)` lines).
- Create fixture (generated): `test/fixtures/oracle-enemy-base.seed123456.json`

**Interfaces:**
- Produces a committed fixture `{ _comment, positions, cases: [{ seed, values }] }`: the game's `enemy_base_probability` (routed onto `elevation` via `sampleExpression`) at a dense full-region grid over region (2,2) (centred on (1024,1024), spanning [768,1280]) - to catch several spot cones - plus near-spawn points (basement + starting-area clearing), for seeds `123456` and `777771`.

Model it on `captureAux` (single named expression) with the multi-seed `cases` shape from `captureResourceRegular`:

```ts
async function captureEnemyBase(): Promise<void> {
  const positions: Position[] = [];
  // Dense grid over region (2,2): centred (1024,1024), [768,1280]; stride 16 catches
  // the ~15-30 tile enemy cones (a few survive the density trim per 512^2 region).
  for (let iy = 0; iy < 32; iy++)
    for (let ix = 0; ix < 32; ix++)
      positions.push({ x: 768 + ix * 16 + 0.5, y: 768 + iy * 16 + 0.25 });
  // Near-spawn (+x) profile: basement + starting-area clearing.
  for (const d of [0, 40, 60, 80, 100, 150, 200, 300]) positions.push({ x: d + 0.5, y: 0.25 });
  const seeds = [123456, 777771];
  const cases: { seed: number; values: number[] }[] = [];
  for (const seed of seeds) {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression("enemy_base_probability", positions, { workDir, seed });
      cases.push({ seed, values });
      console.log(`  captured enemy-base seed=${seed}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via test/oracle. enemy_base_probability routed onto elevation, default controls (enemy-base freq/size = 1). Regenerate: node --experimental-strip-types test/oracle/capture.ts enemy-base",
    positions,
    cases,
  };
  const out = join(FIXTURES, "oracle-enemy-base.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points, ${cases.length} seeds)`);
}
```

- [ ] **Step 1: Implement** `captureEnemyBase` and register it in the dispatch.
- [ ] **Step 2: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts enemy-base`. Verify the fixture is written and finite: the near-spawn `+x` points are strongly negative (basement/clearing, e.g. `d=200 ~ -1000`), and the region-(2,2) grid contains a handful of positive cells (the base cones, `~0.1-0.8`) among mostly `~-1000` basement.
  - If no local Factorio is available in the execution environment, STOP and hand back to Eric with the exact command - do NOT hand-author the fixture (it is read-only ground truth). The known-good binary is the Steam install (`docs/noise/enemy-bases-NOTES.md`); `sampleExpression` auto-resolves it.
- [ ] **Step 3: Commit** `test(enemies): enemy_base_probability oracle fixture`.

---

## Task 3: `makeEnemyBaseField` - the ported field (the core)

**Files:**
- Create: `src/noise/enemies/enemyBaseField.ts`
- Test: `test/enemyBaseField.spec.ts` (validates against the Task 2 fixture)

**Interfaces:**
- Consumes: Task 1 catalog (constants + math), `selectSpots`/`SelectedSpot`, `SpotRegionKey`, `basisNoise`/`basisNoiseTablesFromSeed`, `distanceFromNearestPoint`/`Point`.
- Produces: `makeEnemyBaseField(ctx: EnemyBaseFieldCtx): { field(x,y): number; probability(x,y): number }` where

```ts
export interface EnemyBaseFieldCtx {
  readonly seed0: number;
  readonly controls: { frequency: number; size: number };
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}
```

- `field(x,y)` = raw `enemy_base_probability` (spot field + blob term - 0.3 + starting term); this is what the oracle returns.
- `probability(x,y)` = `clamp(min(field(x,y), ENEMY_PLACEMENT_CAP), 0, 1)` - the deterministic spawner placement source, in `[0, 0.25]`; the render thresholds this.

Structure (mirror `makeRegularPatches`, single field, no per-resource params, no `quantityBatch`, no hard-target shrink):

```ts
const f32 = Math.fround;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const regionIndex = (c) => Math.floor((c + ENEMY_REGION_SIZE / 2) / ENEMY_REGION_SIZE);

export function makeEnemyBaseField(ctx: EnemyBaseFieldCtx) {
  const controls = ctx.controls;
  const spawn = ctx.startingPositions ?? [{ x: 0, y: 0 }];
  const distanceAt = (x, y) => distanceFromNearestPoint(x, y, spawn as Point[]);
  const tables = basisNoiseTablesFromSeed(ctx.seed0, ENEMY_SEED1);

  const regionCache = new Map<string, SelectedSpot[]>();
  const regionSpots = (rX, rY) => {
    const key = `${rX},${rY}`;
    let spots = regionCache.get(key);
    if (spots) return spots;
    const regionKey: SpotRegionKey = { seed0: ctx.seed0, seed1: ENEMY_SEED1, regionX: rX, regionY: rY };
    spots = selectSpots(regionKey, {
      density: (x, y) => enemyDensity(distanceAt(x, y), controls),
      quantity: (x, y) => enemySpotQuantity(distanceAt(x, y), controls),
      favorability: () => 1,
      regionSize: ENEMY_REGION_SIZE,
      candidateSpotCount: ENEMY_CANDIDATE_SPOT_COUNT,   // candidate_point_count = 100
      spacing: ENEMY_SPACING,
      hardRegionTargetQuantity: false,
    });
    regionCache.set(key, spots);
    return spots;
  };

  const spotFieldAt = (x, y) => {
    let best = ENEMY_BASEMENT;
    const R = ENEMY_MAX_SPOT_BASEMENT_RADIUS;
    for (let rX = regionIndex(x - R); rX <= regionIndex(x + R); rX++)
      for (let rY = regionIndex(y - R); rY <= regionIndex(y + R); rY++)
        for (const s of regionSpots(rX, rY)) {
          const dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          // radius = spot_radius at the spot (NO min(32,...) cap); coneScale === 1.
          const radius = f32(enemySpotRadius(distanceAt(s.x, s.y), controls) * s.coneScale);
          if (radius <= 0) continue;
          const q = s.quantity;
          const peak = f32(f32(3 * q) / f32(f32(Math.PI * radius) * radius));
          const cone = f32(peak - f32(f32(Math.sqrt(d2)) * f32(peak / radius)));
          if (cone > best) best = cone;
        }
    return best;
  };

  const blobTermAt = (x, y) => {
    const b = basisNoise(x / 8, y / 8, tables)
            + basisNoise(x / 24, y / 24, tables)
            + 2 * basisNoise(x / 64, y / 64, tables);      // blob(1/64, 2) -> output_scale 2
    const d = distanceAt(x, y);
    return (b - 0.5) * (enemySpotRadius(d, controls) / 150) * (0.1 + 0.9 * clamp(d / 3000, 0, 1));
  };

  const field = (x, y) => {
    const d = distanceAt(x, y);
    return spotFieldAt(x, y) + blobTermAt(x, y) - 0.3 + Math.min(0, (20 / STARTING_AREA_RADIUS) * d - 20);
  };
  return {
    field,
    probability: (x, y) => clamp(Math.min(field(x, y), ENEMY_PLACEMENT_CAP), 0, 1),
  };
}
```

- [ ] **Step 1: Write the failing test** `test/enemyBaseField.spec.ts`, iterating the Task 2 fixture. Assert BOTH (a) the combined abs/rel field tolerance and (b) footprint agreement (port and game agree on `>= T` at every point - the decision the render actually makes). Mirror `regularPatches.spec.ts`'s mismatch dump:

```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-enemy-base.seed123456.json";
import { makeEnemyBaseField } from "../src/noise/enemies/enemyBaseField";
import { ENEMY_FOOTPRINT_THRESHOLD, ENEMY_PLACEMENT_CAP } from "../src/noise/enemies/enemyCatalog";

const ABS_TOL = 1.0;
const REL_TOL = 1e-2;
const relErr = (p: number, g: number) => Math.abs(p - g) / Math.max(1, Math.abs(g));
const inFootprint = (v: number) => Math.min(v, ENEMY_PLACEMENT_CAP) >= ENEMY_FOOTPRINT_THRESHOLD;

describe("makeEnemyBaseField vs oracle", () => {
  for (const c of fixture.cases) {
    it(`matches enemy_base_probability seed=${c.seed}`, () => {
      const f = makeEnemyBaseField({ seed0: c.seed, controls: { frequency: 1, size: 1 } });
      let worstAbs = 0, worstRel = 0, footprintDisagreements = 0;
      const mism: { x: number; y: number; game: number; port: number; abs: number }[] = [];
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const game = c.values[i];
        const port = f.field(p.x, p.y);
        const abs = Math.abs(port - game);
        if (abs > worstAbs) worstAbs = abs;
        if (relErr(port, game) > worstRel) worstRel = relErr(port, game);
        if (inFootprint(port) !== inFootprint(game)) footprintDisagreements++;
        mism.push({ x: p.x, y: p.y, game, port, abs });
      }
      if (worstAbs >= ABS_TOL && worstRel >= REL_TOL) {
        const top = [...mism].sort((a, b) => b.abs - a.abs).slice(0, 12)
          .map((m) => `  (${m.x},${m.y}) game=${m.game.toFixed(3)} port=${m.port.toFixed(3)} abs=${m.abs.toFixed(3)}`).join("\n");
        throw new Error(`seed=${c.seed}: worstAbs=${worstAbs.toFixed(3)} worstRel=${worstRel.toExponential(2)}\n${top}`);
      }
      expect(worstAbs < ABS_TOL || worstRel < REL_TOL).toBe(true);
      expect(footprintDisagreements).toBe(0);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/enemyBaseField.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `enemyBaseField.ts` per the structure above.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/enemyBaseField.spec.ts`. The M4 spike already validated this exact math to `abs < 0.001`, so it should pass first try. If a point misses, debug in this order (do NOT loosen the tolerance):
  1. **Basement points off?** `ENEMY_BASEMENT` (-1000) or the `-0.3`/starting term. The `+x` near-spawn points isolate this (no cones there).
  2. **Wrong cones (whole spots present/absent, or wrong peak)?** the `selectSpots` params (`candidateSpotCount`/`spacing`/`regionSize`/`seed1`) or the cone `radius`/`peak` (must be the uncapped `enemySpotRadius` at the spot, f32).
  3. **A uniform tilt across the region?** the blob term (seed, the `2*` on the `1/64` blob, or the `spot_radius/150 * (0.1 + 0.9*clamp(distance/3000))` envelope).
- [ ] **Step 5: Commit** `feat(enemies): enemy_base_probability field, oracle-validated`.

---

## Task 4: `renderEnemies` - footprint composite

**Files:**
- Create: `src/noise/preview/renderEnemies.ts`
- Test: `test/renderEnemies.spec.ts`

**Interfaces:**
- Consumes: `makeEnemyBaseField` (T3), `ENEMY_MAP_COLOR`/`ENEMY_FOOTPRINT_THRESHOLD` (T1), `WATER_TILE_COLORS` (re-exported from `renderResources.ts`), `Point`.
- Produces: `renderEnemies(base: ImageData, opts: RenderEnemiesOptions): void` (mutates in place), mirroring `renderResources`:

```ts
export interface RenderEnemiesOptions {
  readonly seed0: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly tilesPerPixel?: number;
  readonly controls: { frequency: number; size: number };
  readonly startingPositions?: readonly Point[];
}
```

Body: build `const f = makeEnemyBaseField({ seed0, controls, startingPositions })`. Sweep the pixel grid; skip water pixels (reuse the `isWater` check over `WATER_TILE_COLORS`); where `f.probability(wx, wy) >= ENEMY_FOOTPRINT_THRESHOLD`, paint `ENEMY_MAP_COLOR` opaque. Import `WATER_TILE_COLORS` from `./renderResources`.

- [ ] **Step 1: Write the failing test** `test/renderEnemies.spec.ts`. Use a small synthetic ImageData and assert: (a) a near-spawn pixel is NOT painted (starting area clear); (b) a pixel known to be inside a base spot (from the Task 2 fixture region (2,2), e.g. the max-value cell) IS painted the enemy color; (c) a water pixel is never painted; (d) a drift guard that `ENEMY_MAP_COLOR` = `[255,26,26]` and `WATER_TILE_COLORS` matches the render-resources export.

```ts
import { describe, expect, it } from "vite-plus/test";
import { renderEnemies } from "../src/noise/preview/renderEnemies";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { ENEMY_MAP_COLOR } from "../src/noise/enemies/enemyCatalog";

// helper: a 1x1 ImageData at a chosen world origin, pre-filled with a land color.
function land1x1(): ImageData {
  const img = { width: 1, height: 1, data: new Uint8ClampedArray([90, 120, 60, 255]) } as ImageData;
  return img;
}

describe("renderEnemies", () => {
  it("leaves the starting area unpainted", () => {
    const img = land1x1();
    renderEnemies(img, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1, controls: { frequency: 1, size: 1 } });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([90, 120, 60]); // untouched
  });
  it("paints a pixel inside a base spot", () => {
    // (1000,1040) had ebp ~0.78 in the fixture region -> min(.,0.25)=0.25 >= T -> painted.
    const img = land1x1();
    renderEnemies(img, { seed0: 123456, originX: 1000, originY: 1040, tilesPerPixel: 1, controls: { frequency: 1, size: 1 } });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([...ENEMY_MAP_COLOR]);
  });
  it("never paints water", () => {
    const [wr, wg, wb] = WATER_TILE_COLORS[0];
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([wr, wg, wb, 255]) } as ImageData;
    renderEnemies(img, { seed0: 123456, originX: 1000, originY: 1040, tilesPerPixel: 1, controls: { frequency: 1, size: 1 } });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([wr, wg, wb]); // still water
  });
  it("map color drift guard", () => expect([...ENEMY_MAP_COLOR]).toEqual([255, 26, 26]));
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/renderEnemies.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `renderEnemies.ts`.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/renderEnemies.spec.ts`. (If the "inside a base spot" pixel is not painted, the coordinate may have shifted with the f32 render vs the fixture's rounded value - pick the actual max-`field` cell from the committed fixture instead.)
- [ ] **Step 5: Commit** `feat(enemies): enemy footprint render (threshold + water exclusion)`.

---

## Task 5: Wiring - view "enemies" + levers + toolbar

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (add `view: "enemies"` to the union, an `enemyControls?` field, and the dispatch branch).
- Modify: `src/model/elevationPreviewCtx.ts` (expose `enemyControls` read from `autoplaceControls["enemy-base"]`).
- Modify: `src/components/ElevationPreviewPanel.vue` ("Enemies" toolbar button; widen the `view` ref type; pass `enemyControls` in the request).
- Test: `test/elevationRenderRequest.spec.ts` (extend), `test/elevationPreviewCtx.spec.ts` (extend).

**Interfaces:**
- `ElevationRenderRequest.view` gains `"enemies"`; add `enemyControls?: { frequency: number; size: number }`.
- `runRenderRequest`: `"enemies"` renders the terrain base then `renderEnemies` (exactly like the `"resources"` branch calls `renderResources`). Guard: `if (req.view === "terrain" || req.view === "resources" || req.view === "enemies") { image = renderTerrain({...}); ... }`, then inside, `if (req.view === "enemies") renderEnemies(image, { seed0, originX, originY, tilesPerPixel, controls: req.enemyControls ?? { frequency: 1, size: 1 }, startingPositions: req.startingPositions });`.
- `ElevationPreviewCtx` gains `enemyControls: { frequency: number; size: number }`; `elevationCtxFromPreset` reads `const eb = preset.autoplaceControls["enemy-base"]; enemyControls = eb ? { frequency: eb.frequency, size: eb.size } : { frequency: 1, size: 1 };`.

- [ ] **Step 1: Write the failing tests.**
  - `test/elevationRenderRequest.spec.ts`: add a case that `runRenderRequest({ ...baseReq, view: "enemies", enemyControls: { frequency: 1, size: 1 } })` returns a buffer whose pixels differ from the plain `"terrain"` render at a known in-spot location (i.e. the enemy overlay painted something). Reuse the existing request-builder helper in that spec; set `originX/originY` so the 1-px-or-small viewport covers a base spot (e.g. origin (1000,1040)).
  - `test/elevationPreviewCtx.spec.ts`: assert `elevationCtxFromPreset(preset).enemyControls` reads `enemy-base` freq/size (build a preset whose `autoplaceControls["enemy-base"] = { frequency: 2, size: 0.5, richness: 1 }` and expect `{ frequency: 2, size: 0.5 }`), and defaults to `{ frequency: 1, size: 1 }` when absent.
- [ ] **Step 2: Run to verify they fail** - `pnpm vp test test/elevationRenderRequest.spec.ts test/elevationPreviewCtx.spec.ts`.
- [ ] **Step 3: Implement** the three source edits. In `ElevationPreviewPanel.vue`: widen `const view = ref<"elevation" | "terrain" | "resources" | "enemies">("elevation")`; add the toolbar button after Resources, gated on `terrainAvailable` (copy the Resources `FButton`, `data-test="view-enemies"`, label `Enemies`, title "Enemies view is only available for the Nauvis map type"); add `enemyControls: info.enemyControls` to the `renderer.render({...})` request. Confirm the `watch(terrainAvailable, ...)` that resets non-Nauvis views to `"elevation"` still covers `"enemies"` (it resets whenever `!available`, so it does).
- [ ] **Step 4: Run to verify they pass**, then the FULL suite `pnpm vp test` and `pnpm vp check --fix`.
- [ ] **Step 5: Commit** `feat(enemies): wire enemies view + levers + toolbar toggle`.

---

## Task 6: Manual eyeball + docs

- [ ] **Headless render check.** Write a throwaway spec under the scratchpad (NOT committed) that calls `runRenderRequest({ id: 0, view: "enemies", seed0: 123456, width: 512, height: 512, originX: -256, originY: -256, tilesPerPixel: 4, waterLevel: 0, segmentationMultiplier: 1, startingPositions: [{x:0,y:0}], mapType: "nauvis", enemyControls: { frequency: 1, size: 1 } })` (tilesPerPixel 4 -> a 2048-tile span so several base regions show) and writes a PNG (reuse the minimal zlib PNG encoder from the M3a/M3b eyeball). Confirm: red base regions scattered across the map, the spawn area (centre) clear, and the footprint grows/shrinks with `enemyControls` frequency/size. Send the PNG to Eric.
- [ ] **Pin `T`.** If the footprint reads too sparse or too solid vs a real `factorio --generate-map-preview` of the same seed, adjust `ENEMY_FOOTPRINT_THRESHOLD` (within `(0, 0.25)`) and note the chosen value in `enemyCatalog.ts` + `docs/noise/enemy-bases-NOTES.md`. Re-run the Task 3 footprint-agreement assertion after any change.
- [ ] **In-app eyeball (Eric).** `pnpm vp dev` -> Terrain tab -> Nauvis -> Preview -> Enemies toggle -> Generate. Confirm the base regions render and the enemy-base sliders shift them. (Eric's to run.)
- [ ] **Docs.** Update `docs/noise/client-preview-ROADMAP.md` (M4 enemy bases DONE; cliffs still open), `docs/noise/enemy-bases-NOTES.md` (final `T`, any residual notes). Update the Claude memory (`m3-resources-kicked-off.md` or a new `m4-enemy-bases` note) to record M4 enemy bases shipped, and cross-link `[[factorio-data-version-hazard]]`.
- [ ] **Commit** `docs(enemies): M4 enemy bases done`.

## Self-review notes

- **Spec coverage** (`docs/superpowers/specs/2026-07-20-milestone4-enemy-bases-design.md`):
  - Field port (`enemy_base_probability`, spot + blobs + terms) -> Tasks 1, 3.
  - Render field `min(ebp, 0.25)` + small-positive threshold footprint, water exclusion, enemy color -> Task 4.
  - `candidate_point_count` clean reuse (no `spotSelection` change) -> Task 3 uses `selectSpots` unchanged; the spike (docs/noise/enemy-bases-NOTES.md) is the evidence.
  - `starting_area_radius = 150`, `no_enemies_mode` (worms out of scope) -> Task 1 constant; spawners only (both `df=0`).
  - Oracle-first validation (assert the field, eyeball the footprint) -> Tasks 2, 3, 6.
  - `view: "enemies"` + Enemies toolbar + enemy-base levers -> Task 5.
- **Type consistency:** `EnemyControls`/`controls` is `{ frequency, size }` everywhere (catalog, field ctx, render opts, request, preview ctx). `field`/`probability` shape on `makeEnemyBaseField` is the pair the render + oracle test consume. `ENEMY_MAP_COLOR` is a `readonly [number,number,number]`.
- **Out of scope:** exact per-nest placement (M3.5 per-chunk roll); worms (distance-shaped); cliffs + ore-on-cliffs exclusion (separate M4 item); non-default `starting_area`, non-Nauvis planets, `no_enemies_mode` UI.
- **Not-in-CI:** Task 2 Step 2 needs a local Factorio; if absent, hand back to Eric rather than fabricate the fixture.

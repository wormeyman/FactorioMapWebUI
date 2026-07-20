# M4 - Cliffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Nauvis-gated **Cliffs** overlay to the map preview - the cliff `map_color` painted over the terrain wherever the game would place a cliff wall, driven by the `nauvis_cliff` control (Frequency/Continuity) and the map's `cliff_settings`, with cliffs excluded from water.

**Architecture:** Port the two named cliff noise fields (`cliff_elevation_nauvis`, `cliffiness_nauvis`) over the already-solved primitives (reusing `nauvisShared`, `basisNoise`, `makeElevationNauvis`), oracle-validated point-by-point. Then apply the spike-verified geometric placement rule (`crossesCliff` + the 4-tile grid) to enumerate cliff cells, and composite them onto the terrain ImageData exactly like `renderResources`/`renderEnemies`, skipping water pixels. A new `view: "cliffs"` and toolbar button drive it. `fixImpossibleCells` (the ~10% continuity-repair residual), exact `wouldCollide`, and ore-on-cliff exclusion are deferred.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Pinia, vite-plus test. Headless Factorio 2.1.11 oracle (`test/oracle/`).

## Global Constraints

- **Oracle parity is a hard invariant.** The two ported cliff fields match the game to the f32 noise floor. Tolerance for the field specs is the combined `abs < max(ABS_TOL=1.0, REL_TOL=1e-2*|game|)` M3b/M4 use. NEVER loosen a tolerance to pass; a mismatch is a real finding. Oracle fixtures in `test/fixtures/` are read-only ground truth - never hand-author or edit them.
- **Placement is validated as a drift guard at ~90%, not a 100% gate.** The verified geometric rule reproduces cliff positions lattice-exactly and the placed-cell set to ~90% of the game's real cliffs; the residual is the deferred `fixImpossibleCells` + water rejection (`docs/noise/cliffs-NOTES.md`). Assert lattice-exactness + the documented agreement; do NOT chase 100%.
- **`src/**` imports are EXTENSIONLESS.** Tests import from `"vite-plus/test"`. `test/oracle/*.ts` import oracle helpers WITH a `.ts` extension. `capture.ts` cannot import `src/**` (it runs under `node --experimental-strip-types`, no extensionless resolution) - inline any constants it needs.
- **Reuse the solved pieces**, do not re-derive: `src/noise/expressions/nauvisShared.ts` (`makeNauvisShared`: `hills`, `cliffLevel`, `forestPathBillows`, `bridgeBillows`, `nauvisSeg`), `src/noise/expressions/elevationNauvis.ts` (`makeElevationNauvis`), `src/noise/basisNoise.ts` (`basisNoise`, `basisNoiseTablesFromSeed`), `src/noise/distanceFromNearestPoint.ts` (`distanceFromNearestPoint`, `Point`), `src/noise/preview/renderResources.ts` (`WATER_TILE_COLORS`).
- **f32 vs f64.** Follow the same discipline as the other ports: noise-machine arithmetic that the game does in f32 uses `Math.fround` / the `fastApprox.ts` pair where the existing ports do; plain expression arithmetic stays f64. `cliff_elevation_nauvis` and `cliffiness_nauvis` are DSL-level arithmetic over already-f32-correct sub-nodes (`hills`, `basisNoise`, etc.), so no new fastapprox is introduced - match the existing `nauvisShared`/`elevationNauvis` style.
- **No tsc/vue-tsc gate.** `vp check` is lint+format only; verify by running tests, not by trusting LSP diagnostics. Stale "cannot find module" diagnostics on new files are normal.
- **Commit footer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01QHvgh5KTfJyhCR7RA9Tfpo`. Hyphens, never em/en dashes. Work on branch `feat/m4-cliffs` (already created; do NOT merge to main). Each task's "Commit" step is a local commit; push/merge/deploy only when Eric asks.
- **Node 24.18.0**, run everything through pnpm (`pnpm vp test`, `pnpm vp test test/<f>.spec.ts`, `pnpm vp check --fix`).

## Background: the fields + placement (verbatim, see `docs/noise/cliffs-NOTES.md`)

```
cliff_elevation_nauvis = 10 + 30 * (nauvis_hills - nauvis_hills_cliff_level)

cliffiness_nauvis = (main_cliffiness >= cliff_cutoff) * 10
main_cliffiness = min( base_cliffiness, forest_path_cliffiness, bridge_path_cliffiness,
                       elevation_cliffiness, starting_area_cliffiness, 4*low_frequency_cliffiness )
  base_cliffiness          = (nauvis_cliff_ringbreak - 0.01) * 60
  forest_path_cliffiness   = (forest_path_billows   - 0.03) * 12      -- nauvisShared.forestPathBillows
  bridge_path_cliffiness   = (nauvis_bridge_billows  - 0.05) * 15     -- nauvisShared.bridgeBillows
  elevation_cliffiness     = (elevation_nauvis_no_cliff - 4) / 2
  starting_area_cliffiness = -2 + distance * segmentation_multiplier / 120   -- plain seg
  low_frequency_cliffiness = 1.5 + basis_noise{seed1=86883, input_scale=nauvisSeg/500, output_scale=0.51}
                           + min( slider_to_linear(cliff_frequency, -1.7, 1.7),
                                  slider_to_linear(cliff_richness,   -1,   1) )
  cliff_cutoff    = 2 * (0.5 - 0.5*slider_to_linear(cliff_richness,-1,1)) ^ 1.5     -- = 0.7071 default
  cliff_frequency = 40 / interval

nauvis_cliff_ringbreak = abs(nauvis_hills - nauvis_hills_offset)
nauvis_hills_offset    = abs(multioctave_noise{ x + 12*nx, y + 12*ny, persistence=0.5, seed0=map_seed,
                                                seed1=900, octaves=4, input_scale=nauvisSeg/90 })
  raw_x = basis_noise{ seed1='nauvis_offset_x', input_scale=nauvisSeg/500 }   -- string seed -> numeric (Task 5)
  raw_y = basis_noise{ seed1='nauvis_offset_y', input_scale=nauvisSeg/500 }
  normalize(a,b) = a / sqrt(0.001 + a^2 + b^2)
  nx = normalize(raw_x, raw_y);  ny = normalize(raw_y, raw_x)

slider_to_linear(v, lo, hi) = lo + 0.5*(hi-lo)*(1 + log2(v)/log2(6))

-- lever mapping (spike-verified):
interval      = cliffSettings.cliffElevationInterval / controls.frequency     -- getModifiedElevationInterval
cliff_richness = cliffSettings.richness * controls.continuity                 -- getModifiedRichness (continuity = size slot)
-- Continuity (size) = 0 disables ALL cliffs.
```

Placement (per 4-tile cell; corners sampled at `(i*4, j*4+0.5)`, entity at cell center `(cx*4+2, cy*4+2.5)`):

```
crossesCliff(a, b, cliffAvg, e0, interval):
  if a<0 or b<0: return 0
  boundary = e0 + interval*floor((max(a,b)-e0)/interval)
  if boundary < e0: return 0
  dA=a-boundary; dB=b-boundary
  if cliffAvg > 0.5:
     if dA<0 and dB>0: return +1
     if dA>0 and dB<0: return -1
  return 0
-- L/R/T/B edge crossings over the cell's 4 corners; code = (enc(L)<<6)|(enc(R)<<4)|(enc(T)<<2)|enc(B),
--   enc: 0->0, +1->1, -1->3; place a cliff iff toMaybeCliffOrientation(code) != none (Task 2 table).
```

## File structure

- `src/noise/cliffs/cliffCatalog.ts` - NEW: constants (control name, grid, `CLIFF_MAP_COLOR`, elevation_0/interval defaults, seed 86883), `CliffControls`/`CliffSettingsInput` types, `sliderToLinear`, `getModifiedElevationInterval`, `getModifiedRichness`, and (Task 2) the extracted `isCliffPlaced(code)` orientation predicate.
- `src/noise/cliffs/cliffFields.ts` - NEW: `makeCliffElevation(ctx)` (Task 3), `makeCliffiness(ctx)` (Task 6), `makeCliffFields(ctx)` (Task 6).
- `src/noise/cliffs/cliffPlacement.ts` - NEW: `crossesCliff`, cell-code assembly, `makeCliffPlacement(ctx)` -> `placedCells(x0,y0,x1,y1)` (Task 7).
- `src/noise/preview/renderCliffs.ts` - NEW: composite cliff cells onto a terrain ImageData, skip water (Task 9).
- `src/noise/expressions/elevationNauvis.ts` - MODIFY: add `withCliffElevation?: boolean` seam for `elevation_nauvis_no_cliff` (Task 4).
- `src/noise/preview/elevationRenderRequest.ts` - MODIFY: `view: "cliffs"` + `cliffControls`/`cliffSettings`, dispatch to `renderCliffs` (Task 10).
- `src/model/elevationPreviewCtx.ts` - MODIFY: expose `cliffControls`/`cliffSettings` from the preset (Task 10).
- `src/components/ElevationPreviewPanel.vue` - MODIFY: "Cliffs" toolbar button (Task 10).
- `test/oracle/capture.ts` - MODIFY: add `captureCliffElevation`, `captureElevationNauvisNoCliff`, `captureCliffOffsetRaw`, `captureCliffiness`, `captureCliffEntities`; register in the CLI dispatch.
- Fixtures (generated): `test/fixtures/oracle-cliff-elevation.seed123456.json`, `oracle-elevation-nauvis-no-cliff.seed123456.json`, `oracle-cliff-offset-raw.seed123456.json`, `oracle-cliffiness.seed123456.json`, `oracle-cliff-entities.seed123456.json`.
- Tests: `test/cliffCatalog.spec.ts`, `test/cliffFields.spec.ts`, `test/cliffPlacement.spec.ts`, `test/renderCliffs.spec.ts` (all new), plus extends to `test/elevationNauvis.spec.ts`, `test/elevationRenderRequest.spec.ts`, `test/elevationPreviewCtx.spec.ts`.

---

## Task 1: Cliff catalog - constants + slider/lever math

**Files:**
- Create: `src/noise/cliffs/cliffCatalog.ts`
- Test: `test/cliffCatalog.spec.ts`

**Interfaces:**
- Produces:
  - Constants: `CLIFF_CONTROL_NAME = "nauvis_cliff"`, `CLIFF_MAP_COLOR: readonly [number,number,number] = [144, 119, 87]`, `CLIFF_GRID_SIZE = 4`, `CLIFF_GRID_OFFSET_Y = 0.5`, `CLIFF_CELL_CENTER_X = 2`, `CLIFF_CELL_CENTER_Y = 2.5`, `CLIFF_ELEVATION_0_DEFAULT = 10`, `CLIFF_ELEVATION_INTERVAL_DEFAULT = 40`, `LOW_FREQ_CLIFFINESS_SEED1 = 86883`, `CLIFF_CORNER_OFFSET_Y = 0.5`.
  - `interface CliffControls { frequency: number; continuity: number }`
  - `interface CliffSettingsInput { cliffElevation0: number; cliffElevationInterval: number; richness: number }`
  - `sliderToLinear(v: number, lo: number, hi: number): number` = `lo + 0.5*(hi-lo)*(1 + Math.log2(v)/Math.log2(6))`
  - `getModifiedElevationInterval(baseInterval: number, frequency: number): number` = `baseInterval / frequency`
  - `getModifiedRichness(baseRichness: number, continuity: number): number` = `baseRichness * continuity`

- [ ] **Step 1: Write the failing test** `test/cliffCatalog.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  CLIFF_MAP_COLOR,
  getModifiedElevationInterval,
  getModifiedRichness,
  sliderToLinear,
} from "../src/noise/cliffs/cliffCatalog";

describe("cliff catalog math", () => {
  // slider_to_linear(1) = midpoint; (6) = hi; (1/6) = lo (log2(6)/log2(6)=1, log2(1/6)/log2(6)=-1)
  it("sliderToLinear anchors", () => {
    expect(sliderToLinear(1, -1, 1)).toBeCloseTo(0, 12);
    expect(sliderToLinear(6, -1, 1)).toBeCloseTo(1, 12);
    expect(sliderToLinear(1 / 6, -1, 1)).toBeCloseTo(-1, 12);
    expect(sliderToLinear(1, -1.7, 1.7)).toBeCloseTo(0, 12);
  });
  // interval = base/frequency; richness = base*continuity; both identity at slider 1
  it("lever modifiers", () => {
    expect(getModifiedElevationInterval(40, 1)).toBeCloseTo(40, 12);
    expect(getModifiedElevationInterval(40, 2)).toBeCloseTo(20, 12); // higher freq -> tighter bands
    expect(getModifiedRichness(1, 1)).toBeCloseTo(1, 12);
    expect(getModifiedRichness(1, 0)).toBe(0); // continuity 0 -> cliff_richness 0 (cliffs disabled)
  });
  it("map color drift guard", () => expect([...CLIFF_MAP_COLOR]).toEqual([144, 119, 87]));
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/cliffCatalog.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `cliffCatalog.ts` with the constants, types, and three functions above (leave `isCliffPlaced` for Task 2).
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/cliffCatalog.spec.ts`.
- [ ] **Step 5: Commit** `feat(cliffs): cliff catalog + slider/lever math`.

---

## Task 2: Orientation predicate - extract `toMaybeCliffOrientation` (DISASM DE-RISK)

**Files:**
- Modify: `src/noise/cliffs/cliffCatalog.ts` (add `isCliffPlaced`)
- Test: `test/cliffCatalog.spec.ts` (extend)

**Interfaces:**
- Produces: `isCliffPlaced(code: number): boolean` - true iff `toMaybeCliffOrientation(code)` maps to a real orientation (not "none"). `code` is the 8-bit cell code `(enc(L)<<6)|(enc(R)<<4)|(enc(T)<<2)|enc(B)` with each field in `{0,1,3}`. Backed by a 256-entry boolean table extracted from the binary.

- [ ] **Step 1: Extract the table from the binary.** Disassemble `CellCliffCrossing::toMaybeCliffOrientation` (`0x1016067a0`, see `docs/noise/cliffs-NOTES.md` for the mangled-name recipe): `lldb -b -o "disassemble --name '<mangled toMaybeCliffOrientation>'" "$BIN"`. It maps an 8-bit `code` to a `CliffOrientation` enum value or a sentinel "none". Determine, for each of the 256 codes, whether it maps to none. If the function is a jump/lookup table, dump the table bytes (e.g. via `lldb` `memory read` at the table address, or read the `__const` section); if it is branch logic, transcribe it. Write the 256 booleans into `cliffCatalog.ts` as a `const CLIFF_PLACED_TABLE: readonly boolean[]` (or a `Uint8Array` / bitmask literal), with a comment citing the binary address. **If no local Factorio binary is available in the execution environment, STOP and hand back to Eric with the address and recipe - do NOT guess the table** (an approximation like `code !== 0` would over-place cliffs and break the ~90% placement check).
- [ ] **Step 2: Write the failing test** (extend `test/cliffCatalog.spec.ts`):

```ts
import { isCliffPlaced } from "../src/noise/cliffs/cliffCatalog";
describe("cliff orientation predicate", () => {
  it("empty cell places nothing", () => expect(isCliffPlaced(0)).toBe(false));
  it("table covers all 256 codes", () => {
    for (let c = 0; c < 256; c++) expect(typeof isCliffPlaced(c)).toBe("boolean");
    // out-of-range guards to false rather than throwing
    expect(isCliffPlaced(256)).toBe(false);
    expect(isCliffPlaced(-1)).toBe(false);
  });
  // A clean straight wall: Top and Bottom both cross the SAME sign (a N-S or W-E wall
  // spanning the cell) must place. Fill in the exact code(s) confirmed from the disasm
  // dump in Step 1 (e.g. top=+1,bottom=+1 -> code (1<<2)|1 = 5); assert it is placed.
  it("a straight-wall code places", () => expect(isCliffPlaced(/* confirmed placing code */ 5)).toBe(true));
});
```

- [ ] **Step 3: Run to verify it fails** - `pnpm vp test test/cliffCatalog.spec.ts` -> FAIL.
- [ ] **Step 4: Implement** `isCliffPlaced(code)` backed by `CLIFF_PLACED_TABLE` (range-guard non-`[0,255]` inputs to `false`). Adjust the "straight-wall code" in the test to a code the dumped table actually marks placing (from Step 1), so the assertion reflects ground truth, not a guess.
- [ ] **Step 5: Run to verify it passes** - `pnpm vp test test/cliffCatalog.spec.ts`.
- [ ] **Step 6: Commit** `feat(cliffs): extract toMaybeCliffOrientation placement predicate`.

---

## Task 3: `cliff_elevation_nauvis` field (oracle-validated)

**Files:**
- Create: `src/noise/cliffs/cliffFields.ts`
- Modify: `test/oracle/capture.ts` (add `captureCliffElevation`)
- Create fixture: `test/fixtures/oracle-cliff-elevation.seed123456.json`
- Test: `test/cliffFields.spec.ts`

**Interfaces:**
- Consumes: `makeNauvisShared` (`hills`, `cliffLevel`), `Point`.
- Produces: `makeCliffElevation(ctx: CliffFieldCtx): (x: number, y: number) => number` where

```ts
export interface CliffFieldCtx {
  readonly seed0: number;
  readonly controls: CliffControls;               // { frequency, continuity }
  readonly settings: CliffSettingsInput;           // { cliffElevation0, cliffElevationInterval, richness }
  readonly segmentationMultiplier?: number;        // control:water:frequency; default 1
  readonly waterLevel?: number;                    // default 0 (used by the no_cliff elevation term, Task 6)
  readonly startingPositions?: readonly Point[];   // default [{x:0,y:0}]
  readonly startingLakePositions?: readonly Point[];
}
```

`makeCliffElevation` = `(x,y) => 10 + 30 * (nz.hills(x,y) - nz.cliffLevel(x,y))` where `nz = makeNauvisShared({ seed0, segmentationMultiplier })`.

- [ ] **Step 1: Implement `captureCliffElevation`** in `test/oracle/capture.ts` (model on `captureAux`, multi-seed `cases` shape from `captureResourceRegular`). Sample `cliff_elevation_nauvis` over a grid that spans several cliff bands, seeds `[123456, 777771]`:

```ts
async function captureCliffElevation(): Promise<void> {
  const positions: Position[] = [];
  // Grid over [0,512) stride 16, at the cliff CORNER lattice offset (x on 4s, y on 4s+0.5)
  // so the same fixture doubles as corner-value ground truth for placement.
  for (let iy = 0; iy < 32; iy++)
    for (let ix = 0; ix < 32; ix++)
      positions.push({ x: ix * 16, y: iy * 16 + 0.5 });
  const seeds = [123456, 777771];
  const cases: { seed: number; values: number[] }[] = [];
  for (const seed of seeds) {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression("cliff_elevation_nauvis", positions, { workDir, seed });
      cases.push({ seed, values });
      console.log(`  captured cliff-elevation seed=${seed}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const out = join(FIXTURES, "oracle-cliff-elevation.seed123456.json");
  await writeFile(out, JSON.stringify({ _comment: "Ground truth from Factorio 2.1.11 via test/oracle. cliff_elevation_nauvis routed onto elevation, default settings. Regenerate: node --experimental-strip-types test/oracle/capture.ts cliff-elevation", positions, cases }, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points, ${cases.length} seeds)`);
}
```
Register `if (want("cliff-elevation")) await captureCliffElevation();` in the dispatch.
- [ ] **Step 2: Regenerate the fixture** - `node --experimental-strip-types test/oracle/capture.ts cliff-elevation`. Verify finite values in a plausible range (elevation_0 ~10 plus/minus tens). If no local Factorio, STOP and hand back to Eric with the command (fixture is read-only ground truth; do NOT hand-author).
- [ ] **Step 3: Write the failing test** `test/cliffFields.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import elevFixture from "./fixtures/oracle-cliff-elevation.seed123456.json";
import { makeCliffElevation } from "../src/noise/cliffs/cliffFields";

const ABS_TOL = 1.0, REL_TOL = 1e-2;
const ok = (p: number, g: number) => Math.abs(p - g) < Math.max(ABS_TOL, REL_TOL * Math.abs(g));
const ctx = (seed0: number) => ({
  seed0, controls: { frequency: 1, continuity: 1 },
  settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
});

describe("makeCliffElevation vs oracle", () => {
  for (const c of elevFixture.cases) {
    it(`matches cliff_elevation_nauvis seed=${c.seed}`, () => {
      const f = makeCliffElevation(ctx(c.seed));
      let worstAbs = 0;
      for (let i = 0; i < elevFixture.positions.length; i++) {
        const p = elevFixture.positions[i];
        const port = f(p.x, p.y), game = c.values[i];
        worstAbs = Math.max(worstAbs, Math.abs(port - game));
        expect(ok(port, game)).toBe(true);
      }
      expect(worstAbs).toBeLessThan(ABS_TOL * 10); // sanity: not wildly off
    });
  }
});
```

- [ ] **Step 4: Run to verify it fails** - `pnpm vp test test/cliffFields.spec.ts` -> FAIL (module not found).
- [ ] **Step 5: Implement** `makeCliffElevation` in `cliffFields.ts` (plus the `CliffFieldCtx` interface, importing `CliffControls`/`CliffSettingsInput` from `cliffCatalog`).
- [ ] **Step 6: Run to verify it passes** - `pnpm vp test test/cliffFields.spec.ts`. (`cliff_elevation_nauvis` is a two-line combination of already-validated ports, so it should pass first try. If not: the only moving parts are `nz.hills`/`nz.cliffLevel` - confirm `segmentationMultiplier` default 1 and the `10 + 30*(...)` constants.)
- [ ] **Step 7: Commit** `feat(cliffs): cliff_elevation_nauvis field, oracle-validated`.

---

## Task 4: `elevation_nauvis_no_cliff` - the `makeElevationNauvis` seam (oracle-validated)

**Files:**
- Modify: `src/noise/expressions/elevationNauvis.ts` (add `withCliffElevation?: boolean`)
- Modify: `test/oracle/capture.ts` (add `captureElevationNauvisNoCliff`)
- Create fixture: `test/fixtures/oracle-elevation-nauvis-no-cliff.seed123456.json`
- Test: `test/elevationNauvis.spec.ts` (extend - keep existing `elevation_nauvis` assertions intact)

**Interfaces:**
- `ElevationNauvisParams` gains `readonly withCliffElevation?: boolean` (default `true`). When `false`, `added_cliff_elevation = 0` (the `elevation_nauvis_no_cliff` = `elevation_nauvis_function(0)` variant). `makeElevationNauvis` behavior for the default/`true` path is UNCHANGED (its existing fixtures must still pass byte-for-byte).

- [ ] **Step 1: Implement `captureElevationNauvisNoCliff`** in `capture.ts`, sampling `elevation_nauvis_no_cliff` at a grid (reuse the `captureElevationNauvis` shape; seeds `[123456, 777771]`). Register `if (want("elevation-nauvis-no-cliff")) await captureElevationNauvisNoCliff();`.
- [ ] **Step 2: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts elevation-nauvis-no-cliff`. Verify finite. (If no Factorio, STOP + hand back.)
- [ ] **Step 3: Write the failing test** (extend `test/elevationNauvis.spec.ts`): add a block that builds `makeElevationNauvis({ seed0, withCliffElevation: false })` and asserts it matches the new no-cliff fixture (same abs/rel tolerance as the existing elevation test). ALSO keep/verify the existing `elevation_nauvis` (default) assertion so the refactor is proven non-breaking. Add a structural check: at a few points, `noCliff(x,y) <= withCliff(x,y)` is NOT assumed (added_cliff_elevation can be either sign via the lerp) - instead assert `noCliff` differs from `withCliff` where `added_cliff_elevation != 0` and equals it where hills/plateaus make the added term 0.

```ts
// pseudo - adapt to the existing spec's fixture-iteration helper
import noCliffFixture from "./fixtures/oracle-elevation-nauvis-no-cliff.seed123456.json";
describe("elevation_nauvis_no_cliff (withCliffElevation:false) vs oracle", () => {
  for (const c of noCliffFixture.cases) {
    it(`matches seed=${c.seed}`, () => {
      const f = makeElevationNauvis({ seed0: c.seed, withCliffElevation: false });
      for (let i = 0; i < noCliffFixture.positions.length; i++) {
        const p = noCliffFixture.positions[i];
        expect(ok(f(p.x, p.y), c.values[i])).toBe(true); // ok = combined abs/rel from the existing spec
      }
    });
  }
});
```

- [ ] **Step 4: Run to verify it fails** - `pnpm vp test test/elevationNauvis.spec.ts` -> the new block FAILs (param not yet honored), existing blocks PASS.
- [ ] **Step 5: Implement the seam** in `elevationNauvis.ts`: add `withCliffElevation?: boolean` to `ElevationNauvisParams`; in the returned closure replace the `addedCliffElevation` computation with:

```ts
const addedCliffElevation = (params.withCliffElevation ?? true)
  ? 0.1 * nauvisHills + 0.8 * nauvisPlateaus
  : 0;
```

(Leave everything else identical, so the default path is byte-for-byte unchanged. `nauvisHills`/`nauvisPlateaus` are still computed - they are cheap and only feed this term; do not over-optimize the refactor.)
- [ ] **Step 6: Run to verify it passes** - `pnpm vp test test/elevationNauvis.spec.ts` (both the new no-cliff block and all existing elevation assertions). Then run the FULL suite `pnpm vp test` to confirm no downstream (terrain/resources) fixture regressed from the refactor.
- [ ] **Step 7: Commit** `feat(cliffs): elevation_nauvis_no_cliff seam (added_cliff_elevation=0)`.

---

## Task 5: `nauvis_cliff_ringbreak` + offset chain (STRING-SEED DE-RISK, oracle-validated)

**Files:**
- Modify: `src/noise/expressions/nauvisShared.ts` (add `hillsOffset` + `cliffRingbreak`)
- Modify: `test/oracle/capture.ts` (add `captureCliffOffsetRaw`)
- Create fixture: `test/fixtures/oracle-cliff-offset-raw.seed123456.json`
- Test: `test/nauvisShared.spec.ts` (or `test/cliffFields.spec.ts` - wherever `nauvisShared` is tested; create `test/nauvisShared.spec.ts` if absent)

**Interfaces:**
- `NauvisShared` gains:
  - `hillsOffset: (x: number, y: number) => number` = `nauvis_hills_offset` (the domain-warped `abs(multioctave_noise{seed1=900,...})`).
  - `cliffRingbreak: (x: number, y: number) => number` = `abs(nz.hills(x,y) - nz.hillsOffset(x,y))`.
- Uses the resolved numeric string-seeds `NAUVIS_OFFSET_X_SEED1 = 593691028` / `NAUVIS_OFFSET_Y_SEED1 = 1415852290` (constants in `nauvisShared.ts`). These are `crc32(utf8Bytes("nauvis_offset_x"/"nauvis_offset_y"))` - Factorio hashes a string `basis_noise` seed1 with standard CRC32, identical to `src/codec/crc32.ts` (oracle-confirmed spike, `docs/noise/cliffs-NOTES.md`).

- [ ] **Step 1: (resolved) String-seed values are known** - `NAUVIS_OFFSET_X_SEED1 = 593691028` (`0x2360A1D4`), `NAUVIS_OFFSET_Y_SEED1 = 1415852290` (`0x5460AAC2`), both `= crc32(name)`. The Task 4 test below re-confirms them against the oracle, so hardcode the two constants (with the `crc32("...")` source comment) rather than computing at runtime. No action needed here beyond using them in Step 6.
- [ ] **Step 2: Implement `captureCliffOffsetRaw`** in `capture.ts`: sample BOTH `nauvis_hills_offset_raw_x` and `nauvis_hills_offset_raw_y` AND `nauvis_cliff_ringbreak` at a shared grid (three named expressions -> three value arrays; reuse the single-expression `sampleExpression` per name, store `{ positions, cases: [{seed, rawX, rawY, ringbreak}] }`), seeds `[123456, 777771]`. Register `if (want("cliff-offset-raw")) await captureCliffOffsetRaw();`.
- [ ] **Step 3: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts cliff-offset-raw`. Verify finite. (If no Factorio, STOP + hand back.)
- [ ] **Step 4: Write the failing test** validating `hillsOffset` and `cliffRingbreak` against the fixture (combined abs/rel tolerance), AND a direct check that the resolved seed1 reproduces `raw_x`/`raw_y` (guards the string-seed constants):

```ts
import offFixture from "./fixtures/oracle-cliff-offset-raw.seed123456.json";
import { basisNoise, basisNoiseTablesFromSeed } from "../src/noise/basisNoise";
import { makeNauvisShared } from "../src/noise/expressions/nauvisShared";
import { NAUVIS_OFFSET_X_SEED1, NAUVIS_OFFSET_Y_SEED1 } from "../src/noise/expressions/nauvisShared";
const ok = (p: number, g: number) => Math.abs(p - g) < Math.max(1.0, 1e-2 * Math.abs(g));

describe("nauvis cliff offset chain vs oracle", () => {
  for (const c of offFixture.cases) {
    it(`raw_x/raw_y string-seed reproduce seed=${c.seed}`, () => {
      const is = 1.5 / 500; // nauvisSeg/500, default seg 1
      const tx = basisNoiseTablesFromSeed(c.seed, NAUVIS_OFFSET_X_SEED1);
      const ty = basisNoiseTablesFromSeed(c.seed, NAUVIS_OFFSET_Y_SEED1);
      for (let i = 0; i < offFixture.positions.length; i++) {
        const p = offFixture.positions[i];
        expect(ok(basisNoise(p.x * is, p.y * is, tx), c.rawX[i])).toBe(true);
        expect(ok(basisNoise(p.x * is, p.y * is, ty), c.rawY[i])).toBe(true);
      }
    });
    it(`cliffRingbreak seed=${c.seed}`, () => {
      const nz = makeNauvisShared({ seed0: c.seed });
      for (let i = 0; i < offFixture.positions.length; i++) {
        const p = offFixture.positions[i];
        expect(ok(nz.cliffRingbreak(p.x, p.y), c.ringbreak[i])).toBe(true);
      }
    });
  }
});
```

(Adjust the fixture field names `rawX`/`rawY`/`ringbreak` to match what `captureCliffOffsetRaw` writes.)
- [ ] **Step 5: Run to verify it fails** - FAIL (constants/`hillsOffset`/`cliffRingbreak` not defined).
- [ ] **Step 6: Implement** in `nauvisShared.ts`:
  - Export `NAUVIS_OFFSET_X_SEED1` / `NAUVIS_OFFSET_Y_SEED1` (the resolved numbers).
  - Build the raw-offset basis tables (seed0, those seeds) and the `multioctave_noise{seed1=900, octaves=4, persistence=0.5, inputScale=nauvisSeg/90}` for the warped field (reuse `makeMultioctaveNoise`; it is the SAME params as `hillsNoise` but evaluated at a warped `(x,y)`).
  - `normalize(a,b) = a / Math.sqrt(0.001 + a*a + b*b)`.
  - `hillsOffset(x,y)`: compute `rawX = basisNoise(x*is, y*is, tablesX)`, `rawY = basisNoise(x*is, y*is, tablesY)` (`is = nauvisSeg/500`), `nx = normalize(rawX, rawY)`, `ny = normalize(rawY, rawX)`, then `Math.abs(hillsMultioctave(x + 12*nx, y + 12*ny))`. NOTE: `nauvis_hills_offset` re-evaluates the seed1=900 octave field at the WARPED coordinate - it cannot reuse the memoized `hills(x,y)`; call the underlying multioctave closure at the shifted point.
  - `cliffRingbreak(x,y) = Math.abs(hills(x,y) - hillsOffset(x,y))`.
- [ ] **Step 7: Run to verify it passes** - `pnpm vp test <the spec>`. Debug order if a point misses (do NOT loosen tolerance): (1) raw_x/raw_y test failing -> wrong `seed1` constant or wrong `input_scale` (must be `nauvisSeg/500`, `nauvisSeg = 1.5*seg`); (2) ringbreak failing but raw passing -> the warp (`12*nx`, the `normalize` arg order `_x=normalize(rawX,rawY)`, `_y=normalize(rawY,rawX)`), or the warped multioctave using the wrong params (must equal the `hills` octave params: seed1 900, octaves 4, persistence 0.5, inputScale `nauvisSeg/90`).
- [ ] **Step 8: Commit** `feat(cliffs): nauvis_cliff_ringbreak offset chain, oracle-validated`.

---

## Task 6: `cliffiness_nauvis` field (the core field, oracle-validated)

**Files:**
- Modify: `src/noise/cliffs/cliffFields.ts` (add `makeCliffiness` + `makeCliffFields`)
- Modify: `test/oracle/capture.ts` (add `captureCliffiness`)
- Create fixture: `test/fixtures/oracle-cliffiness.seed123456.json`
- Test: `test/cliffFields.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 1 (`sliderToLinear`, `getModifiedElevationInterval`, `getModifiedRichness`, `LOW_FREQ_CLIFFINESS_SEED1`), Task 4 (`makeElevationNauvis({withCliffElevation:false})`), Task 5 (`nz.cliffRingbreak`, `nz.forestPathBillows`, `nz.bridgeBillows`), `basisNoise`/`basisNoiseTablesFromSeed`, `distanceFromNearestPoint`.
- Produces:
  - `makeCliffiness(ctx: CliffFieldCtx): (x: number, y: number) => number` = `cliffiness_nauvis` (values `0` or `10`).
  - `makeCliffFields(ctx: CliffFieldCtx): { cliffElevation(x,y): number; cliffiness(x,y): number }` (combines Task 3 + this).

- [ ] **Step 1: Implement `captureCliffiness`** in `capture.ts` (single expression `cliffiness_nauvis`, `cases` shape, seeds `[123456, 777771]`, the same corner-lattice grid as `captureCliffElevation` so the two fixtures pair up for placement). Register `if (want("cliffiness")) await captureCliffiness();`.
- [ ] **Step 2: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts cliffiness`. Verify every value is exactly `0` or `10` (the gate output) and that BOTH occur in the grid. (If no Factorio, STOP + hand back.)
- [ ] **Step 3: Write the failing test** (extend `test/cliffFields.spec.ts`): assert `makeCliffiness` matches the fixture EXACTLY as a gate - since values are `0`/`10`, assert `port === game` at every point (a mismatch is a real cutoff/term error, not f32 drift). Dump the first few mismatches with coordinates:

```ts
import cliffinessFixture from "./fixtures/oracle-cliffiness.seed123456.json";
import { makeCliffiness } from "../src/noise/cliffs/cliffFields";
describe("makeCliffiness vs oracle (exact 0/10 gate)", () => {
  for (const c of cliffinessFixture.cases) {
    it(`matches cliffiness_nauvis seed=${c.seed}`, () => {
      const f = makeCliffiness(ctx(c.seed));  // ctx from Task 3's helper
      const mism: string[] = [];
      for (let i = 0; i < cliffinessFixture.positions.length; i++) {
        const p = cliffinessFixture.positions[i];
        const port = f(p.x, p.y), game = c.values[i];
        if (port !== game) mism.push(`(${p.x},${p.y}) game=${game} port=${port}`);
      }
      if (mism.length) throw new Error(`${mism.length} gate mismatches:\n${mism.slice(0, 12).join("\n")}`);
      expect(mism.length).toBe(0);
    });
  }
});
```

- [ ] **Step 4: Run to verify it fails** - FAIL (module not found).
- [ ] **Step 5: Implement** `makeCliffiness` in `cliffFields.ts`:
  - `const nz = makeNauvisShared({ seed0, segmentationMultiplier: seg })`; `nauvisSeg = nz.nauvisSeg`; `seg = ctx.segmentationMultiplier ?? 1`.
  - Effective levers: `interval = getModifiedElevationInterval(ctx.settings.cliffElevationInterval, ctx.controls.frequency)`; `cliffRichness = getModifiedRichness(ctx.settings.richness, ctx.controls.continuity)`; `cliffFrequency = 40 / interval`.
  - `noCliffElev = makeElevationNauvis({ seed0, waterLevel: ctx.waterLevel, segmentationMultiplier: seg, startingPositions, startingLakePositions, withCliffElevation: false })`.
  - `lowFreqTables = basisNoiseTablesFromSeed(seed0, LOW_FREQ_CLIFFINESS_SEED1)`.
  - `distanceAt = (x,y) => distanceFromNearestPoint(x, y, spawn)`.
  - Per `(x,y)`:
    ```ts
    const base = (nz.cliffRingbreak(x, y) - 0.01) * 60;
    const forest = (nz.forestPathBillows(x, y) - 0.03) * 12;
    const bridge = (nz.bridgeBillows(x, y) - 0.05) * 15;
    const elev = (noCliffElev(x, y) - 4) / 2;
    const startArea = -2 + (distanceAt(x, y) * seg) / 120;      // plain seg
    const lowFreq = 1.5
      + 0.51 * basisNoise((x * nauvisSeg) / 500, (y * nauvisSeg) / 500, lowFreqTables)   // output_scale 0.51
      + Math.min(sliderToLinear(cliffFrequency, -1.7, 1.7), sliderToLinear(cliffRichness, -1, 1));
    const mainCliffiness = Math.min(base, forest, bridge, elev, startArea, 4 * lowFreq);
    const cliffGap = 0.5 - 0.5 * sliderToLinear(cliffRichness, -1, 1);
    const cliffCutoff = 2 * cliffGap ** 1.5;
    return mainCliffiness >= cliffCutoff ? 10 : 0;
    ```
    NB `basisNoise` here takes `input_scale = nauvisSeg/500` applied to the coordinate (matching how `nauvisShared.cliffLevel` calls `basisNoiseExpr` with `inputScale`) - use the same primitive/convention as the existing `nauvisShared` basis calls (check whether it is `basisNoise(x*is, y*is, tables)` or `basisNoiseExpr(x, y, {inputScale, outputScale}, tables)` and match it; `output_scale = 0.51`).
  - Add `makeCliffFields(ctx)` returning `{ cliffElevation: makeCliffElevation(ctx), cliffiness: makeCliffiness(ctx) }`.
- [ ] **Step 6: Run to verify it passes** - `pnpm vp test test/cliffFields.spec.ts`. Debug order if a gate mismatch appears (do NOT loosen; the fixture is exact 0/10):
  1. **All-or-nothing wrong (everything 0 or everything 10)** -> `cliffCutoff` (should be `0.7071` at default) or a sign error in a term.
  2. **Boundary cells only** -> a single term is the binding `min` and slightly off: isolate by temporarily logging which term is the `min` at a mismatch and compare each against its own oracle (each is a scaled ported sub-node). `base_cliffiness` (ringbreak) is the most likely culprit (Task 5); `elevation_cliffiness` next (Task 4).
  3. **A uniform region wrong** -> `lowFreq` (seed 86883, output_scale 0.51, the `slider_to_linear` args `-1.7,1.7` vs `-1,1`) or `startArea` (plain `seg`, `/120`).
- [ ] **Step 7: Commit** `feat(cliffs): cliffiness_nauvis field, oracle-validated`.

---

## Task 7: `cliffPlacement` - crossesCliff + grid enumeration

**Files:**
- Create: `src/noise/cliffs/cliffPlacement.ts`
- Test: `test/cliffPlacement.spec.ts`

**Interfaces:**
- Consumes: `makeCliffFields` (T6), `isCliffPlaced` (T2), `getModifiedElevationInterval` (T1), `CLIFF_GRID_SIZE`/`CLIFF_CORNER_OFFSET_Y`/`CLIFF_CELL_CENTER_X`/`CLIFF_CELL_CENTER_Y` (T1), `CliffFieldCtx`.
- Produces:
  - `crossesCliff(a: number, b: number, cliffAvg: number, e0: number, interval: number): -1 | 0 | 1` (the verified rule).
  - `makeCliffPlacement(ctx: CliffFieldCtx): { placedCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] }` - the cliff cell centers placed within the world box `[x0,x1) x [y0,y1)`.

- [ ] **Step 1: Write the failing test** `test/cliffPlacement.spec.ts` for `crossesCliff` (hand-computed from the rule, no oracle needed) + a lattice check:

```ts
import { describe, expect, it } from "vite-plus/test";
import { crossesCliff, makeCliffPlacement } from "../src/noise/cliffs/cliffPlacement";

describe("crossesCliff", () => {
  const I = 40, E0 = 10;
  it("no crossing within a band", () => expect(crossesCliff(12, 20, 10, E0, I)).toBe(0)); // both band 0
  it("negative elevation never crosses", () => expect(crossesCliff(-1, 60, 10, E0, I)).toBe(0));
  it("below elevation_0 never crosses", () => expect(crossesCliff(5, 8, 10, E0, I)).toBe(0)); // max<E0
  it("crossing gated OFF when cliffiness avg <= 0.5", () => expect(crossesCliff(45, 55, 0, E0, I)).toBe(0));
  it("signed crossing up", () => {
    // max=55 -> boundary = 10 + 40*floor((55-10)/40)=10+40=50; a=45<50, b=55>50, avg>0.5 -> +1
    expect(crossesCliff(45, 55, 10, E0, I)).toBe(1);
  });
  it("signed crossing down", () => expect(crossesCliff(55, 45, 10, E0, I)).toBe(-1));
});

describe("makeCliffPlacement lattice", () => {
  it("all placed cliffs sit on x≡2, y≡2.5 (mod 4)", () => {
    const pl = makeCliffPlacement({
      seed0: 123456, controls: { frequency: 1, continuity: 1 },
      settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
    });
    const cells = pl.placedCells(0, 0, 512, 512);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(((c.x % 4) + 4) % 4).toBe(2);
      expect(((c.y % 4) + 4) % 4).toBeCloseTo(2.5, 9);
    }
  });
  it("continuity 0 places no cliffs", () => {
    const pl = makeCliffPlacement({
      seed0: 123456, controls: { frequency: 1, continuity: 0 },
      settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
    });
    expect(pl.placedCells(0, 0, 512, 512).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL (module not found).
- [ ] **Step 3: Implement** `cliffPlacement.ts`:
  - `crossesCliff` exactly per the rule (floor toward -inf via `Math.floor`; return `0`/`1`/`-1`).
  - `makeCliffPlacement`: build `const { cliffElevation, cliffiness } = makeCliffFields(ctx)`; `interval = getModifiedElevationInterval(ctx.settings.cliffElevationInterval, ctx.controls.frequency)`; `e0 = ctx.settings.cliffElevation0`. Short-circuit to `[]` when `ctx.controls.continuity === 0` (or `cliffRichness === 0`) - cliffs disabled.
  - `placedCells(x0,y0,x1,y1)`: iterate cells whose center is in the box. Cell `(cx,cy)` has center `(cx*4+2, cy*4+2.5)`; corners at `(i*4, j*4+0.5)`. Enumerate `cx` from `floor((x0-2)/4)` to `ceil((x1-2)/4)`, `cy` similar with the `2.5` center. For each cell, sample `cliffElevation`/`cliffiness` at its 4 corners (memoize corner values across adjacent cells via a `Map` keyed on `(i,j)` to avoid 4x redundant field evals), compute `L,R,T,B` via `crossesCliff(elev, elev', (cliff+cliff')/2, e0, interval)`, assemble `code = (enc(L)<<6)|(enc(R)<<4)|(enc(T)<<2)|enc(B)` (`enc: v=> v<0?3:v`), and if `isCliffPlaced(code)` push `{ x: cx*4+2, y: cy*4+2.5 }` when the center is within `[x0,x1) x [y0,y1)`.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/cliffPlacement.spec.ts`.
- [ ] **Step 5: Commit** `feat(cliffs): crossesCliff + 4-tile-grid cliff placement`.

---

## Task 8: `find_entities` cliff oracle + placement validation (~90% drift guard)

**Files:**
- Modify: `test/oracle/oracle.ts` (add a `find_entities{type="cliff"}` chunk-forced path, model on the `get_tile` `buildTile*` functions)
- Modify: `test/oracle/capture.ts` (add `captureCliffEntities`)
- Create fixture: `test/fixtures/oracle-cliff-entities.seed123456.json`
- Test: `test/cliffPlacement.spec.ts` (extend)

**Interfaces:**
- Produces a committed fixture `{ _comment, region: {x0,y0,x1,y1}, cases: [{ seed, cliffs: [{x,y}] }] }`: every cliff entity the game placed in a region at the default preset, for seeds `[123456, 777771]`.

- [ ] **Step 1: Add the cliff-entity oracle path** to `test/oracle/oracle.ts`. Model EXACTLY on the `get_tile` path (`buildTileInfoJson`/`buildTileModList`/`buildTileMapGenSettings`/`buildTileControlLua` + the spawn/args/config plumbing). The mod's `control.lua`: on init, `request_to_generate_chunks` + `force_generate_chunk_requests()` over the region's chunks, then `surface.find_entities_filtered{ type = "cliff", area = {{x0,y0},{x1,y1}} }`, write `{position={x,y}}` for each to JSON, `error("DUMPED-OK")`. Export a `sampleCliffEntities(region, {workDir, seed}) -> {x:number,y:number}[]` helper. Reuse the DEFAULT preset (no `property_expression_names` routing) so real cliff placement runs.
- [ ] **Step 2: Implement `captureCliffEntities`** in `capture.ts` using `sampleCliffEntities` over a region (e.g. `[512,1024) x [512,1024)` = 16x16 chunks - enough cliffs, bounded gen time), seeds `[123456, 777771]`. Register `if (want("cliff-entities")) await captureCliffEntities();`.
- [ ] **Step 3: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts cliff-entities`. Verify a plausible cliff count (tens to low hundreds) and that every dumped position satisfies `x≡2, y≡2.5 (mod 4)` (a sanity check on the oracle itself). (If no Factorio, STOP + hand back.)
- [ ] **Step 4: Write the failing test** (extend `test/cliffPlacement.spec.ts`): for each seed, run `placedCells` over the fixture region and compare to the dumped cliff set. Assert (a) lattice-exactness (already covered, but re-assert on the real region), (b) **no false negatives beyond the documented residual** and the placed-set agreement is `>= 0.85` (the ~90% from the spike, with headroom for the f32 field port adding a touch of drift):

```ts
import entFixture from "./fixtures/oracle-cliff-entities.seed123456.json";
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
describe("cliff placement vs find_entities (~90% drift guard)", () => {
  for (const c of entFixture.cases) {
    it(`reproduces >=85% of real cliffs seed=${c.seed}`, () => {
      const pl = makeCliffPlacement({
        seed0: c.seed, controls: { frequency: 1, continuity: 1 },
        settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
      });
      const r = entFixture.region;
      const predicted = new Set(pl.placedCells(r.x0, r.y0, r.x1, r.y1).map(key));
      const actual = c.cliffs.map(key);
      const matched = actual.filter((k) => predicted.has(k)).length;
      const frac = matched / actual.length;
      // Residual = deferred fixImpossibleCells + water rejection (docs/noise/cliffs-NOTES.md).
      expect(frac).toBeGreaterThanOrEqual(0.85);
    });
  }
});
```

- [ ] **Step 5: Run to verify it fails** - FAIL (fixture/oracle path missing) then, once present, verify the assertion holds. If `frac` lands well below 0.85, that is a REAL finding (the field port or rule drifted from the spike's 90%) - debug the fields/rule, do NOT lower the threshold. If it lands materially ABOVE 0.90, note it (the field port may be tighter than the spike's oracle-sampled fields).
- [ ] **Step 6: Implement** any fix surfaced (expected: none - the rule is spike-verified; the fields are Task 3/6-validated).
- [ ] **Step 7: Run to verify it passes** - `pnpm vp test test/cliffPlacement.spec.ts`.
- [ ] **Step 8: Commit** `test(cliffs): find_entities cliff oracle + placement drift guard`.

---

## Task 9: `renderCliffs` - composite onto terrain, skip water

**Files:**
- Create: `src/noise/preview/renderCliffs.ts`
- Test: `test/renderCliffs.spec.ts`

**Interfaces:**
- Consumes: `makeCliffPlacement` (T7), `CLIFF_MAP_COLOR` (T1), `WATER_TILE_COLORS` (from `./renderResources`), `Point`, `CliffControls`/`CliffSettingsInput`.
- Produces: `renderCliffs(base: ImageData, opts: RenderCliffsOptions): void` (mutates in place), mirroring `renderEnemies`:

```ts
export interface RenderCliffsOptions {
  readonly seed0: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly tilesPerPixel?: number;
  readonly controls: CliffControls;
  readonly settings: CliffSettingsInput;
  readonly segmentationMultiplier?: number;
  readonly waterLevel?: number;
  readonly startingPositions?: readonly Point[];
  readonly startingLakePositions?: readonly Point[];
}
```

Body: compute the world box `[originX, originX + width*tpp) x [originY, originY + height*tpp)`; `const cells = makeCliffPlacement({...}).placedCells(box)`; for each cell center `(wx,wy)`, map to pixel `px=floor((wx-originX)/tpp)`, `py=floor((wy-originY)/tpp)`; if in `[0,width) x [0,height)` and that pixel is NOT water (reuse the `isWater` check over `WATER_TILE_COLORS`), paint `CLIFF_MAP_COLOR` opaque.

- [ ] **Step 1: Write the failing test** `test/renderCliffs.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { renderCliffs } from "../src/noise/preview/renderCliffs";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { CLIFF_MAP_COLOR } from "../src/noise/cliffs/cliffCatalog";

const land = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(90) }) as ImageData;
const settings = { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 };

describe("renderCliffs", () => {
  it("paints cliff cells the cliff color", () => {
    // Render a region known to contain cliffs (from the Task 8 fixture region) at tpp 1.
    const img = land(64, 64);
    renderCliffs(img, { seed0: 123456, originX: 512, originY: 512, tilesPerPixel: 1, controls: { frequency: 1, continuity: 1 }, settings });
    // At least one pixel became the cliff color.
    let painted = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i] === CLIFF_MAP_COLOR[0] && img.data[i + 1] === CLIFF_MAP_COLOR[1] && img.data[i + 2] === CLIFF_MAP_COLOR[2]) painted++;
    expect(painted).toBeGreaterThan(0);
  });
  it("continuity 0 paints nothing", () => {
    const img = land(64, 64);
    renderCliffs(img, { seed0: 123456, originX: 512, originY: 512, tilesPerPixel: 1, controls: { frequency: 1, continuity: 0 }, settings });
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(90);
  });
  it("never paints water", () => {
    const [wr, wg, wb] = WATER_TILE_COLORS[0];
    const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as ImageData;
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = wr; img.data[i + 1] = wg; img.data[i + 2] = wb; img.data[i + 3] = 255; }
    renderCliffs(img, { seed0: 123456, originX: 512, originY: 512, tilesPerPixel: 1, controls: { frequency: 1, continuity: 1 }, settings });
    for (let i = 0; i < img.data.length; i += 4) expect([img.data[i], img.data[i + 1], img.data[i + 2]]).toEqual([wr, wg, wb]);
  });
  it("map color drift guard", () => expect([...CLIFF_MAP_COLOR]).toEqual([144, 119, 87]));
});
```

- [ ] **Step 2: Run to verify it fails** - FAIL (module not found).
- [ ] **Step 3: Implement** `renderCliffs.ts` (mirror `renderEnemies.ts`'s `isWater` helper + structure).
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/renderCliffs.spec.ts`. (If "paints cliff cells" finds nothing, the chosen origin/region has no cliffs at tpp 1 in a 64x64 window - pick a region/window from the Task 8 fixture that definitely contains a cliff, or widen to 128x128.)
- [ ] **Step 5: Commit** `feat(cliffs): cliff footprint render (grid enumeration + water exclusion)`.

---

## Task 10: Wiring - view "cliffs" + levers + toolbar

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (add `view: "cliffs"`, `cliffControls?`, `cliffSettings?`, dispatch branch).
- Modify: `src/model/elevationPreviewCtx.ts` (expose `cliffControls`/`cliffSettings` from the preset).
- Modify: `src/components/ElevationPreviewPanel.vue` ("Cliffs" toolbar button; widen the `view` ref; pass `cliffControls`/`cliffSettings`).
- Test: `test/elevationRenderRequest.spec.ts` (extend), `test/elevationPreviewCtx.spec.ts` (extend).

**Interfaces:**
- `ElevationRenderRequest.view` gains `"cliffs"`; add `cliffControls?: CliffControls` and `cliffSettings?: CliffSettingsInput`.
- `runRenderRequest`: `"cliffs"` renders the terrain base then `renderCliffs` (exactly like the `"enemies"` branch). Extend the guard: `if (req.view === "terrain" || req.view === "resources" || req.view === "enemies" || req.view === "cliffs")`, then inside, `if (req.view === "cliffs") renderCliffs(image, { seed0, originX, originY, tilesPerPixel, controls: req.cliffControls ?? { frequency: 1, continuity: 1 }, settings: req.cliffSettings ?? { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 }, segmentationMultiplier: req.segmentationMultiplier, waterLevel: req.waterLevel, startingPositions: req.startingPositions, startingLakePositions: req.startingLakePositions })`.
- `ElevationPreviewCtx` gains `cliffControls: CliffControls` and `cliffSettings: CliffSettingsInput`; `elevationCtxFromPreset` reads `const cc = preset.autoplaceControls[CLIFF_CONTROL_NAME]; cliffControls = cc ? { frequency: cc.frequency, continuity: cc.size } : { frequency: 1, continuity: 1 };` and `cliffSettings = { cliffElevation0: preset.cliffSettings.cliffElevation0, cliffElevationInterval: preset.cliffSettings.cliffElevationInterval, richness: preset.cliffSettings.richness }`.

- [ ] **Step 1: Write the failing tests.**
  - `test/elevationRenderRequest.spec.ts`: add a case that `runRenderRequest({ ...baseReq, view: "cliffs", cliffControls: { frequency: 1, continuity: 1 }, cliffSettings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 } })` returns a buffer whose pixels differ from the plain `"terrain"` render somewhere in a cliff-bearing viewport (origin/region from the Task 8 fixture). Reuse the spec's existing request-builder helper.
  - `test/elevationPreviewCtx.spec.ts`: assert `elevationCtxFromPreset(preset).cliffControls` reads `nauvis_cliff` frequency + size->continuity (build a preset with `autoplaceControls["nauvis_cliff"] = { frequency: 2, size: 0.5, richness: 1 }`; expect `{ frequency: 2, continuity: 0.5 }`), defaults to `{ frequency: 1, continuity: 1 }` when absent, and `cliffSettings` reflects `preset.cliffSettings` (elevation0/interval/richness).
- [ ] **Step 2: Run to verify they fail** - `pnpm vp test test/elevationRenderRequest.spec.ts test/elevationPreviewCtx.spec.ts`.
- [ ] **Step 3: Implement** the three source edits. In `ElevationPreviewPanel.vue`: widen `const view = ref<"elevation" | "terrain" | "resources" | "enemies" | "cliffs">("elevation")`; add the "Cliffs" toolbar `FButton` after Enemies (`data-test="view-cliffs"`, label `Cliffs`, gated on `terrainAvailable`, title "Cliffs view is only available for the Nauvis map type"); add `cliffControls: info.cliffControls, cliffSettings: info.cliffSettings` to the `renderer.render({...})` request. The existing `watch(terrainAvailable, ...)` that resets non-Nauvis views already covers `"cliffs"` (it resets whenever `!available`).
- [ ] **Step 4: Run to verify they pass**, then the FULL suite `pnpm vp test` and `pnpm vp check --fix`.
- [ ] **Step 5: Commit** `feat(cliffs): wire cliffs view + levers + toolbar toggle`.

---

## Task 11: Manual eyeball + docs

- [ ] **Headless render check.** Write a throwaway spec under the scratchpad (NOT under `test/`) that calls `runRenderRequest({ id: 0, view: "cliffs", seed0: 123456, width: 512, height: 512, originX: 512, originY: 512, tilesPerPixel: 2, waterLevel: 0, segmentationMultiplier: 1, startingPositions: [{x:0,y:0}], mapType: "nauvis", cliffControls: { frequency: 1, continuity: 1 }, cliffSettings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 } })` and writes a PNG (reuse the minimal zlib PNG encoder from the M3/M4 eyeball). Confirm: cliffs trace plateau/hill edges as brown rings, cluster sensibly, and thin/vanish as `continuity` drops (render again at `continuity: 0.3` and `continuity: 0`). Cross-check against a real `factorio --generate-map-preview` of seed 123456 for the same region (cliffs should sit in the same places). Send the PNG(s) to Eric.
- [ ] **In-app eyeball (Eric).** `pnpm vp dev` -> Terrain tab -> Nauvis -> Preview -> Cliffs toggle -> Generate. Confirm cliffs render and the Cliffs Frequency/Continuity sliders shift them (Continuity 0 clears them). (Eric's to run.)
- [ ] **Docs.** Update `docs/noise/client-preview-ROADMAP.md` (M4 cliffs DONE; note `fixImpossibleCells`/ore-on-cliffs still deferred; `VoronoiNoise` remains un-ported and is now confirmed unneeded for Nauvis). Update `docs/noise/cliffs-NOTES.md` with any final residual number from Task 8 and the resolved string-seed values from Task 5. Update the Claude memory: add an `m4-cliffs.md` note (M4 cliffs shipped: fields oracle-validated, geometric placement ~90%, fixImpossibleCells deferred) and cross-link `[[m4-enemy-bases]]`, `[[factorio-data-version-hazard]]`; mark Milestone 4 complete in `MEMORY.md`.
- [ ] **Commit** `docs(cliffs): M4 cliffs done`.

## Self-review notes

- **Spec coverage** (`docs/superpowers/specs/2026-07-20-milestone4-cliffs-design.md`):
  - `cliff_elevation_nauvis` port -> Task 3. `cliffiness_nauvis` port (all 6 terms) -> Tasks 4 (no_cliff), 5 (ringbreak), 6 (assembly). `slider_to_linear`/`getModified*` -> Task 1.
  - Orientation predicate extraction -> Task 2. String-seed resolution -> Task 5 (spike-sourced) + its oracle guard.
  - `crossesCliff` + 4-tile grid placement -> Task 7. find_entities validation (~90%) -> Task 8.
  - `renderCliffs` (enumerate cells, water-exclude, cliff map_color) -> Task 9.
  - `view: "cliffs"` + levers (`nauvis_cliff` freq/continuity + `cliffSettings`) + toolbar -> Task 10.
  - Oracle-first validation (assert fields, drift-guard placement, eyeball) -> Tasks 3/6/8/11.
- **Type consistency:** `CliffControls` is `{ frequency, continuity }` everywhere (catalog, field ctx, render opts, request, preview ctx). `CliffSettingsInput` is `{ cliffElevation0, cliffElevationInterval, richness }`. `CliffFieldCtx` is the shared field/placement ctx. `makeCliffFields` returns `{ cliffElevation, cliffiness }`. `CLIFF_MAP_COLOR = [144,119,87]`.
- **Out of scope / deferred (do NOT implement):** `fixImpossibleCells` (~10% placement residual), exact `wouldCollide`, ore-on-cliff exclusion, cliff sprite orientation (render is a colored footprint), non-default `starting_area`, non-Nauvis planets + the `cliffiness_basic` variant, combining overlays in one view.
- **Not-in-CI:** Tasks 2 (disasm), 3/4/5/6/8 (Factorio oracle fixtures) need a local Factorio/binary; if absent, hand back to Eric rather than fabricate a fixture or guess the orientation table.

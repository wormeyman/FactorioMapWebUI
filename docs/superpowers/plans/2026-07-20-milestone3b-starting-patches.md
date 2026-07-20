# M3b - Starting resource patches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the near-spawn guaranteed `starting_patches` (iron/copper/coal/stone) and the outer `all_patches = max(starting_patches, regular_patches)` to the resource overlay, oracle-validated point-by-point, layered on the shipped M3a regular-patch machinery.

**Architecture:** Port the `starting_patches` branch of `resource_autoplace_all_patches` (core/prototypes/noise-functions.lua) as a second spot field over the already-solved `selectSpots`/`basisNoise`/`randomPenalty` primitives, then combine it with the M3a regular field via `max` in a new `makeResourcePatches` factory. The starting favorability couples to the literal `elevation_lakes` expression (reuse the M1 `makeElevationLakes` closure) and contains a batched `random_penalty` - both resolved empirically against a `has_starting_area_placement=1` oracle fixture. The resolver and render pipeline switch from `makeRegularPatches` to `makeResourcePatches`; oil/uranium stay regular-only.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Pinia, vite-plus test. Headless Factorio 2.1.11 oracle (`test/oracle/`).

## Global Constraints

- **Oracle parity is a hard invariant.** Ported expressions match the game to the f32 noise floor (M3a pinned the regular field to `< 1.0` absolute / `< 1e-2` relative; the same tolerances apply here). NEVER loosen a tolerance to pass; a mismatch is a real finding. Oracle fixtures are read-only ground truth - never hand-author or edit them.
- **`src/**` imports are EXTENSIONLESS.** Tests import from `"vite-plus/test"`. `test/oracle/*.ts` import oracle helpers WITH a `.ts` extension. `capture.ts` cannot import `src/**` (it runs under `node --experimental-strip-types`, no extensionless resolution) - inline any params it needs, exactly as `captureResourceRegular` does.
- **Reuse the solved primitives**, do not re-derive: `src/noise/spotSelection.ts` (`selectSpots`), `src/noise/spotCandidates.ts` (`SpotRegionKey`), `src/noise/basisNoise.ts`, `src/noise/randomPenalty.ts` (`randomPenaltyBatch`), `src/noise/fastApprox.ts` (`fastCbrt`), `src/noise/expressions/elevationLakes.ts` (`makeElevationLakes`), `src/noise/distanceFromNearestPoint.ts`.
- **The regular math is already M3b-correct.** `resourceMath.ts`'s `basementValue` already computes `-6 * max(regularBlobAmplitude, startingBlobAmplitude)` and every regular function is `has_starting`-invariant (both the `0` and `1` branches of the Lua `has_starting == -1` ternary are identical). Do NOT change the regular field for M3b; only add the starting field and the outer `max`.
- **No tsc/vue-tsc gate.** `vp check` is lint+format only; verify by running tests, not by trusting LSP diagnostics.
- **Commit footer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01GUHuWN82U7aRrBLMCywksk`. Hyphens, never em/en dashes. Work on branch `feat/m3-resources` (do NOT merge to main). Commit/push only when Eric asks - each task's "Commit" step is a local commit.
- **Node 24.18.0**, run everything through pnpm (`pnpm vp test`, `pnpm vp test test/<f>.spec.ts`, `pnpm vp check --fix`).

## Background: the starting-patches expression (verbatim, from noise-functions.lua)

```
all_patches = if(has_starting_area_placement == 1, max(starting_patches, regular_patches), regular_patches)

starting_patches = spot_noise{
    density_expression        = starting_amount / (pi * 120^2) * starting_modulation,
    spot_quantity_expression  = starting_area_spot_quantity,                 -- CONSTANT, no random_penalty
    spot_radius_expression    = starting_rq_factor * starting_area_spot_quantity^(1/3),
    spot_favorability_expression = clamp((elevation_lakes - 1)/10, 0, 1) * starting_modulation * 2
                                 - distance / 120 + random_penalty_at(0.5, 1),   -- random_penalty => BATCH
    seed0 = map_seed, seed1 = seed1 + 1,                                     -- NB: +1 vs regular
    skip_span = starting_patch_set_count, skip_offset = starting_patch_set_index,
    region_size = 240, candidate_spot_count = 32,
    suggested_minimum_candidate_point_spacing = 32,
    hard_region_target_quantity = 1,                                        -- last kept spot shrinks
    basement_value = basement_value, maximum_spot_basement_radius = 128
  } + (blobs0 - 0.25) * starting_blob_amplitude

starting_amount            = 20000 * base_density * (frequency_multiplier + 1) * size_multiplier
starting_area_spot_quantity = starting_amount / 0.5 / frequency_multiplier      -- starting_patches_split = 0.5
starting_blob_amplitude    = (starting_blob_amplitude_multiplier/8) / (pi/3 * starting_rq_factor^2) * starting_area_spot_quantity^(1/3)
starting_modulation        = (120 > distance) ? 1 : 0
blobs0                     = basis_noise{1/8, seed1} + basis_noise{1/24, seed1}   -- seed1 (NOT +1); shared with regular
```

Only iron/copper/coal/stone have `has_starting_area_placement = true` (starting_patch_set_count = 4). Their `starting_patch_set_index` equals their `patchSetIndex` (0/1/2/3) because they register first. oil/uranium are `false` -> regular-only, unchanged from M3a.

Key facts pinned against the game source (see the reads in the M3b session, and docs/noise/spot-noise-NOTES.md / random-penalty-NOTES.md):

- `basementValue` (resourceMath.ts) is already the shared `-6 * max(regular, starting)` floor; both spot fields use it. No change.
- `starting_blob_amplitude` is already `startingBlobAmplitude(params, controls)` in resourceMath.ts (used by basementValue). Reuse it for the starting blob term.
- The starting field is `basement` everywhere except the origin region: beyond `distance = 120`, `starting_modulation = 0` -> `density = 0` -> regional `target = 0` -> zero spots kept. So `max(starting, regular)` differs from `regular` only within ~240 tiles of spawn.
- Starting spot QUANTITY is a constant (no `random_penalty`), so NO `quantityBatch`; but FAVORABILITY carries a `random_penalty_at(0.5, 1)` batch, so it needs a batched evaluation (new `favorabilityBatch`, Task 2). Per the spot-noise order of operations (generatePoints -> skip set -> evaluate density/favorability/quantity at those spots -> sort -> place), the favorability batch = all skip-set accepted spots in acceptance order, seeded from spot[0], streamed last->first (same batch shape M3a used for the regular quantity).

## File structure

- `src/noise/resources/startingPatches.ts` - NEW: `makeStartingPatches(params, ctx)` -> `{ field(x, y) }`, the starting spot field + starting blob term.
- `src/noise/resources/resourcePatches.ts` - NEW: `makeResourcePatches(params, ctx)` -> `{ field, probability, richness }`, the outer `max(starting, regular)` (regular-only for oil/uranium).
- `src/noise/resources/resourceMath.ts` - MODIFY: export the starting local functions (`startingAmount`, `startingAreaSpotQuantity`, `startingDensityAt`, `startingModulation`, `startingSpotRadius`, `startingFavorabilityBaseAt`) reusing the existing `startingBlobAmplitude`.
- `src/noise/spotSelection.ts` - MODIFY: add a `favorabilityBatch` option (mirrors `quantityBatch`); change the hard-target `coneScale` from `Math.cbrt` to `fastCbrt`.
- `src/noise/resources/resolveResource.ts` - MODIFY: build `makeResourcePatches` (not `makeRegularPatches`); thread the elevation-lakes ctx (segmentationMultiplier/waterLevel/startingLakePositions) and starting skip params.
- `src/noise/preview/renderResources.ts` - MODIFY: accept + forward the elevation-lakes ctx to the resolver.
- `src/noise/preview/elevationRenderRequest.ts` - MODIFY: forward `segmentationMultiplier`/`waterLevel`/`startingLakePositions` (already on the request) into `renderResources`.
- `test/oracle/capture.ts` - MODIFY: add `captureResourceStarting` (probe with `has_starting_area_placement = 1`, both set counts = 1); register in the CLI dispatch.
- Fixture (generated): `test/fixtures/oracle-resource-starting.seed123456.json`.
- Tests: `test/resourceMath.spec.ts` (extend), `test/spotSelection.spec.ts` (extend), `test/startingPatches.spec.ts` (new), `test/resourcePatches.spec.ts` (new, validates against the fixture), `test/resolveResource.spec.ts` (extend), `test/renderResources.spec.ts` (extend).

---

## Task 1: Starting-patch local functions (resourceMath additions)

**Files:**
- Modify: `src/noise/resources/resourceMath.ts`
- Test: `test/resourceMath.spec.ts` (extend)

**Interfaces:**
- Consumes: `ResourceParams` (resourceCatalog), `ResourceControls` (existing, `{ frequency, size }`), `fastCbrt`, the existing module constants (`STARTING_RESOURCE_PLACEMENT_RADIUS = 120`, `STARTING_PATCHES_SPLIT = 0.5`, `STARTING_BLOB_AMPLITUDE_MULTIPLIER = 1/8`).
- Produces (all pure, exported):
  - `startingAmount(params, controls): number` = `20000 * baseDensity * (frequency + 1) * size`
  - `startingAreaSpotQuantity(params, controls): number` = `startingAmount / STARTING_PATCHES_SPLIT / frequency`
  - `startingModulation(distance): number` = `distance < STARTING_RESOURCE_PLACEMENT_RADIUS ? 1 : 0`
  - `startingDensityAt(distance, params, controls): number` = `startingAmount / (PI * 120 * 120) * startingModulation(distance)`
  - `startingSpotRadius(params, controls): number` = `startingRqFactor * fastCbrt(startingAreaSpotQuantity)` (f32-routed cube root, matching the game's noise machine - same reasoning as `regularSpotHeightTypicalAt`)
  - `startingFavorabilityBaseAt(distance, elevationLakes, params, controls): number` = `clamp((elevationLakes - 1)/10, 0, 1) * startingModulation(distance) * 2 - distance / 120` (the NON-random part of the favorability; the `random_penalty_at(0.5, 1)` batch term is added in Task 3)

Refactor `startingBlobAmplitude` (already present) to call the new `startingAreaSpotQuantity` rather than recomputing inline, so there is one definition. `startingAmount` currently lives inline in `startingBlobAmplitude` - extract it.

- [ ] **Step 1: Write the failing test** in `test/resourceMath.spec.ts`. Hand-compute iron at the default controls `{ frequency: 1, size: 1 }` (paste the arithmetic in comments) and assert `toBeCloseTo(_, 6)`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import {
  startingAmount,
  startingAreaSpotQuantity,
  startingDensityAt,
  startingModulation,
  startingSpotRadius,
  startingFavorabilityBaseAt,
} from "../src/noise/resources/resourceMath";

const iron = RESOURCE_CATALOG[0]; // base_density 10, startingRqFactor 1.5/7
const ctrl = { frequency: 1, size: 1 };

describe("starting-patch local functions (iron, default controls)", () => {
  // starting_amount = 20000 * 10 * (1 + 1) * 1 = 400000
  it("startingAmount", () => expect(startingAmount(iron, ctrl)).toBeCloseTo(400000, 6));
  // starting_area_spot_quantity = 400000 / 0.5 / 1 = 800000
  it("startingAreaSpotQuantity", () =>
    expect(startingAreaSpotQuantity(iron, ctrl)).toBeCloseTo(800000, 6));
  // starting_modulation = 1 inside 120, 0 outside
  it("startingModulation", () => {
    expect(startingModulation(50)).toBe(1);
    expect(startingModulation(120)).toBe(0); // 120 > 120 is false
    expect(startingModulation(200)).toBe(0);
  });
  // density at d=50 = 400000 / (pi * 120^2) * 1 = 400000 / 45238.934 = 8.8419...
  it("startingDensityAt inside", () =>
    expect(startingDensityAt(50, iron, ctrl)).toBeCloseTo(400000 / (Math.PI * 120 * 120), 6));
  it("startingDensityAt outside is 0", () =>
    expect(startingDensityAt(200, iron, ctrl)).toBe(0));
  // radius = (1.5/7) * cbrt(800000) ~= 0.214286 * 92.832 ~= 19.89 (fastCbrt ~ exact to ~1e-4)
  it("startingSpotRadius", () =>
    expect(startingSpotRadius(iron, ctrl)).toBeCloseTo((1.5 / 7) * Math.cbrt(800000), 2));
  // favorability base at d=60, elev=11: clamp((11-1)/10,0,1)*1*2 - 60/120 = 1*2 - 0.5 = 1.5
  it("startingFavorabilityBaseAt land near spawn", () =>
    expect(startingFavorabilityBaseAt(60, 11, iron, ctrl)).toBeCloseTo(1.5, 6));
  // at d=200 (outside): clamp * 0 * 2 - 200/120 = -1.6667
  it("startingFavorabilityBaseAt outside", () =>
    expect(startingFavorabilityBaseAt(200, 11, iron, ctrl)).toBeCloseTo(-200 / 120, 6));
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/resourceMath.spec.ts` -> FAIL (exports not found).
- [ ] **Step 3: Implement** the six functions in `resourceMath.ts`; refactor `startingBlobAmplitude` to reuse `startingAmount`/`startingAreaSpotQuantity`. Use the module `clamp`. Route `startingSpotRadius`'s cube root through `fastCbrt`.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/resourceMath.spec.ts`.
- [ ] **Step 5: Commit** `feat(resources): starting-patch local functions`.

---

## Task 2: `selectSpots` - `favorabilityBatch` option + fastCbrt cone shrink

**Files:**
- Modify: `src/noise/spotSelection.ts`
- Test: `test/spotSelection.spec.ts` (extend)

**Interfaces:**
- Consumes: `fastCbrt` (fastApprox).
- Produces: on `SpotExpressions`, a new optional
  `favorabilityBatch?: (spots: readonly { x: number; y: number }[]) => number[]` - when present it overrides the per-spot `favorability` and is evaluated ONCE over the skip-set accepted spots (in acceptance order, i.e. the order `mine` is built), returning a favorability per spot aligned to the input. Needed for favorability expressions containing a `random_penalty` (a batch op). Also: the hard-target `coneScale` now uses `fastCbrt(q2 / q)` instead of `Math.cbrt` (the game's `placeSpots` shrinks via its fastapprox `exp2(log2(ratio) * 0.3333)`; docs/noise/spot-noise-NOTES.md "placeSpots").

Implementation notes: mirror the existing `quantityBatch` plumbing. Compute `const favVals = p.favorabilityBatch ? p.favorabilityBatch(mine) : null;`. In the `ranked` map, use `fav: favVals ? favVals[j] : p.favorability(a.x, a.y)`. Because `favorabilityBatch` aligns to `mine` (acceptance order) and `j` is the index into `mine`, `favVals[j]` is correct. Keep the existing `quantityBatch` behavior untouched.

- [ ] **Step 1: Write the failing test** in `test/spotSelection.spec.ts` (add a new `describe`), asserting `favorabilityBatch` reorders the trim. Use a config where two spots exceed a small target so the sort order decides which is kept:

```ts
import { selectSpots } from "../src/noise/spotSelection";
// ... existing imports ...

describe("selectSpots favorabilityBatch", () => {
  const key = { seed0: 123456, seed1: 100, regionX: 1, regionY: 1 };
  const base = {
    density: () => 1, // small target
    quantity: () => 1e6,
    regionSize: 1024,
    candidateSpotCount: 6,
    spacing: 45.254833995939045,
    skipSpan: 1,
    skipOffset: 0,
    hardRegionTargetQuantity: true as const,
  };
  it("uses the batched favorability for the trim sort (overrides per-spot)", () => {
    // Per-spot favorability that would keep the FIRST-accepted spot (all equal ->
    // acceptance order); a batch that flips it (descending index) keeps a LATER spot.
    const perSpot = selectSpots(key, { ...base, favorability: () => 0 });
    const batched = selectSpots(key, {
      ...base,
      favorability: () => 0,
      favorabilityBatch: (spots) => spots.map((_, i) => i), // last accepted = highest fav
    });
    expect(batched.length).toBeGreaterThan(0);
    // The batched run keeps the highest-index (last-accepted) spot first; assert its
    // top-kept position differs from the per-spot run's top-kept position.
    expect({ x: batched[0].x, y: batched[0].y }).not.toEqual({ x: perSpot[0].x, y: perSpot[0].y });
  });
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/spotSelection.spec.ts` -> FAIL (`favorabilityBatch` ignored, so `batched[0]` equals `perSpot[0]`).
- [ ] **Step 3: Implement** the `favorabilityBatch` option and swap the `coneScale` `Math.cbrt` -> `fastCbrt` (add the `import { fastCbrt } from "./fastApprox";`).
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/spotSelection.spec.ts`. Then run it in FULL to confirm the fastCbrt change did NOT regress the 55 game-captured configs: the whole file must stay green (fastCbrt is strictly closer to the game than exact cbrt; if any fixture now fails, that is a real finding - investigate, do not loosen).
- [ ] **Step 5: Commit** `feat(spot-noise): favorabilityBatch + fastapprox cone shrink`.

---

## Task 3: `makeStartingPatches` - the starting spot field (+ starting blob)

**Files:**
- Create: `src/noise/resources/startingPatches.ts`
- Test: `test/startingPatches.spec.ts` (structural unit tests; oracle validation is Task 5 via the combined field)

**Interfaces:**
- Consumes: `ResourceParams`, the Task 1 starting math, `selectSpots`/`SpotRegionKey`, `basisNoise`/`basisNoiseTablesFromSeed`, `randomPenaltyBatch`, `makeElevationLakes`, `distanceFromNearestPoint`, `basementValue`, `fastCbrt`.
- Produces: `makeStartingPatches(params: ResourceParams, ctx: StartingPatchesCtx): { field(x: number, y: number): number }` where

```ts
export interface StartingPatchesCtx {
  readonly seed0: number;
  readonly controls: { frequency: number; size: number; richness: number };
  readonly startingPositions?: readonly Point[];
  /** elevation_lakes inputs for the favorability coupling (spec risk #2). */
  readonly segmentationMultiplier?: number;
  readonly waterLevel?: number;
  readonly startingLakePositions?: readonly Point[];
  /** starting_patch_set_count (skip_span). 1 for the isolated oracle; 4 in the app. */
  readonly skipSpan?: number;
  /** starting_patch_set_index (skip_offset). */
  readonly skipOffset?: number;
}
```

Constants (module-local): `STARTING_REGION_SIZE = 240`, `STARTING_CANDIDATE_SPOT_COUNT = 32`, `STARTING_SPACING = 32`, `MAX_SPOT_BASEMENT_RADIUS = 128`. Region index uses `Math.floor((c + 240 / 2) / 240)`. The starting candidate stream uses `seed1 = params.seed1 + 1`; `blobs0` uses `params.seed1` (NOT +1).

Structure (mirror `makeRegularPatches`, with these differences):

1. Build `elevationLakes = makeElevationLakes({ seed0, waterLevel, segmentationMultiplier, startingPositions, startingLakePositions })` once.
2. Per region, `selectSpots(startingRegionKey, { ... })` with:
   - `density: (x, y) => startingDensityAt(distanceAt(x, y), params, controls)`
   - `quantity: () => startingAreaSpotQuantity(params, controls)` (constant, no batch)
   - `favorabilityBatch: (spots) => { const rp = randomPenaltyBatch(spots, spots.map(() => 0.5), { seed: 1, amplitude: 0.5 }); return spots.map((s, i) => startingFavorabilityBaseAt(distanceAt(s.x, s.y), elevationLakes(s.x, s.y), params, controls) + rp[i]); }`
     - `random_penalty_at(0.5, 1)` = `random_penalty{ source: 0.5, amplitude: 0.5, seed: 1 }`. `favorability` is still required by the type - pass `() => 0` (unused when `favorabilityBatch` is present).
   - `regionSize: STARTING_REGION_SIZE`, `candidateSpotCount: STARTING_CANDIDATE_SPOT_COUNT`, `spacing: STARTING_SPACING`, `skipSpan`, `skipOffset`, `hardRegionTargetQuantity: true`.
3. `spotFieldAt`: same cone render as regularPatches (f32, `fastCbrt`), but the radius is NOT capped at 32 (starting has no `min(32, ...)`), and the per-spot `coneScale` from the hard-target trim multiplies BOTH radius and peak:

```ts
const rBase = f32(params.startingRqFactor * fastCbrt(s.quantity)); // no min(32, ...)
const radius = f32(rBase * s.coneScale);
const peak = f32(f32(3 * s.quantity) / f32(f32(Math.PI * radius) * radius));
const cone = f32(peak - f32(f32(Math.sqrt(d2)) * f32(peak / radius)));
```

   (For a full spot `coneScale === 1`; for the last kept spot it is `fastCbrt(q2/q)`, so `s.quantity` is already the cut `q2` and `radius`/`peak` scale self-similarly - matching `placeSpots`.)
4. `blobTermAt`: `(blobs0 - 0.25) * startingBlobAmplitude(params, controls)` where `blobs0 = basisNoise(x/8, y/8, tables) + basisNoise(x/24, y/24, tables)` with `tables = basisNoiseTablesFromSeed(seed0, params.seed1)`. NO `basis_noise{1/64, 1.5}` term (that is regular-only).
5. `field = spotFieldAt + blobTermAt`, floored at `basementValue(params, controls)` inside `spotFieldAt` exactly like regular.

- [ ] **Step 1: Write the failing test** `test/startingPatches.spec.ts` - structural sanity (the oracle gate is Task 5). Assert: the field is finite; near spawn (origin region) at least one point rises well above the basement (a starting patch exists); and far out (`> 300` tiles) the field equals the pure blob-over-basement (no starting spots), i.e. below any patch peak:

```ts
import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeStartingPatches } from "../src/noise/resources/startingPatches";
import { basementValue } from "../src/noise/resources/resourceMath";

const iron = RESOURCE_CATALOG[0];

describe("makeStartingPatches", () => {
  const start = makeStartingPatches(iron, {
    seed0: 123456,
    controls: { frequency: 1, size: 1, richness: 1 },
    skipSpan: 1,
    skipOffset: 0,
  });
  it("produces a starting patch near spawn (field rises above basement)", () => {
    let maxNear = -Infinity;
    for (let y = -120; y <= 120; y += 4)
      for (let x = -120; x <= 120; x += 4) maxNear = Math.max(maxNear, start.field(x, y));
    // a real starting patch peaks in the hundreds+; basement is deeply negative.
    expect(maxNear).toBeGreaterThan(1);
  });
  it("is basement + blob only far from spawn (no starting spots past 120)", () => {
    // At 1000 tiles out, starting_modulation = 0 everywhere in-region -> no spots.
    // The field is then basement + blobTerm; well below any patch peak (< ~100).
    const far = start.field(1000, 1000);
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/startingPatches.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `startingPatches.ts` per the structure above.
- [ ] **Step 4: Run to verify it passes** - `pnpm vp test test/startingPatches.spec.ts`.
- [ ] **Step 5: Commit** `feat(resources): starting patch field (spot_noise + blob)`.

---

## Task 4: Oracle path for `all_patches` with starting (DE-RISK - before Task 5)

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureResourceStarting`), register in the CLI dispatch (`if (want("resource-starting")) await captureResourceStarting();`).
- Create fixture (generated): `test/fixtures/oracle-resource-starting.seed123456.json`

**Interfaces:**
- Produces: a committed fixture: for iron and copper (both `has_starting = true`, different `starting_rq_factor`) x a DENSE near-spawn grid (to catch the ~20-tile starting patches) plus a far ring (regular still validated), x seeds `123456` and `777771`, the game's `resource_autoplace_all_patches{...}` value with `has_starting_area_placement = 1`, `regular_patch_set_count = 1`/`index = 0`, `starting_patch_set_count = 1`/`index = 0`, `frequency_multiplier = size_multiplier = 1`, routed onto `elevation` via `sampleExpression`.

Rationale: `has_starting_area_placement = 1` makes `all_patches = max(starting, regular)`; both set counts `= 1` give unpartitioned starting AND regular sets (this resource takes every accepted spot in each). Near spawn the starting term dominates; the far ring keeps the regular branch covered. This is the cleanest ground truth for the combined field and pins the `elevation_lakes` favorability coupling (spec risk #2).

Model it on `captureResourceRegular` (same `Probe` shape + `buildExpr`), changing only `has_starting_area_placement = 1` and the grid. Grid:

```ts
// Dense near-spawn block: +/-240 at stride 8 catches the ~20-tile starting patches
// AND the regular fade-in ring (120..420). Starting patches live within ~120-240.
const positions: Position[] = [];
for (let y = -240; y <= 240; y += 8)
  for (let x = -240; x <= 240; x += 8) positions.push({ x: x + 0.5, y: y + 0.25 });
// A far ring (regular-only region) so the regular branch stays covered.
for (const r of [1500, 2500]) {
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
  }
}
```

- [ ] **Step 1: Implement** `captureResourceStarting` (iron + copper probes; `has_starting_area_placement = 1`; both set counts 1; the grid above; seeds `[123456, 777771]`). Fixture `_comment` must state has_starting=1 and both counts=1, and the regenerate command. Write to `test/fixtures/oracle-resource-starting.seed123456.json`.
- [ ] **Step 2: Regenerate** - `node --experimental-strip-types test/oracle/capture.ts resource-starting` (needs `FACTORIO_BIN`; the binary path is in docs/noise/M3-session-handoff.md "Ground truth"). Verify the fixture is written, values are finite, and the near-spawn block shows patch-scale values (hundreds+) distinct from the deep basement.
  - If no local Factorio is available in the execution environment, STOP and hand back to Eric with the exact command to run - do NOT hand-author the fixture (it is read-only ground truth).
- [ ] **Step 3: Commit** `test(resources): starting-patches (has_starting=1) oracle fixture`.

---

## Task 5: `makeResourcePatches` - the outer `max(starting, regular)` (the core)

**Files:**
- Create: `src/noise/resources/resourcePatches.ts`
- Test: `test/resourcePatches.spec.ts` (validates against the Task 4 fixture)

**Interfaces:**
- Consumes: `makeRegularPatches` (M3a), `makeStartingPatches` (T3), `ResourceParams`, `richnessDistanceFactor` math (inline as in regularPatches).
- Produces: `makeResourcePatches(params: ResourceParams, ctx: ResourcePatchesCtx): { field(x,y): number; probability(x,y): number; richness(x,y): number }` where

```ts
export interface ResourcePatchesCtx {
  readonly seed0: number;
  readonly controls: { frequency: number; size: number; richness: number };
  readonly startingPositions?: readonly Point[];
  /** elevation_lakes inputs for the starting favorability (only used by solids). */
  readonly segmentationMultiplier?: number;
  readonly waterLevel?: number;
  readonly startingLakePositions?: readonly Point[];
  /** regular set skip params (span/offset). 1/0 for the isolated oracle; 6/index in the app. */
  readonly regularSkipSpan?: number;
  readonly regularSkipOffset?: number;
  /** starting set skip params. 1/0 for the isolated oracle; 4/index in the app. */
  readonly startingSkipSpan?: number;
  readonly startingSkipOffset?: number;
}
```

Behavior:
- Always build `regular = makeRegularPatches(params, { seed0, controls, startingPositions, skipSpan: regularSkipSpan ?? 1, skipOffset: regularSkipOffset ?? 0 })`.
- **Oil/uranium (`hasStartingAreaPlacement === false`): delegate unchanged** - `return makeRegularPatches(params, { seed0, controls, startingPositions, skipSpan: regularSkipSpan ?? 1, skipOffset: regularSkipOffset ?? 0 })` verbatim. No starting field, no behavior change. This keeps the deferred oil items (the `random_probability` probability factor, the M3.5 stipple) exactly as they are - M3b does NOT touch them.
- **Solids (`hasStartingAreaPlacement === true`): add the `max`.** Build `starting = makeStartingPatches(...)`, and expose `field(x,y) = Math.max(starting.field(x,y), regular.field(x,y))`. The four solids all have `randomProbability === 1`, `additionalRichness === 0`, `minimumRichness === 0`, so the probability/richness wrappers are trivial: `probability = controls.size > 0 ? clamp(field, 0, 1) : 0`, and `richness = controls.size > 0 ? richnessPostMultiplier * controls.richness * field * richnessDistanceFactor(distance) : 0`. (`richnessDistanceFactor` is the same expression as in `regularPatches.ts` - the fade-in-adjusted `max((1000 + distance)/2600, 1)`.)

DRY: the solid probability/richness wrappers duplicate a few lines from `regularPatches.ts`. Since the solid case has all-trivial wrapper params (rp=1, add=0, min=0), the duplication is 2-3 lines, not the full oil-bearing wrapper - do NOT extract a shared helper for that (YAGNI); keep the solid path self-contained and let oil/uranium delegate to `makeRegularPatches` which already owns the general wrapper math. If a later change makes a starting resource carry `randomProbability < 1` or `additional_richness > 0`, revisit.

- [ ] **Step 1: Write the failing test** `test/resourcePatches.spec.ts`, iterating the Task 4 fixture (mirror `test/regularPatches.spec.ts` exactly - same `relErr`, same `ABS_TOL = 1.0` / `REL_TOL = 1e-2`, same mismatch dump). Build `makeResourcePatches(params, { seed0: c.seed, controls: {1,1,1}, regularSkipSpan: 1, regularSkipOffset: 0, startingSkipSpan: 1, startingSkipOffset: 0 })` and compare `field(x,y)` to the fixture value at each position:

```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-resource-starting.seed123456.json";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeResourcePatches } from "../src/noise/resources/resourcePatches";

const paramsByName = new Map(RESOURCE_CATALOG.map((r) => [r.name, r]));
const relErr = (port: number, game: number) => Math.abs(port - game) / Math.max(1, Math.abs(game));
const ABS_TOL = 1.0;
const REL_TOL = 1e-2;

describe("makeResourcePatches (all_patches = max(starting, regular) vs oracle)", () => {
  for (const c of fixture.cases) {
    it(`matches the game for ${c.resource} seed=${c.seed}`, () => {
      const params = paramsByName.get(c.resource)!;
      const patches = makeResourcePatches(params, {
        seed0: c.seed,
        controls: { frequency: 1, size: 1, richness: 1 },
        regularSkipSpan: 1,
        regularSkipOffset: 0,
        startingSkipSpan: 1,
        startingSkipOffset: 0,
      });
      let worstAbs = 0;
      let worstRel = 0;
      const mism: { x: number; y: number; game: number; port: number; abs: number; rel: number }[] = [];
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const game = c.values[i];
        const port = patches.field(p.x, p.y);
        const abs = Math.abs(port - game);
        const rel = relErr(port, game);
        if (abs > worstAbs) worstAbs = abs;
        if (rel > worstRel) worstRel = rel;
        mism.push({ x: p.x, y: p.y, game, port, abs, rel });
      }
      if (worstAbs >= ABS_TOL || worstRel >= REL_TOL) {
        const top = [...mism].sort((a, b) => b.abs - a.abs).slice(0, 12)
          .map((m) => `  (${m.x},${m.y}) game=${m.game.toFixed(2)} port=${m.port.toFixed(2)} abs=${m.abs.toFixed(3)} rel=${m.rel.toExponential(2)}`)
          .join("\n");
        throw new Error(`${c.resource} seed=${c.seed}: worstAbs=${worstAbs.toFixed(3)} worstRel=${worstRel.toExponential(3)}\n${top}`);
      }
      expect(worstAbs).toBeLessThan(ABS_TOL);
      expect(worstRel).toBeLessThan(REL_TOL);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/resourcePatches.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement** `resourcePatches.ts`.
- [ ] **Step 4: Run against the oracle.** `pnpm vp test test/resourcePatches.spec.ts`. This is where spec risk #2 (elevation_lakes coupling) resolves. If the near-spawn points miss (the far ring passes but the near block does not), the failure is in the starting field. Debug in this order, using the mismatch dump:
  1. **Which spots render?** If the port keeps a DIFFERENT set of starting spots than the game (whole patches present/absent vs the oracle), the favorability sort differs -> the `elevation_lakes` coupling or the `random_penalty_at(0.5,1)` batch is wrong. Confirm the port feeds the literal `makeElevationLakes` (not the active map-type elevation) - this is the pin the spec demanded. If elevation_lakes near spawn is itself off (M1's near-spawn fidelity caveat), check `startingLakePositions` is being computed (default path) and matches the map; note the residual regime if it is the known f32 floor.
  2. **Right spots, wrong height?** A uniform scale on a kept patch -> `startingSpotRadius`/`startingAreaSpotQuantity`/`startingBlobAmplitude` arithmetic, or the hard-target `coneScale` (last spot) - check the `fastCbrt` shrink from Task 2.
  3. **Basement off?** Points on the pure basement should match to < 1e-3 (already validated by M3a); if not, `basementValue` regressed.
  Do NOT loosen the tolerance. Record the resolved batch/coupling facts.
- [ ] **Step 5: Run the FULL suite** `pnpm vp test` (nothing else regressed) and `pnpm vp check --fix`.
- [ ] **Step 6: Commit** `feat(resources): all_patches = max(starting, regular), oracle-validated`.

---

## Task 6: Resolver + render pipeline wiring

**Files:**
- Modify: `src/noise/resources/resolveResource.ts` (build `makeResourcePatches`; thread the elevation-lakes ctx + starting skip params).
- Modify: `src/noise/preview/renderResources.ts` (accept + forward the elevation-lakes ctx).
- Modify: `src/noise/preview/elevationRenderRequest.ts` (forward `segmentationMultiplier`/`waterLevel`/`startingLakePositions` - already on the request - into `renderResources`).
- Test: `test/resolveResource.spec.ts` (extend), `test/renderResources.spec.ts` (extend).

**Interfaces:**
- `ResourceResolverCtx` gains `segmentationMultiplier?`, `waterLevel?`, `startingLakePositions?` (forwarded to `makeResourcePatches`). Each catalog resource is built with `makeResourcePatches(params, { seed0, controls: levers, startingPositions, segmentationMultiplier, waterLevel, startingLakePositions, regularSkipSpan: 6, regularSkipOffset: params.patchSetIndex, startingSkipSpan: 4, startingSkipOffset: params.patchSetIndex })`.
  - Note: `startingSkipOffset = params.patchSetIndex` is correct for the four solids (their starting index equals their regular `patchSetIndex`, since iron/copper/coal/stone register first). oil/uranium have `hasStartingAreaPlacement = false`, so `makeResourcePatches` ignores the starting skip params for them.
- `RenderResourcesOptions` gains `segmentationMultiplier?`, `waterLevel?`, `startingLakePositions?`, forwarded into `makeResourceResolver`.
- `runRenderRequest` passes `segmentationMultiplier: req.segmentationMultiplier`, `waterLevel: req.waterLevel`, `startingLakePositions: req.startingLakePositions` into `renderResources`.

- [ ] **Step 1: Write the failing test.** In `test/resolveResource.spec.ts` add a case that a solid resource's field now reflects a starting patch near spawn: build `makeResourceResolver({ seed0: 123456, controls: { "iron-ore": { frequency:1, size:1, richness:1 } } })` and assert `resolve(x,y)` returns iron at some near-spawn tile inside iron's guaranteed starting patch (pick a tile from the Task 4 fixture where iron's field >= 0.5 - the fixture is committed, so read a known-present coordinate). In `test/renderResources.spec.ts` assert the elevation-lakes ctx is forwarded (e.g. a stubbed resolver factory receives `segmentationMultiplier`), or extend the existing overlay test to include a near-spawn pixel that paints iron.
  - Keep the existing `pickWinner`/order-priority tests unchanged - they still pass.
- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/resolveResource.spec.ts test/renderResources.spec.ts`.
- [ ] **Step 3: Implement** the ctx threading in all three files.
- [ ] **Step 4: Run to verify it passes**, then the FULL suite `pnpm vp test` and `pnpm vp check --fix`.
- [ ] **Step 5: Commit** `feat(resources): thread starting-patch ctx through resolver + render`.

---

## Task 7: Manual eyeball + docs

- [ ] **Headless render check.** Write a throwaway spec under the scratchpad (NOT committed) that calls `runRenderRequest({ view: "resources", seed0: 123456, width: 512, height: 512, originX: -256, originY: -256, tilesPerPixel: 1, waterLevel: 0, segmentationMultiplier: 1, startingPositions: [{x:0,y:0}], mapType: "nauvis", resourceControls: {} })` and writes a PNG (reuse the minimal zlib PNG encoder pattern from the M3a eyeball). Confirm: guaranteed iron/copper/coal/stone patches cluster at spawn (the starting patches), regular patches appear farther out, and spawn is not bare. Send the PNG to Eric.
- [ ] **In-app eyeball (Eric).** `pnpm vp dev` -> Terrain tab -> Nauvis -> Preview -> Resources toggle -> Generate. Confirm the near-spawn guaranteed patches render and the sliders shift them. (Eric's to run.)
- [ ] **Docs.** Update `docs/noise/client-preview-ROADMAP.md` (M3b done), `docs/noise/M3-session-handoff.md` (M3b complete; what's left = M3.5 stipple), `docs/noise/random-penalty-NOTES.md` and/or `docs/noise/spot-noise-NOTES.md` (record the resolved starting-favorability `elevation_lakes` coupling + `random_penalty_at(0.5,1)` batch semantics from Task 5, and the `favorabilityBatch` + fastCbrt-coneScale primitive changes from Task 2). Update the Claude memory `m3-resources-kicked-off.md` (M3b complete).
- [ ] **Commit** `docs(resources): M3b starting patches done`.

## Self-review notes

- **Spec coverage** (docs/superpowers/specs/2026-07-19-milestone3-resources-design.md, M3b scope):
  - `starting_patches` (region_size 240, skip_span 4, iron/copper/coal/stone, starting_rq/quantity/blob) -> Tasks 1, 3.
  - Outer `max(starting, regular)` when `has_starting_area_placement == 1`; oil/uranium regular-only -> Task 5.
  - `has_starting=1` oracle fixture + point-by-point validation -> Tasks 4, 5.
  - Spec risk #2 (`elevation_lakes` literal vs active elevation) -> pinned in Task 5 Step 4 (port feeds `makeElevationLakes`; confirmed against the oracle).
  - Reuse solved primitives (selectSpots, basisNoise, randomPenalty, fastCbrt, makeElevationLakes) -> Global Constraints; no re-derivation.
- **Primitive changes needed by starting patches** (not in the M3a spec, discovered from the game source): `favorabilityBatch` on `selectSpots` and the fastapprox `coneScale` shrink -> Task 2, with the 55-config fixture re-verified.
- **Type consistency:** `field`/`probability`/`richness` returned by `makeResourcePatches` match `makeRegularPatches`' shape; `StartingPatchesCtx`/`ResourcePatchesCtx`/`ResourceResolverCtx` all carry the same `segmentationMultiplier`/`waterLevel`/`startingLakePositions` triple; `startingSkipOffset === patchSetIndex` justified for the four solids.
- **Out of scope:** per-tile stipple (M3.5); ore-on-cliffs exclusion (M4, blocked on cliff render). Deferred oil sub-items (the `1/random_probability` probability factor; patch-look stipple) remain deferred per the ROADMAP.
- **Not-in-CI:** Task 4 Step 2 needs a local Factorio; if absent, hand back to Eric rather than fabricate the fixture.

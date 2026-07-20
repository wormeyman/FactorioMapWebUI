# M3a - Regular resource patches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the whole-map (regular) resource patches for all 6 Nauvis resources as a client-side overlay on the terrain preview, oracle-validated on probability + richness, driven by the existing control:<res>:frequency/size/richness sliders.

**Architecture:** Hand-port `resource_autoplace_all_patches` (the `regular_patches` branch) as a parameterized factory over the already-solved `selectSpots` (spot selection), `basisNoise` (blob noise), and `randomPenalty` (spot-quantity jitter) primitives. Each resource is the same helper fed a param set. The overlay composites onto the terrain ImageData in a single worker pass. Starting patches and the outer `max(starting, regular)` are M3b.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Pinia, vite-plus test. Headless Factorio 2.1.11 oracle (`test/oracle/`).

## Global Constraints

- **Oracle parity is a hard invariant.** Ported expressions match the game to the noise floor (~1e-5). NEVER loosen a tolerance to pass; a mismatch is a real finding. Oracle fixtures are read-only ground truth - never hand-author or edit them.
- **`src/**` imports are EXTENSIONLESS.** Tests import from `"vite-plus/test"`. `test/oracle/*.ts` import oracle helpers WITH a `.ts` extension.
- **Reuse the solved primitives**: `src/noise/spotSelection.ts` (`selectSpots`), `src/noise/spotCandidates.ts` (`SpotRegionKey`), `src/noise/basisNoise.ts`, `src/noise/randomPenalty.ts`, `src/noise/taus88.ts`. Do not re-derive.
- **No tsc/vue-tsc gate.** `vp check` is lint+format only; verify by running tests, not by trusting LSP diagnostics.
- **Commit footer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01NngW21ZycpKuMnSwftwJs6`. Hyphens, never em/en dashes. Work on branch `feat/m3-resources`.
- **Node 24.18.0**, run everything through pnpm (`pnpm vp test`, `pnpm vp test test/<f>.spec.ts`, `pnpm vp check --fix`).

## File structure

- `src/noise/resources/resourceCatalog.ts` - the 6 param sets + map_color + order + control name.
- `src/noise/resources/resourceMath.ts` - the distance/amplitude local functions (pure, no RNG).
- `src/noise/resources/regularPatches.ts` - `makeRegularPatches(params, ctx)` -> `{ probability, richness }`, the spot field + blob term + wrappers.
- `src/noise/resources/resolveResource.ts` - order-priority winner among `probability >= 0.5`.
- `src/noise/preview/renderResources.ts` - overlay winners onto a terrain ImageData.
- `src/model/resourceReads.ts` - read `control:<res>:frequency|size|richness` from a preset.
- `test/oracle/oracle.ts` + `capture.ts` - add `captureResourceRegular` (probe with `has_starting_area_placement = 0`, `regular_patch_set_count = 1` -> pure, unpartitioned regular field).
- Wiring: `src/noise/preview/elevationRenderRequest.ts` (add `view:"resources"` + resource control fields), `.../elevationRender.worker.ts` (unchanged - dispatches via runRenderRequest), `src/model/elevationPreviewCtx.ts` (add resource reads), `src/components/ElevationPreviewPanel.vue` (Resources toggle).

---

## Task 1: Resource catalog

**Files:**
- Create: `src/noise/resources/resourceCatalog.ts`
- Test: `test/resourceCatalog.spec.ts`

**Interfaces:**
- Produces: `interface ResourceParams { name: string; controlName: string; order: "b" | "c"; patchSetIndex: number; baseDensity: number; baseSpotsPerKm2: number; candidateSpotCount: number; regularRqFactor: number; seed1: number; randomProbability: number; randomSpotSizeMin: number; randomSpotSizeMax: number; additionalRichness: number; minimumRichness: number; richnessPostMultiplier: number; hasStartingAreaPlacement: boolean; mapColor: readonly [number, number, number]; }` and `const RESOURCE_CATALOG: readonly ResourceParams[]` (6 entries, in patch-set init order iron..uranium).

Values copied verbatim from `~/Downloads/factorio 4/data/base/prototypes/entity/resources.lua` + the defaults in `resource-autoplace.lua`. Note the Lua math baked into the params: `regularRqFactor = regular_rq_factor_multiplier / 10`; `baseSpotsPerKm2` default 2.5; `candidateSpotCount` default 21; `seed1` default 100; `randomProbability` default 1; `randomSpotSizeMin/Max` default 0.25/2; `additionalRichness`/`minimumRichness` default 0; `richnessPostMultiplier` default 1. map_color scaled to 0-255 and rounded.

- [ ] **Step 1: Write the failing test** `test/resourceCatalog.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";

describe("RESOURCE_CATALOG", () => {
  it("has the 6 Nauvis resources in patch-set init order", () => {
    expect(RESOURCE_CATALOG.map((r) => r.name)).toEqual([
      "iron-ore", "copper-ore", "coal", "stone", "crude-oil", "uranium-ore",
    ]);
    RESOURCE_CATALOG.forEach((r, i) => expect(r.patchSetIndex).toBe(i));
  });

  it("carries iron's params from resources.lua", () => {
    const iron = RESOURCE_CATALOG[0];
    expect(iron).toMatchObject({
      baseDensity: 10, candidateSpotCount: 22, regularRqFactor: 1.1 / 10,
      baseSpotsPerKm2: 2.5, seed1: 100, order: "b", randomProbability: 1,
      hasStartingAreaPlacement: true, mapColor: [106, 134, 148],
    });
  });

  it("carries the oil/uranium specials", () => {
    const oil = RESOURCE_CATALOG.find((r) => r.name === "crude-oil")!;
    expect(oil).toMatchObject({
      order: "c", baseDensity: 8.2, baseSpotsPerKm2: 1.8, randomProbability: 1 / 48,
      additionalRichness: 220000, randomSpotSizeMin: 1, randomSpotSizeMax: 1,
      hasStartingAreaPlacement: false, mapColor: [199, 51, 196],
    });
    const u = RESOURCE_CATALOG.find((r) => r.name === "uranium-ore")!;
    expect(u).toMatchObject({
      order: "c", baseDensity: 0.9, baseSpotsPerKm2: 1.25,
      randomSpotSizeMin: 2, randomSpotSizeMax: 4, hasStartingAreaPlacement: false,
      mapColor: [0, 179, 0],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails** - `pnpm vp test test/resourceCatalog.spec.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement `resourceCatalog.ts`** with the `ResourceParams` interface and the 6-entry `RESOURCE_CATALOG` array, values as above. map_color: iron [106,134,148], copper [205,99,55], coal [0,0,0], stone [176,156,109], crude-oil [199,51,196], uranium [0,179,0] (round(channel*255)).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(resources): resource catalog (6 Nauvis param sets)`.

---

## Task 2: Distance/amplitude math (the local functions)

**Files:**
- Create: `src/noise/resources/resourceMath.ts`
- Test: `test/resourceMath.spec.ts`

**Interfaces:**
- Consumes: `ResourceParams` (Task 1).
- Produces: pure functions of `(distance, params, controls)` where `controls = { frequency: number; size: number }` (the frequency_multiplier / size_multiplier):
  - `regularDensityAt(distance, params, controls): number`
  - `regularSpotQuantityBaseAt(distance, params, controls): number`
  - `regularSpotHeightTypicalAt(distance, params, controls): number`
  - `regularBlobAmplitudeAt(distance, params, controls): number`
  - `basementValue(params, controls): number`
  - constants `DOUBLE_DENSITY_DISTANCE = 1300`, `REGULAR_PATCH_FADE_IN_DISTANCE = 300`, `STARTING_RESOURCE_PLACEMENT_RADIUS = 120`.

Port verbatim from `resource_autoplace_all_patches.local_functions` / `local_expressions` in `~/Downloads/factorio 4/data/core/prototypes/noise-functions.lua`. For a regular-only resource (`has_starting_area_placement != 1`), `size_effective_distance_at(d) = d` and the fade-in clamp uses `has_starting == -1` branch; for `has_starting == true` resources rendered as regular-only in M3a, use their real `has_starting` sign (they are `true`, so `size_effective_distance_at(d) = d - 300`, `regular_density_at` multiplies by `clamp((d-120)/300,0,1)`, and `regular_blob_amplitude_maximum_distance = 1300 + 300`). `basement_value = -6 * regular_blob_amplitude_at(regular_blob_amplitude_maximum_distance)` for M3a (regular-only; the starting term drops out).

- [ ] **Step 1: Write the failing test** with hand-computed expectations for iron at distances 0, 500, 2000 (compute the Lua by hand in the test comments), and uranium (has_starting=false path). Assert `toBeCloseTo(expected, 6)`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement `resourceMath.ts`.**
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(resources): distance/amplitude local functions`.

---

## Task 3: Oracle path for the pure regular field (DE-RISK - do this before Task 4)

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureResourceRegular`), register in the dispatch.
- Create fixture (generated): `test/fixtures/oracle-resource-regular.seed123456.json`

**Interfaces:**
- Produces: a committed fixture: for each of a few resources x a grid of positions (near-spawn AND far, to exercise the distance terms) x seeds (incl. an odd seed), the game's `resource_autoplace_all_patches{...}` value with `has_starting_area_placement = 0`, `regular_patch_set_count = 1`, `regular_patch_set_index = 0`, `frequency_multiplier = 1`, `size_multiplier = 1`, and the resource's real base_density/rq/seed1/candidate_spot_count. Routed onto `elevation`, sampled via `sampleExpression`.

Rationale: `has_starting_area_placement = 0` makes `all_patches = regular_patches` (the `if(==1, max, regular)` picks regular), and `regular_patch_set_count = 1` gives skip_span 1 (this resource takes every accepted spot, unpartitioned) - the cleanest possible ground truth for the regular field. Inlining `frequency_multiplier`/`size_multiplier` as literals removes the control-var dependency.

- [ ] **Step 1:** Write `captureResourceRegular` building the probe string per resource (iron, coal, uranium as a representative spread: has_starting true/true/false, different densities). Grid: a near-spawn cluster (±200) and a far ring (~1500-2500) so distance fade-in + double-density are exercised. Seeds: 123456 and one odd (e.g. 777771).
- [ ] **Step 2:** Run `node --experimental-strip-types test/oracle/capture.ts resource-regular`. Verify the fixture is written and values are finite and vary across the grid.
- [ ] **Step 3: Commit** `test(resources): pure-regular resource field oracle fixture`.

---

## Task 4: `makeRegularPatches` - the spot field + blob term (the core)

**Files:**
- Create: `src/noise/resources/regularPatches.ts`
- Test: `test/regularPatches.spec.ts` (validates against Task 3's fixture)

**Interfaces:**
- Consumes: `ResourceParams` (T1), `resourceMath` (T2), `selectSpots`/`SpotRegionKey` (spotSelection/spotCandidates), `basisNoise` + `basisNoiseTablesFromSeed`, `randomPenaltyBatch` (randomPenalty), the elevation `distance` (= Euclidean from origin, to be confirmed in Step 2).
- Produces: `makeRegularPatches(params: ResourceParams, ctx: { seed0: number; frequency: number; size: number }): { probability(x, y): number; richness(x, y): number }`.

The field, per `regular_patches` in noise-functions.lua:

```
spotField(x,y) = max over spots in the (region_size=1024) regions overlapping (x,y) of
                 cone(spot, x, y)   floored at basement_value       // spot-noise field render
regular_patches = spotField + (blobs0 + basis_noise{seed0,seed1,1/64,1.5} - 1/3) * regular_blob_amplitude_at(distance)
blobs0 = basis_noise{seed0,seed1,1/8,1} + basis_noise{seed0,seed1,1/24,1}
probability = clamp(regular_patches, 0, 1)   [* random_penalty{amplitude=1/random_probability} if random_probability<1]
richness    = post_mult * control_richness * (regular_patches [/random_probability] [+additional_richness] [max minimum_richness]) * richness_distance_factor
```

Spot selection uses `selectSpots` with `density = regularDensityAt(dist)`, `quantity = regularSpotQuantityExpression(x,y)`, `favorability = 1`, `spacing = 45.254833995939045`, `candidateSpotCount = params.candidateSpotCount`, `regionSize = 1024`, `skipSpan/skipOffset` from the patch set (M3a: for the pure-regular oracle, count=1/offset=0; for the app render, count=6/offset=patchSetIndex). The cone: `radius = min(32, regularRqFactor * quantity^(1/3))`, `peak = 3*quantity/(pi*radius^2)`, `slope = peak/radius`, `cone = peak - dist*slope`, combined by max over basement, culled at `maximum_spot_basement_radius = 128` (see docs/noise/spot-noise-NOTES.md "Field rendering").

**The one empirical unknown (resolve here against Task 3's oracle):** `regularSpotQuantityExpression = random_penalty_between(random_spot_size_min, random_spot_size_max, seed=1) * regularSpotQuantityBaseAt(dist)`. `random_penalty` is a BATCH op (docs/noise/random-penalty-NOTES.md) - its value at a spot depends on the batch + order the game evaluates spot quantities in. **Primary hypothesis to implement first:** each spot's quantity is evaluated independently (singleton batch), so `U = randomPenaltyBatch([spot], [source], {seed:1, amplitude})[0]` - i.e. seed from the spot's own (x,y), draw 0. This fits `selectSpots`' existing per-spot `quantity(x,y)` closure. If Step 4's oracle diff is large, the residual pattern (does a region's spots share one stream in acceptance order?) tells us the real batch; fall back to evaluating all region spots as one ordered `randomPenaltyBatch` and threading the resulting per-spot quantities into a `selectSpots` variant that accepts precomputed quantities. Document whichever wins in random-penalty-NOTES.md.

- [ ] **Step 1: Write the failing test** iterating Task 3's fixture: build `makeRegularPatches(params, {seed0, frequency:1, size:1})` for each fixture resource, compare `regular_patches` (the raw field, before clamp) at each fixture position to the fixture value. Assert `worst < 1e-4` (the field magnitude is larger than the ~1 climate fields; tighten toward 1e-5 if achievable). Expose the raw field via a test-only `field(x,y)` or validate `probability`/`richness` reconstructions of the raw value.
- [ ] **Step 2: Confirm `distance`** - add one assertion that the render matches the oracle at an off-axis far point (e.g. (1500,-1200)); if the whole grid is off by a distance-shaped factor, `distance` is not Euclidean-from-origin - adjust (see spec risk 3) and note it.
- [ ] **Step 3: Run to verify it fails.**
- [ ] **Step 4: Implement `regularPatches.ts`** with the primary random_penalty hypothesis. Region iteration: a query (x,y) is covered by the regions whose centre-band (`region_index = floor((c + 512)/1024)`) is within `maximum_spot_basement_radius` (128) of the query - iterate the up-to-4 regions around (x,y). Memoize each region's selected spots (a `Map` keyed by `${regionX},${regionY}`) so adjacent pixels reuse it.
- [ ] **Step 5: Run against the oracle; iterate on the random_penalty batch semantics until `worst < 1e-4`.** If the singleton hypothesis is refuted, implement the batch fallback (above) and re-run. Do NOT loosen the tolerance.
- [ ] **Step 6: Commit** `feat(resources): regular patch field (spot_noise + blobs), oracle-validated`.

---

## Task 5: `resolveResource` - order-priority overlay winner

**Files:**
- Create: `src/noise/resources/resolveResource.ts`
- Test: `test/resolveResource.spec.ts`

**Interfaces:**
- Consumes: `RESOURCE_CATALOG` (T1), `makeRegularPatches` (T4).
- Produces: `makeResourceResolver(ctx: { seed0: number; controls: Record<string, { frequency: number; size: number; richness: number }> }): (x, y) => ResourceParams | null` - builds a `makeRegularPatches` per resource whose `size > 0`, and returns the order-priority winner among resources with `probability(x,y) >= 0.5` (order "b" before "c"; within an order, lower `patchSetIndex` first), else `null`.

- [ ] **Step 1: Write the failing test** with a stub of two fake resources at a point where both exceed 0.5, asserting the "b" one wins; and a point below 0.5 for all -> null. (Use a small injected resolver-of-fields to keep it deterministic, or assert against a known fixture point from Task 3 where a specific resource is present.)
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement `resolveResource.ts`.**
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `feat(resources): order-priority overlay resolver`.

---

## Task 6: `resourceReads` - controls from the preset

**Files:**
- Create: `src/model/resourceReads.ts`
- Test: `test/resourceReads.spec.ts`

**Interfaces:**
- Consumes: `Preset` (`autoplaceControls: Record<string, AutoplaceSetting>` keyed by control name, each `{ frequency, size, richness }`), `RESOURCE_CATALOG`.
- Produces: `readResourceControls(preset): Record<string, { frequency: number; size: number; richness: number }>` - one entry per catalog resource, reading `preset.autoplaceControls[controlName]`, defaulting missing controls to `{ frequency: 1, size: 1, richness: 1 }`.

- [ ] **Step 1: Write the failing test** (a preset with iron freq/size/richness set, coal absent -> defaults). **Step 2:** fail. **Step 3:** implement. **Step 4:** pass. **Step 5: Commit** `feat(resources): read control levers from preset`.

---

## Task 7: `renderResources` - composite overlay

**Files:**
- Create: `src/noise/preview/renderResources.ts`
- Test: `test/renderResources.spec.ts`

**Interfaces:**
- Consumes: `makeResourceResolver` (T5).
- Produces: `renderResources(base: ImageData, opts: { seed0, width, height, originX, originY, tilesPerPixel, controls, ctx }): void` - mutates `base` in place, painting `winner.mapColor` opaque where a winner exists, leaving terrain elsewhere. Sweeps the same pixel grid as `renderTerrain`.

- [ ] **Step 1: Write the failing test** - a tiny 4x4 base filled grey, a stubbed resolver returning iron at one pixel; assert that pixel is iron's color and others are grey. **Step 2:** fail. **Step 3:** implement (loop py/px, world coord = origin + p*tpp, resolve, write RGBA). **Step 4:** pass. **Step 5: Commit** `feat(resources): overlay renderer`.

---

## Task 8: Worker request wiring (`view: "resources"`)

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (add `view: "resources"` to the union; add resource control fields `resourceControls?: Record<string, {frequency;size;richness}>`; in `runRenderRequest`, the `"resources"` branch runs `renderTerrain` then `renderResources` on the result buffer).
- Test: `test/elevationRenderRequest.spec.ts` (extend) - a `view:"resources"` request returns a buffer that differs from the plain terrain buffer only where resources are present.

**Interfaces:**
- Consumes: `renderTerrain` (existing), `renderResources` (T7).

- [ ] **Step 1: Write the failing test.** **Step 2:** fail. **Step 3:** implement the `"resources"` branch (build the terrain ImageData, wrap its buffer as ImageData, call renderResources, return). **Step 4:** pass. **Step 5:** run the FULL suite `pnpm vp test`. **Step 6: Commit** `feat(resources): resources render view in the worker request`.

---

## Task 9: UI - Resources toggle + ctx wiring

**Files:**
- Modify: `src/model/elevationPreviewCtx.ts` (add `resourceControls` to the ctx via `readResourceControls`).
- Modify: `src/components/ElevationPreviewPanel.vue` (add a third toggle button `Resources`, `data-test="view-resources"`, gated on `terrainAvailable` (nauvis) like Terrain; pass `resourceControls` in the render request; extend the `view` ref union to include `"resources"`).
- Test: `test/ElevationPreviewPanel.spec.ts` (extend, if it exists) or a new component test asserting the Resources button is present, disabled off-nauvis, and that clicking it + Generate sends `view:"resources"` with `resourceControls`.

- [ ] **Step 1: Write the failing test** (inject a fake renderer, assert the request `view` and `resourceControls`). **Step 2:** fail. **Step 3:** implement the toggle + ctx wiring. **Step 4:** pass. **Step 5:** full suite + `pnpm vp check --fix`. **Step 6: Commit** `feat(resources): Resources view toggle on the preview panel`.

---

## Task 10: Manual eyeball + notes

- [ ] Run `pnpm vp dev`, open the app, Terrain tab -> Nauvis -> Preview -> Resources toggle -> Generate. Confirm ore patches appear over the terrain, near-spawn clustering is visible, and the frequency/size/richness sliders shift them.
- [ ] Update `docs/noise/client-preview-ROADMAP.md` (M3 regular-patches done) and `docs/noise/random-penalty-NOTES.md` (record the resolved spot-quantity batch semantics from Task 4).
- [ ] Commit `docs(resources): M3a regular patches done`.

## Self-review notes

- Spec coverage: catalog (T1), all_patches regular port + validation (T2-4), order-priority overlap (T5), controls (T6), render (T7), worker (T8), UI (T9), eyeball (T10). Starting patches + `max(starting,regular)` are M3b (out of scope here). Per-tile stipple is M3.5.
- The single real risk (random_penalty batch semantics in spot selection) is isolated to Task 4 and gated by the Task 3 oracle - it cannot silently pass wrong.
- Open item carried to M3b: the `distance` origin/offset (Task 4 Step 2) and the `elevation_lakes` starting-favorability coupling.

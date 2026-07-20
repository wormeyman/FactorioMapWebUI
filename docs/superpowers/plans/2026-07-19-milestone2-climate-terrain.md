# Milestone 2 - Climate Terrain Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Factorio's Nauvis terrain colors (grass/dirt/sand/red-desert + water) client-side by porting the default climate expressions, reverse-engineering the native `expression_in_range`, resolving the 21-tile autoplace argmax, and painting `map_color`.

**Architecture:** Hand-ported TypeScript closures over the already-solved noise primitives (like the elevation trees), validated against the headless-Factorio oracle. Layers: shared Nauvis noise internals (refactored out of the elevation port) -> climate (temperature/moisture/aux) -> tile helpers (incl. RE'd `expression_in_range`) -> tile resolver (argmax) + palette -> terrain render path + UI toggle.

**Tech Stack:** TypeScript, Vue 3, Vitest-compatible (`vite-plus/test`), Web Worker render, headless Factorio oracle (`test/oracle/`).

**Design spec:** `docs/superpowers/specs/2026-07-19-milestone2-climate-terrain-design.md` (read for the verbatim game expressions and the full 21-tile table).

## Global Constraints

- Run tests only through pnpm: `pnpm vp test`, `pnpm vp test test/<file>.spec.ts`, `pnpm vp check --fix`. A bare/`npx` `vp` fails (`EBADDEVENGINES`). Node 24.18.0.
- `src/**` relative imports are EXTENSIONLESS. Tests import from `"vite-plus/test"`. `test/oracle/*.ts` imports oracle helpers WITH a `.ts` extension (match existing style in that dir).
- Oracle fixtures are read-only ground truth captured from real Factorio. NEVER loosen a parity tolerance to force a pass. Numeric parity bound starts at 8e-3 (the elevation f32 floor); calibrate from the observed worst, never above it without cause.
- No `.vue`/`.ts` type-check gate exists; verify by running tests, not LSP diagnostics (stale "cannot find module" snapshots are normal right after creating a file).
- Oracle capture spawns the native macOS Factorio (default Steam path, present on this machine). If a capture cannot launch the game in the subagent sandbox, report BLOCKED with stderr and the controller runs the capture - NEVER hand-author or synthesize a fixture.
- Writing style: hyphens, never em/en dashes.
- Commit footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
  ```

## Primitive APIs (already in the codebase - consume, do not reimplement)

- `makeQuickMultioctaveNoise({ seed0, seed1, octaves, inputScale, outputScale, octaveOutputScaleMultiplier, octaveInputScaleMultiplier, offsetX }) => (x,y)=>number` - from `src/noise/quickMultioctaveNoise.ts`.
- `makeMultioctaveNoise({ seed0, seed1, octaves, persistence, inputScale, outputScale }) => (x,y)=>number` - from `src/noise/multioctaveNoise.ts` (NO offsetX param; billows are offset-0).
- `basisNoiseExpr(x, y, { seed0, seed1, inputScale, outputScale }, tables)` + `basisNoiseTablesFromSeed(seed0, seed1)` - from `src/noise/eval/primitives.ts` / `src/noise/basisNoise.ts`.
- `clamp`, `lerp`, `min`, `max`, `log2` - from `src/noise/eval/math.ts`.
- `distanceFromNearestPoint(x, y, points, maxDistance?)` - from `src/noise/distanceFromNearestPoint.ts`.
- Oracle: `sampleExpression(exprString, positions, { workDir, seed })` and the capture pattern in `test/oracle/capture.ts` / `test/oracle/oracle.ts`.

---

### Task 1: Reverse-engineer `expression_in_range` (critical path)

`expression_in_range(peak_multiplier, peak_maximum, expr_1..N, from_1..N, to_1..N)` is a native builtin with no published formula. Recover it from the oracle. Two parametrizations must both work: `(20, 1)` (all land tiles, via `expression_in_range_base`) and `(5, inf)` (sand-1's unbounded coastal term).

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureExpressionInRange()` + `want("expression-in-range")` gate)
- Create: `test/fixtures/oracle-expression-in-range.seed123456.json`
- Create: `src/noise/tiles/expressionInRange.ts` (`expressionInRange`)
- Create: `test/expressionInRange.spec.ts`
- Create: `docs/noise/expression-in-range-NOTES.md` (record the derived formula + evidence)

**Interfaces:**
- Produces: `expressionInRange(peakMultiplier: number, peakMaximum: number, values: number[], froms: number[], tos: number[]): number` (values/froms/tos equal length = the per-dimension expressions and ranges; `peakMaximum` may be `Infinity`).

- [ ] **Step 1: Add the capture function.** In `test/oracle/capture.ts`, add `captureExpressionInRange()` mirroring the existing capture shape (a `sample(expr)` helper over a `Position[]`). Sample these probe expressions (each routed onto `elevation`), storing each series under a named key:
  - `oneD_20_1`: `expression_in_range(20, 1, (x/1000), -0.5, 0.5)` over `x` in a dense sweep from -1500 to 1500 (step ~25), `y=0.25` fixed. Recovers the 1-D peak/falloff for `(20,1)`.
  - `oneD_5_inf`: `expression_in_range(5, inf, (x/1000), -0.5, 0.5)` over the same sweep. Recovers the unbounded case.
  - `twoD_min_vs_prod`: `expression_in_range(20, 1, (x/1000), 0.3, (y/1000), 0.7)` interpreted as 2 dims [expr1=x/1000 range (from1,to1), expr2=y/1000 range (from2,to2)] - USE THE CORRECT ARG ORDER: `expression_in_range(20, 1, x/1000, y/1000, from1, from2, to1, to2)` per the docs (all exprs, then all froms, then all tos). Pick `from1=-0.5,to1=0.5,from2=-0.5,to2=0.5`, hold `x/1000` at an intermediate in-range value (x=200 -> 0.2) while sweeping `y` across and out of range, plus a diagonal sweep. This distinguishes `min(a,b)` from `a*b` from `a+b`.
  Emit the fixture `{ _comment, seed0, sweeps: { oneD_20_1: {positions, values}, oneD_5_inf: {...}, twoD: {...} } }`.

- [ ] **Step 2: Generate the fixture (runs real Factorio).** Run: `node --experimental-strip-types test/oracle/capture.ts expression-in-range`. Expected: writes `test/fixtures/oracle-expression-in-range.seed123456.json`. If the game cannot launch, report BLOCKED (controller runs it).

- [ ] **Step 3: Analyze the sweeps and derive the formula.** From the 1-D `(20,1)` sweep, determine the shape. Hypothesis to test against the data: per dimension `i`, `peak_i = clamp(peak_multiplier * min(value_i - from_i, to_i - value_i) + 1, 0 or -inf, peak_maximum)` or similar triangular-in-range form; the multi-dim result combines the per-dim peaks (test min vs product vs sum against `twoD`). Write the exact recovered formula and the evidence (which candidate matched, max residual) into `docs/noise/expression-in-range-NOTES.md`. If no simple closed form matches to the noise floor, STOP and report DONE_WITH_CONCERNS with the residuals - do not ship an approximation.

- [ ] **Step 4: Write the failing parity test.** `test/expressionInRange.spec.ts` imports the fixture and asserts `expressionInRange(...)` reproduces every sweep series to the f32 floor (`< 8e-3`), for `oneD_20_1`, `oneD_5_inf` (assert the unbounded values exceed 1 in range - guards the no-clamp branch), and `twoD`.

Run: `pnpm vp test test/expressionInRange.spec.ts` -> FAIL (module missing).

- [ ] **Step 5: Implement `expressionInRange`** per the derived formula, handling finite and `Infinity` `peakMaximum`. Run the test -> PASS. Calibrate the bound from the observed worst if needed (never loosen past the data).

- [ ] **Step 6: Commit.**
```bash
git add test/oracle/capture.ts test/fixtures/oracle-expression-in-range.seed123456.json src/noise/tiles/expressionInRange.ts test/expressionInRange.spec.ts docs/noise/expression-in-range-NOTES.md
git commit -m "$(cat <<'EOF'
feat(tiles): reverse-engineer native expression_in_range from the oracle

Recover the peak/falloff formula (both (20,1) and unbounded (5,inf)) and the
N-D combination, validated against a headless-Factorio sweep to the f32 floor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 2: `get_tile` tile-ID oracle path

The existing harness (`calculate_tile_properties`) returns noise values, not the placed tile. Add a path that generates chunks and reads `surface.get_tile(pos).name`, so tile selection can be checked exactly. Independent of Task 1; build it early.

**Files:**
- Modify: `test/oracle/oracle.ts` (add `sampleTileNames(positions, { workDir, seed }) => string[]` using a chunk-generate + `get_tile` mod)
- Modify: `test/oracle/capture.ts` (add `captureTileNames()` + `want("tile-names")` gate)
- Create: `test/fixtures/oracle-tile-names.seed123456.json`
- Test: `test/oracle/oracle.spec.ts` (a gated smoke test that the new path parses a dump)

**Interfaces:**
- Produces: `sampleTileNames(positions: Position[], opts) => Promise<string[]>` - the placed tile name at each position for the DEFAULT preset (no property routing).

- [ ] **Step 1: Add the mod/dump path.** In `test/oracle/oracle.ts`, add a sibling to the existing property dumper: a mod `control.lua` that, on init, calls `game.surfaces[1].request_to_generate_chunks({0,0}, radius)` then `force_generate_chunk_requests()`, then for each requested position writes `{x, y, name = surface.get_tile(x, y).name}` to JSON via `helpers.write_file`, then `error("DUMPED-OK")`. Reuse the isolated-config + spawn plumbing already in `oracle.ts` (same `factorioBin`, `dataDir`, `spawnFn`). Positions must be covered by the generated chunks (compute the chunk radius from the max |coord|).

- [ ] **Step 2: Add capture + generate the fixture.** `captureTileNames()` samples a grid for seed 123456 that spans several biomes (a near-origin block plus a few far points) for the DEFAULT preset. Run: `node --experimental-strip-types test/oracle/capture.ts tile-names`. Writes `test/fixtures/oracle-tile-names.seed123456.json = { seed0, positions, tileNames }`. If the game cannot launch, report BLOCKED.

- [ ] **Step 3: Gated smoke test.** In `test/oracle/oracle.spec.ts`, add an `it.skipIf(!oracleAvailable())` test that the new dump path returns a `string[]` of the right length for 2-3 positions (or, if unavailable, a unit test that the JSON parser handles a canned dump). Run the spec -> PASS (or skip).

- [ ] **Step 4: Commit.**
```bash
git add test/oracle/oracle.ts test/oracle/capture.ts test/fixtures/oracle-tile-names.seed123456.json test/oracle/oracle.spec.ts
git commit -m "$(cat <<'EOF'
test(oracle): add a get_tile tile-name oracle path for tile-selection parity

calculate_tile_properties yields noise values only; this generates chunks and
reads surface.get_tile().name so the tile argmax can be checked exactly.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 3: Extract shared Nauvis noise internals (refactor)

Lift `nauvis_segmentation_multiplier`, `nauvis_hills`, `nauvis_hills_cliff_level`, `nauvis_plateaus`, `nauvis_bridge_billows` out of `makeElevationNauvis` into a reusable module, and add the new `forest_path_billows`. Elevation output must stay byte-identical.

**Files:**
- Create: `src/noise/expressions/nauvisShared.ts`
- Modify: `src/noise/expressions/elevationNauvis.ts` (consume the shared builders)
- Test: `test/nauvisShared.spec.ts` (new); `test/elevationNauvis.spec.ts` (must stay green, unchanged)

**Interfaces:**
- Produces `makeNauvisShared({ seed0, segmentationMultiplier }) => { nauvisSeg: number; hills(x,y): number; cliffLevel(x,y): number; plateaus(x,y): number; bridgeBillows(x,y): number; forestPathBillows(x,y): number }` where:
  - `nauvisSeg = 1.5 * segmentationMultiplier`
  - `hills(x,y) = Math.abs(makeMultioctaveNoise({seed0, seed1:900, octaves:4, persistence:0.5, inputScale:nauvisSeg/90, outputScale:1})(x,y))`
  - `cliffLevel(x,y) = clamp(0.65 + basisNoiseExpr(x,y,{seed0,seed1:99584,inputScale:nauvisSeg/500,outputScale:0.6}, tables99584), 0.15, 1.15)`
  - `plateaus(x,y) = 0.5 + clamp((hills(x,y) - cliffLevel(x,y))*10, -0.5, 0.5)`
  - `bridgeBillows(x,y) = Math.abs(makeMultioctaveNoise({seed0, seed1:700, octaves:4, persistence:0.5, inputScale:nauvisSeg/150, outputScale:1})(x,y))`
  - `forestPathBillows(x,y) = Math.abs(makeMultioctaveNoise({seed0, seed1:1800, octaves:4, persistence:0.5, inputScale:nauvisSeg/100, outputScale:1})(x,y))` (NEW; NO offsetX)

- [ ] **Step 1: Write nauvisShared unit test.** `test/nauvisShared.spec.ts`: build `makeNauvisShared({seed0:123456, segmentationMultiplier:1})` and assert `nauvisSeg===1.5`; assert `hills`/`bridgeBillows` at a few points equal the raw `Math.abs(makeMultioctaveNoise({...matching params...})(x,y))` (proves the extracted builders match the elevation port's inline math exactly); assert `plateaus` is within `[0,1]` and `forestPathBillows >= 0`.

- [ ] **Step 2: Run -> FAIL** (`nauvisShared` missing). `pnpm vp test test/nauvisShared.spec.ts`.

- [ ] **Step 3: Implement `nauvisShared.ts`** with the builders above (hoist `tables99584 = basisNoiseTablesFromSeed(seed0, 99584)` once). Then refactor `elevationNauvis.ts` to build `const nz = makeNauvisShared({seed0, segmentationMultiplier: seg})` and replace the inline `hills`/`bridgeBillows`/`cliffLevel`/`nauvisPlateaus`/`nauvisSeg` with `nz.*`. Leave every other elevation term (detail, macro, persistence, offsetX for detail/persistance) untouched. **Do not** route `offsetX` into the billow builders.

- [ ] **Step 4: Run both specs -> PASS.** `pnpm vp test test/nauvisShared.spec.ts test/elevationNauvis.spec.ts`. The elevation oracle parity test MUST still pass byte-identically (worst far-field 4.08e-3, near-spawn 1e-4). If it drifts, a term was mis-extracted - fix before proceeding. Then `pnpm vp test` (full) + `pnpm vp check`.

- [ ] **Step 5: Commit.**
```bash
git add src/noise/expressions/nauvisShared.ts src/noise/expressions/elevationNauvis.ts test/nauvisShared.spec.ts
git commit -m "$(cat <<'EOF'
refactor(noise): extract shared Nauvis internals for climate reuse

Lift nauvis_hills/cliff_level/plateaus/bridge_billows (+ new forest_path_billows)
out of makeElevationNauvis into nauvisShared. Elevation oracle parity unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CNwrAUcgTMGwhuqshkr96U
EOF
)"
```

---

### Task 4: Climate control read helper

Resolve the `control:*` climate levers from a preset, with game defaults for the ones the app model does not carry.

**Files:**
- Create: `src/model/climateReads.ts`
- Test: `test/climateReads.spec.ts`

**Interfaces:**
- Produces `readClimateControls(pen: Record<string,string>) => { temperature: {frequency:number,bias:number}, moisture:{frequency:number,bias:number}, aux:{frequency:number,bias:number}, startingAreaMoisture:{size:number,frequency:number}, waterFrequency:number }`. `frequency = 1/scale` reads mirror `climateControls.ts` where those keys exist; for keys absent from the model use game defaults: temperature `{frequency:1,bias:0}`, aux read via existing aux keys, moisture via existing moisture keys, starting_area_moisture `{size:1,frequency:1}`, waterFrequency from `control:water:frequency` default 1.

- [ ] **Step 1: Write the test.** Assert defaults when the pen is empty (temperature freq 1/bias 0, starting_area_moisture size 1/freq 1, water freq 1); assert it reads `control:temperature:bias`, `control:aux:bias`, `control:moisture:bias`, `control:water:frequency` when present. Note the game reads `var('control:X:frequency')` directly (NOT `1/scale`) inside the climate exprs - confirm against `climateControls.ts` whether the stored wire value is frequency or scale, and expose `frequency` matching the game's `var('control:X:frequency')` semantics. (climateControls stores `frequency = 1/scale`; the read helper must return the raw wire `control:X:frequency` value the game uses.)

- [ ] **Step 2: Run -> FAIL.** `pnpm vp test test/climateReads.spec.ts`.

- [ ] **Step 3: Implement `climateReads.ts`.** Read the wire `control:*:frequency`/`:bias`/`:size` values from `pen` with `Number(...)`, applying the game defaults above. Do NOT apply the `1/scale` transform (the climate expressions use `var('control:X:frequency')` verbatim).

- [ ] **Step 4: Run -> PASS.** Then `pnpm vp test` + `pnpm vp check`.

- [ ] **Step 5: Commit** (`feat(model): climate control read helper with game defaults`, standard footer).

---

### Task 5: Port `temperature_basic`

**Files:**
- Create: `src/noise/expressions/temperature.ts` (`makeTemperature`)
- Modify: `test/oracle/capture.ts` (`captureTemperature()` + gate `want("temperature")`)
- Create: `test/fixtures/oracle-temperature.seed123456.json`, `test/temperature.spec.ts`

**Interfaces:**
- Produces `makeTemperature({ seed0, frequency?, bias? }) => (x,y)=>number` implementing:
  `clamp(15 + bias + quick(x,y), -20, 50)` where `quick = makeQuickMultioctaveNoise({ seed0, seed1:5, octaves:4, inputScale: frequency/32, outputScale: 1/20, offsetX: 40000/frequency, octaveOutputScaleMultiplier: 3, octaveInputScaleMultiplier: 1/3 })`, defaults `frequency=1, bias=0`.

- [ ] **Step 1: capture** - `captureTemperature()` samples `"temperature"` (routed onto elevation) at the standard grid (near-origin block + far rings + deep point, seed 123456), same grid builder as `captureElevationLakes`. Fixture `{ seed0, positions, temperature }`.
- [ ] **Step 2: generate** - `node --experimental-strip-types test/oracle/capture.ts temperature` (real game; BLOCKED-report if it can't launch).
- [ ] **Step 3: failing parity test** - `test/temperature.spec.ts` asserts `makeTemperature({seed0})` matches the fixture to `< 8e-3`.
- [ ] **Step 4: implement** `temperature.ts`; run -> PASS; calibrate bound from observed worst if needed.
- [ ] **Step 5: full suite + check + commit** (`feat(noise): port temperature_basic climate expression`, footer).

---

### Task 6: Port `aux_nauvis`

**Files:**
- Create: `src/noise/expressions/aux.ts` (`makeAux`)
- Modify: `test/oracle/capture.ts` (`captureAux()` + gate)
- Create: `test/fixtures/oracle-aux.seed123456.json`, `test/aux.spec.ts`

**Interfaces:**
- Produces `makeAux({ seed0, segmentationMultiplier?, frequency?, bias? }) => (x,y)=>number`:
  `clamp(0.5 + bias + 0.06*(plateaus(x,y) - 0.4) + auxNoise(x,y), 0, 1)` where `plateaus` comes from `makeNauvisShared({seed0, segmentationMultiplier})` and `auxNoise = makeQuickMultioctaveNoise({ seed0, seed1:7, octaves:4, inputScale: frequency/2048, outputScale: 0.25, offsetX: 20000/frequency, octaveOutputScaleMultiplier: 0.5, octaveInputScaleMultiplier: 3 })`. Defaults `segmentationMultiplier=1, frequency=1, bias=0`.

- [ ] Steps mirror Task 5 (capture `"aux"` -> `oracle-aux.seed123456.json`; failing test; implement; PASS; commit `feat(noise): port aux_nauvis climate expression`). The `plateaus` dependency means `segmentationMultiplier` (= `control:water:frequency`) must thread through.

---

### Task 7: Port `moisture_nauvis`

**Files:**
- Create: `src/noise/expressions/moisture.ts` (`makeMoisture`)
- Modify: `test/oracle/capture.ts` (`captureMoisture()` + gate)
- Create: `test/fixtures/oracle-moisture.seed123456.json`, `test/moisture.spec.ts`

**Interfaces:**
- Produces `makeMoisture({ seed0, segmentationMultiplier?, moistureFrequency?, moistureBias?, startingAreaMoistureSize?, startingAreaMoistureFrequency?, startingPositions? }) => (x,y)=>number` implementing (all verbatim from spec):
  - `moistureNoise = makeQuickMultioctaveNoise({ seed0, seed1:6, octaves:4, inputScale: moistureFrequency/256, outputScale: 0.125, offsetX: 30000/moistureFrequency, octaveOutputScaleMultiplier: 1.5, octaveInputScaleMultiplier: 1/3 })`
  - `nz = makeNauvisShared({seed0, segmentationMultiplier})` (for `plateaus`, `hills`, `bridgeBillows`, `forestPathBillows`)
  - `moistureAdjustedBias`: `startingBiasChange = slider_to_linear(startingAreaMoistureSize, -0.5, 0.5)` (`slider_to_linear(s,lo,hi)=lo+0.5*(hi-lo)*(1+log2(s)/log2(6))`); `startingBias = lerp(base_bias, startingBiasChange, abs(2*startingBiasChange)*1.1)`; `startingBiasRegion = clamp(2 - startingAreaMoistureFrequency/400 * distance, 0, 1)`; `moistureAdjustedBias = lerp(base_bias, startingBias, startingBiasRegion)` with `base_bias = moistureBias`, `distance = distanceFromNearestPoint(x,y,startingPositions)` (no cap).
  - `moistureMain = clamp(0.4 + moistureAdjustedBias + moistureNoise(x,y) - 0.08*(nz.plateaus(x,y) - 0.6), 0, 1)`
  - `treesForestPathCutout = min((nz.bridgeBillows(x,y)-0.07)*5, (nz.hills(x,y)-0.1)*3, (nz.forestPathBillows(x,y)-0.07)*3)`
  - result `= max(min(moistureMain, 0.45), moistureMain - 0.2*max(0, 1 - treesForestPathCutout*1.5))`
  - Defaults: `segmentationMultiplier=1, moistureFrequency=1, moistureBias=0, startingAreaMoistureSize=1, startingAreaMoistureFrequency=1, startingPositions=[{x:0,y:0}]`. Add `slider_to_linear` to `src/noise/eval/math.ts` (with a unit test) since it is reused.

- [ ] Steps mirror Task 5 (capture `"moisture"` -> fixture; failing test; implement; PASS; commit `feat(noise): port moisture_nauvis climate expression`). Note: at default `startingAreaMoistureSize=1`, `slider_to_linear=0` so the starting-area path is degenerate - the fixture still validates the whole closure at defaults; do not add UI for the starting-area levers.

---

### Task 8: Tile helpers (`expressionInRangeBase`, `waterBase`, `noiseLayerNoise`)

**Files:**
- Create: `src/noise/tiles/helpers.ts`
- Test: `test/tileHelpers.spec.ts`

**Interfaces:**
- Consumes `expressionInRange` (Task 1), `makeMultioctaveNoise`.
- Produces:
  - `expressionInRangeBase(aux: number, moisture: number, auxFrom: number, moistureFrom: number, auxTo: number, moistureTo: number): number` = `expressionInRange(20, 1, [aux, moisture], [auxFrom, moistureFrom], [auxTo, moistureTo])`.
  - `waterBase(elevation: number, maxElevation: number, influence: number): number` = `maxElevation >= elevation ? influence * Math.min(maxElevation - elevation, 1) : -Infinity`.
  - `makeNoiseLayerNoise(seed0: number, seed1: number) => (x,y)=>number` = `makeMultioctaveNoise({ seed0, seed1, octaves:4, persistence:0.7, inputScale:1/6, outputScale:2/3 })`.

- [ ] **Step 1: test** - assert `waterBase(-3,-2,200)=200` (elev -3 <= -2, min(1,1)*200), `waterBase(0,-2,200)=-Infinity` (0 > -2), `waterBase(-2.5,-2,200)=200*0.5=100`; assert `expressionInRangeBase` inside a range exceeds outside it (delegation sanity via Task 1's validated fn); assert `makeNoiseLayerNoise(123456,19)` returns finite values roughly in `[-2/3*4, +...]`.
- [ ] **Step 2: FAIL -> Step 3: implement -> Step 4: PASS.** `pnpm vp test test/tileHelpers.spec.ts`.
- [ ] **Step 5: commit** (`feat(tiles): expression_in_range_base, water_base, noise_layer_noise helpers`, footer).

---

### Task 9: Tile catalog + palette

The 21 Nauvis tiles as data - name, `map_color` RGBA, and a `probability(env)` closure. See the spec's tile table for every verbatim expression + color.

**Files:**
- Create: `src/noise/tiles/catalog.ts`
- Test: `test/tileCatalog.spec.ts`

**Interfaces:**
- Consumes `expressionInRange`/`expressionInRangeBase`/`waterBase`/`makeNoiseLayerNoise`.
- Produces `makeTileCatalog(seed0: number) => Tile[]` where `Tile = { name: string; color: [number,number,number,number]; probability(env: { x:number; y:number; elevation:number; aux:number; moisture:number }): number }`. Each tile's `probability` is the verbatim expression from the spec table. `noise_layer_noise(N)` layers are built once per tile via `makeNoiseLayerNoise(seed0, N)` and captured in the closure. `map_color` is stored as `[r,g,b,255]` (0-255, verbatim from the table). `sand-1`'s coastal term uses `expressionInRange(5, Infinity, [elevation, aux], [-1.5, 0.5], [1.5, 1])`.

- [ ] **Step 1: test** - assert the catalog has exactly 21 tiles with the expected names; assert two water tiles (`deepwater`,`water`) have no noise layer and their `probability` reduces to `waterBase`; assert each land tile's color matches the spec table (spot-check grass-1 `[55,53,11,255]`, sand-1 `[138,103,58,255]`, red-desert-3 `[128,93,52,255]`); assert `probability` is finite for a land env and evaluates without throwing for all 21.
- [ ] **Step 2: FAIL -> Step 3: implement the full 21-tile catalog** (transcribe each `probability_expression` from the spec table into a closure over the helpers) **-> Step 4: PASS.**
- [ ] **Step 5: commit** (`feat(tiles): 21-tile Nauvis autoplace catalog with map_color palette`, footer).

---

### Task 10: `resolveTile` (argmax) + tile-selection oracle parity

**Files:**
- Create: `src/noise/tiles/resolve.ts` (`makeTileResolver`)
- Test: `test/resolveTile.spec.ts` (uses the Task 2 `oracle-tile-names` fixture)

**Interfaces:**
- Consumes `makeTileCatalog` (Task 9), and the climate/elevation evaluators (Tasks 3,5,6,7 + `makeElevationNauvis`).
- Produces `makeTileResolver({ seed0, segmentationMultiplier?, ... }) => (x,y)=>Tile` that evaluates elevation, aux, moisture once at `(x,y)`, then returns the catalog tile with the maximum `probability(env)` (argmax; on the astronomically-unlikely exact tie, first in catalog order).

- [ ] **Step 1: failing parity test** - `test/resolveTile.spec.ts` imports `oracle-tile-names.seed123456.json`; builds `makeTileResolver({seed0:123456})` (default Nauvis climate + elevation); asserts the resolved tile `.name` equals the game's `tileNames[i]` at each fixture position. Allow a small mismatch budget ONLY at boundary pixels where `noise_layer_noise` seams flip a tile within the f32 floor (mirror the elevation coastline caveat): assert exact match on >= 90% of points AND that any mismatch is between two tiles whose top-2 probabilities are within ~1e-2. If overall agreement is low, that is a real bug in a tile expression, helper, or the argmax - not a tolerance to widen.
- [ ] **Step 2: Run -> FAIL** if resolver missing. **Step 3: implement `resolveTile`. Step 4: Run -> PASS.** Investigate any systematic mismatch (e.g. a whole biome wrong -> a tile expression or `expression_in_range` bug) with `superpowers:systematic-debugging`; do not just widen the budget.
- [ ] **Step 5: commit** (`feat(tiles): resolveTile argmax validated against get_tile ground truth`, footer).

---

### Task 11: Terrain render path (+ water early-out + timing)

**Files:**
- Create: `src/noise/preview/renderTerrain.ts` (`renderTerrain`)
- Test: `test/renderTerrain.spec.ts`

**Interfaces:**
- Consumes `makeTileResolver` (Task 10), `makeElevationNauvis`/climate.
- Produces `renderTerrain({ seed0, width, height, originX?, originY?, tilesPerPixel?, ctx? }) => ImageData` - per pixel: evaluate elevation; **water early-out** - if `waterBase(elevation,0,100) >= 1.67` (water/deepwater necessarily win), pick the water tile by `max(waterBase(elev,-2,200), waterBase(elev,0,100))` and skip the 19 land layers; else run the full `resolveTile`. Write the winner's `color`.

- [ ] **Step 1: test** - assert output ImageData is `width*height*4`; assert a deep-water pixel (choose a point where elevation is very negative for seed 123456, e.g. reuse an island deep-field point) is the deepwater color `[38,64,73,255]`; assert a known land pixel matches `makeTileResolver` at that point (the render and the resolver agree); assert the water early-out path returns the SAME tile as the full resolver at a water point (early-out correctness - the resolver must also pick water there).
- [ ] **Step 2: FAIL -> Step 3: implement (with early-out) -> Step 4: PASS.**
- [ ] **Step 5: measure** - add a `console`-free timing note: render a 256x256 terrain tile and record wall-clock in the task report (not a test assertion). Report the extrapolated 1024x1024 time so the controller can decide if optimization is needed this milestone.
- [ ] **Step 6: commit** (`feat(preview): terrain color render path with water early-out`, footer).

---

### Task 12: Preview UI - Terrain vs Elevation toggle

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (add a `view: "elevation" | "terrain"` field, default "elevation"; dispatch to `renderTerrain` when "terrain")
- Modify: `src/components/ElevationPreviewPanel.vue` (a view toggle; pass `view` through)
- Test: `test/renderTerrain.spec.ts` or a new `test/previewView.spec.ts` (dispatch selects the right renderer)

**Interfaces:**
- Consumes `renderTerrain` (Task 11), existing `renderElevation`.

- [ ] **Step 1: failing test** - assert the render request with `view: "terrain"` produces terrain colors (a water pixel = deepwater/water color) and `view: "elevation"` keeps the current water/land mask; mirror the existing renderElevation dispatch test style.
- [ ] **Step 2: FAIL -> Step 3: wire the `view` field + a toggle control in the panel (Factorio-styled, near the map-type selector) -> Step 4: PASS.** Keep `view` only for supported map types (terrain render assumes Nauvis climate; for lakes/island elevation the terrain view still uses Nauvis climate per the spec's out-of-scope note - or disable the terrain toggle for non-nauvis; pick disable-for-non-nauvis to avoid implying fidelity we don't have, and note it).
- [ ] **Step 5: full suite + check + commit** (`feat(preview): Terrain view toggle on the preview panel`, footer).

---

### Task 13: Compositing sanity vs `--generate-map-preview` + roadmap

**Files:**
- Create: `docs/noise/terrain-render-NOTES.md` (the `expression_in_range` formula pointer, the coastline-at--0.017 note, the get_tile parity result, render timing)
- Modify: `docs/noise/client-preview-ROADMAP.md` (mark Milestone 2 progress)

- [ ] **Step 1: Compositing sanity check.** Using the preview-service `--generate-map-preview` reference for the default preset at seed 123456 (or a manually captured server image), eyeball the client Terrain render against it: same biome layout, water shape, sand-on-coast. This is a manual/visual gate (the exact gate is Task 10's `get_tile` parity). Record the comparison (and any lighting/shading difference) in `terrain-render-NOTES.md`. If the harness/preview-service is unavailable, note it and rely on Task 10's exact parity.
- [ ] **Step 2: Update the roadmap** - mark Milestone 2 climate + tile coloring done (match the done-marker style used for M1/nauvis/island), noting temperature/moisture/aux ported, `expression_in_range` RE'd, tile argmax validated against `get_tile`.
- [ ] **Step 3: commit** (`docs(preview): Milestone 2 terrain colors done + notes`, footer).

---

## Self-Review

**Spec coverage:**
- RE `expression_in_range` both `(20,1)` and `(5,inf)` + N-D min/product/sum -> Task 1. ✓
- `get_tile` tile-ID oracle (S2) -> Task 2. ✓
- Layer-1 shared-internals extraction, elevation byte-exact, offset_x=0 (N5) -> Task 3. ✓
- Climate control read helper with game defaults (S4) -> Task 4. ✓
- temperature/aux/moisture ports (incl. trees_forest_path_cutout, slider_to_linear) -> Tasks 5,6,7. ✓
- Tile helpers -> Task 8; catalog + palette (21 tiles, sand-1 inf term) -> Task 9. ✓
- resolveTile argmax + get_tile parity (S2, N3 order/layer empirical) -> Task 10. ✓
- Terrain render + water early-out + timing (S3) -> Task 11. ✓
- UI toggle -> Task 12; compositing sanity + coastline note (N2) + roadmap -> Task 13. ✓
- Out-of-scope (resources/cliffs/enemies/codec) -> untouched. ✓

**Placeholder scan:** No TBD/TODO. Task 1's formula and Task 2's mod are research deliverables (the methodology + validation are fully specified); this is the nature of oracle RE, not a placeholder. Every port task carries the verbatim game expression and exact primitive params.

**Type consistency:** `Tile = { name, color:[number,number,number,number], probability(env) }` is consistent across Tasks 9-11. `makeNauvisShared`'s returned members (`hills/cliffLevel/plateaus/bridgeBillows/forestPathBillows`) are consumed identically in Tasks 3,6,7. `expressionInRange(pm, pmax, values[], froms[], tos[])` signature is consistent between Task 1 (def) and Tasks 8-9 (use). `readClimateControls` shape (Task 4) matches the params threaded into Tasks 5-7/10-11.

**Sequencing note:** Tasks 1 and 2 are independent and can run first in either order; Task 3 gates 6/7; Task 1 gates 8/9/10. The critical path is 1 -> 8 -> 9 -> 10 -> 11.

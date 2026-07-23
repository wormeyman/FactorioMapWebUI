# Vulcanus Client-Side Preview - V1 (Terrain & Biomes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a recognizable Vulcanus surface (elevation + the radial ashlands/mountains/basalts biome system + tile colors) client-side by hand-porting the Vulcanus noise expressions and validating each against a Space-Age-enabled headless-Factorio oracle, ending at a checkpoint that decides whether V2 (resources) / V3 (cliffs) are worth continuing.

**Architecture:** Same method that ported Nauvis (M1-M4): hand-ported TypeScript closures over the already-solved noise primitives, each diffed against the game via `calculate_tile_properties` / `get_tile`. Vulcanus is added *alongside* Nauvis at each existing seam (expressions / tiles / render dispatch), selected by planet. Only two things are genuinely new: a Space-Age oracle path, and the `multisample` primitive plus a handful of engine seed variables (`map_seed_normalized`, `map_seed_small`) that must be reverse-engineered.

**Tech Stack:** TypeScript, Vue 3, Vitest-compatible (`vite-plus/test`), Web Worker render, headless Factorio oracle (`test/oracle/`) with Space Age enabled.

**Design spec:** `docs/superpowers/specs/2026-07-23-vulcanus-client-preview-design.md`.
**Game source (read-only ground truth):** `~/GitHub/factorio-data` @ tag 2.1.11 - `space-age/prototypes/planet/planet-vulcanus-map-gen.lua` (the Vulcanus tree) and `core/prototypes/noise-functions.lua` (`starting_spot_at_angle`, `slider_rescale`).

## Global Constraints

- Run tests only through pnpm: `pnpm vp test`, `pnpm vp test test/<file>.spec.ts`, `pnpm vp check --fix`. A bare/`npx` `vp` fails (`EBADDEVENGINES`). Node 26.5.0 (`.node-version`).
- `src/**` relative imports are EXTENSIONLESS. Tests import from `"vite-plus/test"`. `test/oracle/*.ts` imports oracle helpers WITH a `.ts` extension (match existing style in that dir).
- Oracle fixtures are read-only ground truth captured from real Factorio. NEVER loosen a parity tolerance to force a pass - a mismatch is a real finding. Numeric parity bound starts at the f32 noise floor (~2e-6 fastapprox, ~8e-3 for elevation-scale sums); calibrate DOWN from the observed worst, never up without cause.
- No `.vue`/`.ts` type-check gate exists for `.vue` bodies; `vp check` type-checks `.ts` only. Verify by running tests, not LSP diagnostics (stale "cannot find module" snapshots are normal right after creating a file).
- **Oracle capture spawns native macOS Factorio and MUST have Space Age enabled** (Vulcanus does not exist in base). If a capture cannot launch the game (missing DLC, sandbox), report BLOCKED with stderr and let the controller run it - NEVER hand-author or synthesize a fixture.
- The map-exchange codec is OUT OF SCOPE. Do not touch `src/codec/**`. Planet is not encoded in the exchange string.
- Writing style: hyphens, never em/en dashes.
- Commit footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X3qyjmKJhxrGsiSvmyd42a
  ```

## Primitive APIs (already in the codebase - consume, do not reimplement)

- `basisNoiseExpr(x, y, { seed0, seed1, inputScale, outputScale }, tables)` + `basisNoiseTablesFromSeed(seed0, seed1)` - `src/noise/basisNoise.ts` / `src/noise/eval/primitives.ts`.
- `makeMultioctaveNoise({ seed0, seed1, octaves, persistence, inputScale, outputScale })` - `src/noise/multioctaveNoise.ts`.
- `makeQuickMultioctaveNoise(...)` - `src/noise/quickMultioctaveNoise.ts`.
- spot noise: `spotCandidates.ts` + `spotSelection.ts` (see how `src/noise/resources/*` and the enemy/cliff fields drive them).
- `clamp`, `lerp`, `min`, `max`, `log2`, `abs` - `src/noise/eval/math.ts` (add `sin`/`cos`/`pi` there in Task 3 if absent).
- `randomPenalty` - `src/noise/randomPenalty.ts` (V2; not needed in V1).
- Oracle: `sampleExpression(exprString, positions, opts)` and the capture pattern in `test/oracle/capture.ts` / `test/oracle/oracle.ts`.
- `slider_rescale` already has a working inline implementation in `src/noise/rocks/rockCatalog.ts` / `rockField.ts` - Task 3 extracts it to a shared helper; do not write a second copy.

## Engine variables Vulcanus references (and where each comes from)

| var | meaning | source in V1 |
| --- | --- | --- |
| `map_seed` | `seed0` | ctx (already have) |
| `x`, `y` | world tile coords | render loop |
| `x_from_start`, `y_from_start` | coords relative to spawn | RE in Task 2 (origin spawn -> `= x, y`; confirm) |
| `distance` | euclidean distance from spawn | derived from spawn point (Nauvis pattern) |
| `map_seed_normalized` | seed -> `[0,1)`; drives `vulcanus_ashlands_angle = *3600` | **RE in Task 2** |
| `map_seed_small` | seed low bits; `& 1` -> `vulcanus_starting_direction` | **RE in Task 2** |
| `control:vulcanus_volcanism:frequency|size`, `control:temperature:bias` | slider levers | ctx extension (Task 5) |
| `no_enemies_mode` | peaceful flag | not needed in V1 (demolishers out of scope) |

---

### Task 1: Space-Age oracle path

Vulcanus expressions only resolve with the `space-age` mod loaded. Extend the oracle plumbing so a capture can request Space Age, and prove a Vulcanus expression samples end to end.

**Files:**
- Modify: `test/oracle/oracle.ts` (thread a `spaceAge?: boolean` / mod-list option into the isolated-config + mod-dir it already builds; when set, enable `space-age` in the generated `mod-list.json` and set the surface/planet to `vulcanus` for property routing)
- Modify: `test/oracle/capture.ts` (add a `want("vulcanus-smoke")` gate)
- Create: `test/fixtures/oracle-vulcanus-smoke.seed123456.json`
- Test: `test/oracle/oracle.spaceAge.spec.ts` (gated smoke test)

**Interfaces:**
- Produces: `sampleExpression(expr, positions, { spaceAge: true, planet: "vulcanus", ... })` returns a `number[]` for a Vulcanus expression.

- [ ] **Step 1: Add the Space-Age option to the oracle.** In `test/oracle/oracle.ts`, add `spaceAge?: boolean` and `planet?: string` to the sample options. When `spaceAge`, write a `mod-list.json` enabling `base`, `space-age`, `elevated-rails`, `quality` and generate the map on the requested planet's surface (mirror the existing dumper mod, but choose the planet). Keep the non-Space-Age path byte-identical to today.
- [ ] **Step 2: Add the capture gate.** In `test/oracle/capture.ts`, add `captureVulcanusSmoke()` that samples `vulcanus_starting_area_radius` (constant `0.525`) and `vulcanus_ore_spacing` (constant `128`) plus `vulcanus_temperature` at 4 points, seed 123456, `spaceAge: true, planet: "vulcanus"`. Gate under `want("vulcanus-smoke")`.
- [ ] **Step 3: Generate the fixture (runs real Factorio + Space Age).** Run: `node --experimental-strip-types test/oracle/capture.ts vulcanus-smoke`. Expected: writes `test/fixtures/oracle-vulcanus-smoke.seed123456.json`. If the game cannot launch with Space Age, report BLOCKED with stderr (controller runs it).
- [ ] **Step 4: Gated smoke test.** `test/oracle/oracle.spaceAge.spec.ts`: `it.skipIf(!oracleAvailable())` asserts the two constants come back exactly `0.525` / `128`, proving the Space-Age routing works. Run: `pnpm vp test test/oracle/oracle.spaceAge.spec.ts` -> PASS or skip.
- [ ] **Step 5: Commit.**
```bash
git add test/oracle/oracle.ts test/oracle/capture.ts test/fixtures/oracle-vulcanus-smoke.seed123456.json test/oracle/oracle.spaceAge.spec.ts
git commit -m "$(cat <<'EOF'
test(oracle): add a Space-Age (Vulcanus) oracle capture path

Vulcanus expressions only resolve with the space-age mod loaded; thread a
spaceAge/planet option through the isolated-config oracle and prove a Vulcanus
expression samples end to end.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X3qyjmKJhxrGsiSvmyd42a
EOF
)"
```

---

### Task 2: Reverse-engineer the seed variables (`map_seed_normalized`, `map_seed_small`, `x_from_start`, `y_from_start`)

`vulcanus_ashlands_angle = map_seed_normalized * 3600` and `vulcanus_starting_direction = -1 + 2*(map_seed_small & 1)` set the entire biome rotation, so these must be exact. `starting_spot_at_angle` uses `x_from_start`/`y_from_start`. All are engine builtins with no Lua source.

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureSeedVars()` + `want("seed-vars")`, sampling across several seeds)
- Create: `test/fixtures/oracle-seed-vars.multi.json`
- Create: `src/noise/expressions/vulcanusSeed.ts` (`seedNormalized`, `seedSmall`)
- Create: `test/vulcanusSeed.spec.ts`
- Create: `docs/noise/vulcanus-seed-vars-NOTES.md`

**Interfaces:**
- Produces: `seedNormalized(seed0: number): number` in `[0,1)`; `seedSmall(seed0: number): number`; and a documented finding for `x_from_start`/`y_from_start` (expected `= x, y` for the origin/default spawn - if the game offsets spawn, record the offset).

- [ ] **Step 1: Capture across seeds.** `captureSeedVars()` samples `map_seed_normalized`, `map_seed_small`, `x_from_start`, `y_from_start` (each routed onto a scalar property) at a fixed point for ~12 seeds (including 123456, 0, 1, 2, 0xFFFFFFFF), `spaceAge: true, planet: "vulcanus"`. Emit `{ seeds: [{seed0, mapSeedNormalized, mapSeedSmall, xFromStart, yFromStart}, ...] }`.
- [ ] **Step 2: Generate the fixture.** Run: `node --experimental-strip-types test/oracle/capture.ts seed-vars`. Writes `test/fixtures/oracle-seed-vars.multi.json`. BLOCKED handling as Task 1.
- [ ] **Step 3: Derive the formulas.** From the per-seed values, determine `map_seed_normalized` (candidate: `seed0 / 2^32` or `(seed0 & 0xFFFFFFFF)/2^32`; check monotonicity + the endpoints) and `map_seed_small` (candidate: `seed0 & 0xFFFF` or the low 32 bits; only its parity matters downstream). Confirm `x_from_start == x` and `y_from_start == y` at the sampled point for the default spawn. Write formulas + evidence (which candidate matched, residuals) to `docs/noise/vulcanus-seed-vars-NOTES.md`. If no exact integer/float relation matches, STOP and report DONE_WITH_CONCERNS with the table.
- [ ] **Step 4: Failing test.** `test/vulcanusSeed.spec.ts` asserts `seedNormalized(seed0)` and `seedSmall(seed0)&1` reproduce every fixture row exactly (these are deterministic integer/float ops, so tolerance is 0 for parity of the derived value; `map_seed_normalized` to ~1e-7). Run -> FAIL (module missing).
- [ ] **Step 5: Implement `src/noise/expressions/vulcanusSeed.ts`** per the derived formulas. Run -> PASS.
- [ ] **Step 6: Commit** (`feat(vulcanus): RE map_seed_normalized/map_seed_small seed variables`).

---

### Task 3: Shared helpers - `starting_spot_at_angle`, `slider_rescale`, trig math

Port the two base-game helpers Vulcanus leans on, and add the trig `math` needs. `starting_spot_at_angle` is the radial-placement backbone; its formula is fully known (no oracle RE of the formula, only validation).

Verbatim game source (`core/prototypes/noise-functions.lua`):
```
starting_spot_at_angle{angle, distance, radius, x_distortion, y_distortion}:
  angle_rad = angle/180*pi
  delta_x   = distance*sin(angle_rad) - x_from_start + x_distortion
  delta_y   = -distance*cos(angle_rad) - y_from_start + y_distortion
  result    = 1 - (delta_x*delta_x + delta_y*delta_y)^0.5 / radius
slider_rescale(value, exponent): (see existing rocks implementation - extract, don't rewrite)
```

**Files:**
- Modify: `src/noise/eval/math.ts` (add `sin`, `cos`, `PI` if absent - match the game's float behavior; standard `Math.*` is fine, validated in Step 4)
- Create: `src/noise/expressions/vulcanusShared.ts` (`startingSpotAtAngle`)
- Create: `src/noise/eval/sliderRescale.ts` (`sliderRescale(value, exponent)`) and switch `src/noise/rocks/rockCatalog.ts` + `rockField.ts` to import it (DRY; no behavior change)
- Create: `test/startingSpotAtAngle.spec.ts`, `test/sliderRescale.spec.ts`

**Interfaces:**
- Produces: `startingSpotAtAngle({ angle, distance, radius, xDistortion, yDistortion, xFromStart, yFromStart }): number`; `sliderRescale(value: number, exponent: number): number`.

- [ ] **Step 1: Extract `sliderRescale`.** Move the inline rocks implementation into `src/noise/eval/sliderRescale.ts`, import it from both rocks files. `test/sliderRescale.spec.ts` asserts a few values equal to the pre-extraction inline output (regression guard). Run: `pnpm vp test test/sliderRescale.spec.ts` + `pnpm vp test test/rocks*.spec.ts` -> PASS (rocks unchanged).
- [ ] **Step 2: Failing test for `startingSpotAtAngle`.** Write closed-form expectations by hand from the verbatim formula for 3 cases (on-center -> `1`, at `radius` distance -> `0`, a distorted case). Run -> FAIL (module missing).
- [ ] **Step 3: Implement `startingSpotAtAngle`** transcribing the verbatim formula (`xFromStart`/`yFromStart` from Task 2 finding, default `= x, y`). Run -> PASS.
- [ ] **Step 4: Oracle validation.** Add `captureStartingSpotAtAngle()` (`want("starting-spot")`) sampling e.g. `starting_spot_at_angle{angle=90, distance=170, radius=350, x_distortion=0, y_distortion=0}` over a grid, `spaceAge, planet:vulcanus`. Fixture `test/fixtures/oracle-starting-spot.seed123456.json`. Extend the spec to diff `startingSpotAtAngle` against it to the f32 floor. Run -> PASS or BLOCKED-on-capture.
- [ ] **Step 5: Commit** (`feat(vulcanus): port starting_spot_at_angle + extract shared slider_rescale`).

---

### Task 4: Reverse-engineer + port the `multisample` primitive

`vulcanus_elev` uses `multisample(vulcanus_basalt_lakes, dx, dy)` (a 2x2 supersample). It is a native builtin; recover its exact sampling offsets from the oracle.

**Files:**
- Modify: `test/oracle/capture.ts` (`captureMultisample()` + `want("multisample")`)
- Create: `test/fixtures/oracle-multisample.seed123456.json`
- Create: `src/noise/eval/multisample.ts` (`multisample`)
- Create: `test/multisample.spec.ts`
- Create: `docs/noise/vulcanus-multisample-NOTES.md`

**Interfaces:**
- Produces: `multisample(sampleAt: (x: number, y: number) => number, x: number, y: number, dx: number, dy: number): number` - the value of the inner expression sampled at a fractional sub-tile offset determined by `(dx, dy)` and the recovered step.

- [ ] **Step 1: Capture.** Route a simple known inner expression (e.g. `multisample(x + 0.001*y, dx, dy)` so the returned value directly reveals the sampled `(x,y)`) through the oracle for `(dx,dy)` in `{(0,0),(1,0),(0,1),(1,1)}` over several base points. Emit the fixture.
- [ ] **Step 2: Generate the fixture.** Run: `node --experimental-strip-types test/oracle/capture.ts multisample`. BLOCKED handling as Task 1.
- [ ] **Step 3: Derive the offset rule.** Back out the sub-tile offset each `(dx,dy)` applies (candidate: samples at `(x + dx/2, y + dy/2)` or `x + (dx-0.5)*step`). Record in the NOTES file with evidence. If the inner-expression trick is insufficient (native multisample averages internally), fall back to sampling a `basis_noise` inner and matching against `basisNoiseExpr`.
- [ ] **Step 4: Failing test** in `test/multisample.spec.ts` reproducing the fixture. Run -> FAIL.
- [ ] **Step 5: Implement `multisample`.** Run -> PASS to the f32 floor.
- [ ] **Step 6: Commit** (`feat(vulcanus): RE the native multisample primitive`).

---

### Task 5: Vulcanus ctx extension + shared noise helpers (`detail_noise`, `plasma`, `threshold`, `contrast`, `biome_noise`, wobbles)

Extend the eval ctx with Vulcanus's control levers + seed vars, then port the reusable helper closures the rest of the tree calls. All are transcriptions of verbatim Lua over existing primitives; validate the leaf ones against the oracle.

Verbatim (from the Vulcanus file - transcribe exactly):
```
vulcanus_detail_noise(seed1,scale,octaves,magnitude) = multioctave_noise{seed0=map_seed, seed1=seed1+12243, octaves, persistence=0.6, input_scale=1/50/scale, output_scale=magnitude}
vulcanus_plasma(seed,scale,scale2,mag1,mag2) = abs(basis_noise{seed1=12643, input_scale=1/50/scale, output_scale=mag1} - basis_noise{seed1=13423+seed, input_scale=1/50/scale2, output_scale=mag2})
vulcanus_threshold(value,threshold) = (value-(1-threshold))*(1/threshold)
vulcanus_contrast(value,c) = clamp(value,c,1)-c
vulcanus_biome_noise(seed1,scale) = multioctave_noise{persistence=0.65, seed0=map_seed, seed1, octaves=5, input_scale=vulcanus_scale_multiplier/scale}
vulcanus_scale_multiplier = slider_rescale(control:vulcanus_volcanism:frequency, 3)
vulcanus_wobble_x   = vulcanus_detail_noise{seed1=10,   scale=1/8, octaves=2, magnitude=4}
vulcanus_wobble_y   = vulcanus_detail_noise{seed1=1010, scale=1/8, octaves=2, magnitude=4}
vulcanus_wobble_large_x/y = detail_noise{seed1=20/1020, scale=1/2, octaves=2, magnitude=50}
vulcanus_wobble_huge_x/y  = detail_noise{seed1=30/1030, scale=2,   octaves=2, magnitude=800}
```

**Files:**
- Modify: `src/noise/eval/ctx.ts` (add optional Vulcanus fields: `vulcanusVolcanismFrequency`, `vulcanusVolcanismSize`, `temperatureBias`, plus computed `mapSeedNormalized`/`mapSeedSmall` defaulted from `seed0` via Task 2)
- Create: `src/noise/expressions/vulcanusHelpers.ts` (the helper closures above, curried over ctx)
- Create: `test/vulcanusHelpers.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`seedNormalized`/`seedSmall`), Task 3 (`sliderRescale`), primitives.
- Produces: `makeVulcanusHelpers(ctx) => { detailNoise, plasma, threshold, contrast, biomeNoise, scaleMultiplier, wobbleX, wobbleY, wobbleLargeX, wobbleLargeY, wobbleHugeX, wobbleHugeY }` (each `(x,y)=>number` or scalar).

- [ ] **Step 1: Extend `EvalCtx`** with the optional Vulcanus fields + defaults (control sliders default to their neutral value = 0 in slider space; `mapSeedNormalized = seedNormalized(seed0)`, `mapSeedSmall = seedSmall(seed0)`). Keep all existing Nauvis fields/defaults untouched. Run the full suite -> PASS (no Nauvis regression).
- [ ] **Step 2: Failing oracle test.** Capture `vulcanus_wobble_x`, `vulcanus_plasma(102,2.5,10,125,625)` (= `mountain_plasma`), and `vulcanus_detail_noise(837,1/40,4,1.25)` over a grid (`want("vulcanus-helpers")`, fixture `oracle-vulcanus-helpers.seed123456.json`). `test/vulcanusHelpers.spec.ts` asserts the ported closures match to the f32 floor. Run -> FAIL.
- [ ] **Step 3: Implement `vulcanusHelpers.ts`** transcribing the verbatim expressions. Run -> PASS (calibrate bound from worst residual).
- [ ] **Step 4: Commit** (`feat(vulcanus): ctx extension + shared noise helpers`).

---

### Task 6: Radial spawn geometry (`starting_direction`, angles, `*_start`, `starting_area`, `starting_circle`)

Port the seed-derived radial structure. This is what makes Vulcanus faithful *at* spawn. Depends on Tasks 2, 3, 5.

Verbatim (transcribe exactly - see file lines 162-225):
```
starting_area_radius = 0.7*0.75  (= 0.525)
starting_direction   = -1 + 2*(map_seed_small & 1)
ashlands_angle       = map_seed_normalized * 3600
mountains_angle      = ashlands_angle + 120*starting_direction
basalts_angle        = ashlands_angle + 240*starting_direction
ashlands_start  = 4 * starting_spot_at_angle{angle=ashlands_angle,  distance=170*r, radius=350*r, x_dist=0.1*r*(wobble_x+wobble_large_x+wobble_huge_x), y_dist=0.1*r*(wobble_y+wobble_large_y+wobble_huge_y)}
basalts_start   = 2 * starting_spot_at_angle{angle=basalts_angle,   distance=250,   radius=550*r, x_dist=..., y_dist=...}
mountains_start = 2 * starting_spot_at_angle{angle=mountains_angle, distance=250*r, radius=500*r, x_dist=0.05*r*(...), y_dist=0.05*r*(...)}
starting_area   = clamp(max(basalts_start, mountains_start, ashlands_start), 0, 1)
starting_circle = 1 + starting_area_radius * (300 - distance)/50   [NOT clamped]
```
(`r = vulcanus_starting_area_radius`.)

**Files:**
- Create: `src/noise/expressions/vulcanusSpawn.ts`
- Create: `test/vulcanusSpawn.spec.ts`

**Interfaces:**
- Produces: `makeVulcanusSpawn(ctx, helpers) => { startingDirection, ashlandsAngle, mountainsAngle, basaltsAngle, ashlandsStart(x,y), basaltsStart(x,y), mountainsStart(x,y), startingArea(x,y), startingCircle(x,y) }`.

- [ ] **Step 1: Failing oracle test.** Capture `vulcanus_starting_area`, `vulcanus_starting_circle`, and `vulcanus_ashlands_start` over a grid spanning spawn (e.g. -800..800 step 32 near origin) for seed 123456 (`want("vulcanus-spawn")`). Assert the ported closures match to the f32 floor. Run -> FAIL.
- [ ] **Step 2: Implement `vulcanusSpawn.ts`.** Run -> PASS. If `starting_area` diverges, the usual suspect is `map_seed_normalized`/`map_seed_small` (Task 2) or the `x_from_start` sign - cross-check against the Task 2 NOTES before touching tolerance.
- [ ] **Step 3: Commit** (`feat(vulcanus): seed-derived radial spawn geometry`).

---

### Task 7: Vulcanus climate (`temperature`, `moisture`, `aux`)

Port the three climate expressions. `temperature` depends on `vulcanus_elev`, `moisture`, `aux`, `ashlands_biome`, `mountain_volcano_spots` - so validate `moisture`/`aux` here (self-contained) and defer `temperature`'s full validation to Task 10 (after elevation + biomes exist). Depends on Task 5.

Verbatim (file lines 104-159): `vulcanus_aux`, `vulcanus_moisture` as written (multioctave sums + `vulcanus_flood_paths`/`vulcanus_flood_cracks_a`, which come from Task 9's crack helpers - so order: land Task 9's crack helpers first OR stub the flood terms and complete in Task 9). See "Ordering note" below.

**Files:**
- Create: `src/noise/expressions/vulcanusClimate.ts`
- Create: `test/vulcanusClimate.spec.ts`

**Interfaces:**
- Produces: `makeVulcanusClimate(ctx, helpers, cracks) => { temperature(x,y), moisture(x,y), aux(x,y) }`.

- [ ] **Step 1: Failing oracle test** for `vulcanus_aux` and `vulcanus_moisture` over a grid, seed 123456 (`want("vulcanus-climate")`). Run -> FAIL.
- [ ] **Step 2: Implement `moisture`/`aux`** (they consume the crack helpers from Task 9; this task is scheduled AFTER Task 9 - see Ordering note - so those are available). Run -> PASS.
- [ ] **Step 3: Wire `temperature`** transcribing the verbatim expression; leave its parity assertion to Task 10 (needs `vulcanus_elev` + biomes). Add a compile-level test that it evaluates to a finite number.
- [ ] **Step 4: Commit** (`feat(vulcanus): climate (aux/moisture/temperature)`).

---

### Task 8: Crack/flood helpers + biome system + volcano spots

The heart of the biome structure. Port the crack helpers (needed by climate + basalts), the biome-noise -> raw -> full -> clamped chain, and `mountain_volcano_spots` (uses the already-ported spot-noise). Depends on Tasks 5, 6.

Verbatim: file lines 291-389 (biomes), 306-355 (volcano spots + `vulcanus_mountains_raw_volcano`), 490-523 (`hairline_cracks`, `flood_cracks_a/b`, `flood_paths`, `flood_basalts_func`). Transcribe exactly, including `vulcanus_biome_multiscale`'s distance lerp and the `local_expressions` `starting_weights` per biome.

**Files:**
- Create: `src/noise/expressions/vulcanusCracks.ts` (`hairlineCracks`, `floodCracksA`, `floodCracksB`, `floodPaths`, `floodBasaltsFunc`)
- Create: `src/noise/expressions/vulcanusBiomes.ts` (`biomeMultiscale`, the three `*_biome_noise`, `*_raw`, `*_biome_full`, clamped `*_biome`, `mountainVolcanoSpots`, `mountainsRawVolcano`)
- Create: `test/vulcanusBiomes.spec.ts`, `test/vulcanusCracks.spec.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, spot-noise.
- Produces: `makeVulcanusCracks(ctx, helpers) => {...}`; `makeVulcanusBiomes(ctx, helpers, spawn, cracks) => { mountainsBiome(x,y), ashlandsBiome(x,y), basaltsBiome(x,y), mountainsBiomeFull, ashlandsBiomeFull, basaltsBiomeFull, mountainVolcanoSpots(x,y), mountainsRawVolcano(x,y) }`.

- [ ] **Step 1: Failing oracle test - cracks.** Capture `vulcanus_flood_paths`, `vulcanus_flood_cracks_a`, `vulcanus_hairline_cracks` (grid). Assert ported closures match. Run -> FAIL.
- [ ] **Step 2: Implement `vulcanusCracks.ts`.** Run -> PASS.
- [ ] **Step 3: Failing oracle test - biomes + volcano spots.** Capture `vulcanus_ashlands_biome`, `vulcanus_mountains_biome`, `vulcanus_basalts_biome`, `mountain_volcano_spots`, and the `_full` variants (grid spanning spawn + far). Run -> FAIL.
- [ ] **Step 4: Implement `vulcanusBiomes.ts`.** `mountain_volcano_spots` drives the spot-noise with the verbatim `density/quantity/radius/favorability` sub-expressions (file lines 317-337); reuse the resource/enemy spot-driving pattern. Run -> PASS. The `candidate_spot_count=1` + `basement_value=0` config differs from Nauvis resources - mirror it exactly.
- [ ] **Step 5: Commit** (`feat(vulcanus): cracks, radial biome system, volcano spots`).

---

### Task 9: Elevation (`vulcanus_elev` / `vulcanus_elevation`)

Assemble the elevation surface: `mountain_elevation`, `mountains_func`, `ashlands_func`, `basalt_lakes` (uses `multisample` from Task 4), and the biome-weighted `vulcanus_elev` blend. Depends on Tasks 4, 5, 8.

Verbatim: file lines 428-562. Transcribe `mountain_basis_noise`, `mountain_plasma`, `mountain_elevation`, `volcano_inverted_peak`, `vulcanus_mountains_func`, `vulcanus_ashlands_func`, `vulcanus_basalt_lakes`, and the top-level `vulcanus_elev` lerp-of-lerps + `vulcanus_elevation = max(-500, vulcanus_elev)`.

**Files:**
- Create: `src/noise/expressions/vulcanusElevation.ts`
- Create: `test/vulcanusElevation.spec.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 8.
- Produces: `makeVulcanusElevation(ctx, helpers, biomes, cracks) => { elevation(x,y) }` (and internals as needed).

- [ ] **Step 1: Failing oracle test.** Capture `vulcanus_elevation` over a grid spanning spawn + far, seed 123456 (`want("vulcanus-elevation")`). Run -> FAIL.
- [ ] **Step 2: Implement `vulcanusElevation.ts`.** `vulcanus_basalt_lakes_multisample = min` over the four `multisample(basalt_lakes, {0|1},{0|1})` corners - use Task 4's primitive. Run -> PASS to the elevation-scale floor (expect ~1e-2, calibrate from worst).
- [ ] **Step 3: Close Task 7's `temperature`.** Now that `vulcanus_elev` + biomes exist, add the deferred `vulcanus_temperature` parity assertion to `test/vulcanusClimate.spec.ts` against a captured fixture. Run -> PASS.
- [ ] **Step 4: Commit** (`feat(vulcanus): elevation surface (mountains/ashlands/basalt-lakes blend)`).

---

### Task 10: Vulcanus tile catalog + argmax + colors

Choose the placed tile per position (lava/basalt/ashland/... ) and paint `map_color`, validated against the `get_tile` oracle with Space Age. The tile set + autoplace conditions come from the Vulcanus tile prototypes (research step), not the map-gen file.

**Files:**
- Research: read `~/GitHub/factorio-data/space-age/prototypes/tile/*.lua` (Vulcanus tiles + their autoplace/`map_color`)
- Create: `src/noise/tiles/vulcanusCatalog.ts` (tile entries: id, `map_color`, condition expressions over elevation/biomes/temperature/moisture/aux)
- Modify: `src/noise/tiles/resolve.ts` only if the argmax needs a planet param (prefer passing the catalog in, no Nauvis change)
- Modify: `test/oracle/capture.ts` (`captureVulcanusTileNames()` reusing the `get_tile` path with `spaceAge, planet:vulcanus`)
- Create: `test/fixtures/oracle-vulcanus-tile-names.seed123456.json`
- Create: `test/vulcanusTiles.spec.ts`

**Interfaces:**
- Consumes: Tasks 7, 8, 9 (climate/biomes/elevation), the existing tile resolver.
- Produces: `resolveVulcanusTile(x, y, fields) => { tileId, color }`.

- [ ] **Step 1: Research the tile set.** Read the Vulcanus tile prototypes; record each tile's `map_color` and the noise condition that selects it (they key off `vulcanus_elevation`, the `*_biome` values, temperature/moisture/aux). Write the table into `docs/noise/vulcanus-tiles-NOTES.md`.
- [ ] **Step 2: Capture tile names.** `captureVulcanusTileNames()` over a grid spanning several biomes near spawn (seed 123456), reusing the `get_tile` chunk-generate path from the Nauvis M2 oracle. Run capture -> fixture (BLOCKED handling as Task 1).
- [ ] **Step 3: Failing test.** `test/vulcanusTiles.spec.ts` asserts `resolveVulcanusTile` returns the same tile id as the fixture for every position (target: 100% agreement, as Nauvis M2 achieved; if <100%, the diff points at a mis-ported field - do not fudge). Run -> FAIL.
- [ ] **Step 4: Implement `vulcanusCatalog.ts` + resolve** from the researched conditions. Run -> PASS.
- [ ] **Step 5: Commit** (`feat(vulcanus): tile catalog + argmax tile colors`).

---

### Task 11: Planet dispatch, terrain render path, UI wiring, checkpoint

Thread `planet` through the render request/worker so the client preview renders Vulcanus when `selectedPlanet === "vulcanus"`, wire it to the existing `App.vue` selector, and verify the full render at the checkpoint.

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (add `planet: Planet`)
- Modify: `src/noise/preview/elevationRender.worker.ts` (dispatch terrain/elevation on planet -> Vulcanus resolver)
- Modify: `src/noise/preview/renderTerrain.ts`, `renderElevation.ts` (planet-aware field selection)
- Modify: the client preview panel/component that issues the render (wire `selectedPlanet`; reuse `src/model/planets.ts`)
- Create: `test/vulcanusRender.spec.ts` (render a small Vulcanus tile, assert non-empty + a known-biome pixel color)

**Interfaces:**
- Consumes: Task 10 (`resolveVulcanusTile`), `src/model/planets.ts` (`Planet`).
- Produces: a Vulcanus terrain/elevation image via the existing tiling pipeline.

- [ ] **Step 1: Failing test.** `test/vulcanusRender.spec.ts` requests a 128x128 Vulcanus terrain render at seed 123456 and asserts the buffer is populated and a near-spawn pixel matches the expected biome color from Task 10. Run -> FAIL.
- [ ] **Step 2: Add `planet` to the render request + worker dispatch**; route Vulcanus terrain/elevation to the Vulcanus resolver, Nauvis unchanged (default). Run -> PASS. Confirm the Nauvis render tests still pass (`pnpm vp test`).
- [ ] **Step 3: Wire the UI** so selecting Vulcanus in the existing planet selector drives the client render (single source of truth = `selectedPlanet`). Manual check via `pnpm vp dev` (or a component test): selecting Vulcanus renders Vulcanus terrain.
- [ ] **Step 4: Checkpoint verification.** Run `pnpm run verify`. Then browser-measure the Vulcanus render time (seed 123456, 1024^2, tiled) alongside the Nauvis baseline, and visually cross-check the client Vulcanus against a `preview-service` Vulcanus render of the same seed. Record results + the go/no-go on V2/V3 in `docs/noise/client-preview-ROADMAP.md` (check off "Non-Nauvis planets" partial: Vulcanus terrain done).
- [ ] **Step 5: Commit** (`feat(vulcanus): planet-dispatched terrain render + UI wiring (V1 checkpoint)`).

---

## Ordering note

Dependency-respecting order: **1 → 2 → 3 → 4 → 5 → 6 → 8 → 7 → 9 → 10 → 11.** Task 8 (cracks) lands before Task 7 (climate) because `moisture`/`aux` consume the crack helpers; `temperature`'s parity closes in Task 9 once elevation exists. Tasks 1-4 are independent of each other and can be parallelized; 5 needs 2+3; 6 needs 5; 8 needs 6; the rest is linear.

## Out of scope for V1 (do not build here)

- Resources (V2), cliffs (V3), demolisher/enemy overlay (skipped - the only Voronoi user), trees (Vulcanus has effectively none in preview terms), decoratives.
- Any `src/codec/**` change. Any Fulgora/Gleba/Aquilo work.

## Self-review notes

- Every task ends in an independently testable deliverable gated by the oracle or the existing suite.
- The three genuine unknowns (seed vars, `multisample`, tile conditions) are isolated into their own RE tasks (2, 4, 10-step-1) with explicit "STOP and report if no exact match" guards - no task assumes a formula it hasn't validated.
- No task references a symbol not produced by an earlier task's Interfaces block. `slider_rescale` extraction (Task 3) is the only refactor of existing code and is behavior-preserving (regression-tested).

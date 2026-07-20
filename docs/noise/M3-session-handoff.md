# M3 resources - session handoff (2026-07-19, late)

Paste-ready context for resuming in a fresh session. Working branch:
**`feat/m3-resources`** (off `main`). This doc is maintained live; the durable RE
finding also lives in `docs/noise/random-penalty-NOTES.md`.

## Where we are

Milestone 3 = client-side resource patch overlay. Brainstormed + spec'd. The first
spike (`random_penalty`) is **DONE, tested, and committed** on `feat/m3-resources`.
Next session starts at **writing-plans for M3a** (regular patches).

### DONE this session (committed on feat/m3-resources)
- Spec (commit aee1ef8).
- `random_penalty` spike (next commit): `src/noise/randomPenalty.ts`,
  `test/randomPenalty.spec.ts` (6 tests, oracle-validated < 1e-6),
  `test/fixtures/oracle-random-penalty.seed123456.json`, `captureRandomPenalty` in
  `test/oracle/capture.ts`, and `docs/noise/random-penalty-NOTES.md`. Full suite
  632/632 green, `pnpm vp check` clean.

### M3a plan WRITTEN: `docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md`
10 tasks (catalog -> math -> oracle -> core field -> resolve -> controls -> render
-> worker -> UI -> eyeball). The ONE risk is isolated to **Task 4**: how the game
batches `random_penalty` when evaluating spot quantities in selection. Task 3
captures a pure-regular oracle (probe with `has_starting_area_placement=0`,
`regular_patch_set_count=1`) so Task 4's composition cannot pass wrong. Primary
hypothesis: singleton-per-spot (U = draw0 seeded from the spot's own x,y, fits
selectSpots' per-spot closure); fallback = batch all region spots. Resolve against
the oracle in Task 4, record the winner in random-penalty-NOTES.md.

### M3a EXECUTION PROGRESS (on feat/m3-resources)
- **Task 1 DONE** (commit 4e7c4d8): `src/noise/resources/resourceCatalog.ts` - 6 param sets.
- **Task 2 DONE** (103e45f): `src/noise/resources/resourceMath.ts` - distance/amplitude
  local functions + basement_value; added `startingRqFactor` to the catalog.
- **Task 3 DONE** (5b1d879): pure-regular oracle fixture
  `test/fixtures/oracle-resource-regular.seed123456.json` +
  `captureResourceRegular`. Samples the WHOLE of region (1,1) at stride 16 (patches
  are sparse - a handful per 1024^2 region - so a local window sampled only basement).
- **Task 4 DONE** (238acd7 core + 2026-07-20 precision fix, uncommitted): `src/noise/resources/regularPatches.ts`
  (`makeRegularPatches`). **The M3a unknown is RESOLVED**: random_penalty inside
  spot selection is a BATCH over all skip-set accepted spots in acceptance order
  (seeded from spot[0], streamed) - NOT per-spot. Added `quantityBatch` to
  `selectSpots`. Oracle error dropped 3e-1 -> ~2e-3.
  - **Residual RESOLVED (2026-07-20)**: it was NOT the trim boundary - it was
    exact `Math.cbrt` where the game's f32 noise machine uses its **fastapprox `pow`**
    (Mineiro fastlog2/fastpow2). Extracted `src/noise/fastApprox.ts` (`fastCbrt`),
    routed the blob-amplitude cbrt (resourceMath.ts) and the cone radius/peak/slope +
    spot quantity (regularPatches.ts, all f32) through it. New accuracy: **abs error
    < 0.7 units everywhere**, rel < 1e-3 in patch interiors, up to ~9e-3 only at
    cone-edge zero-crossings (the M1/Island f32 floor). `test/regularPatches.spec.ts`
    **un-skipped**, asserts `worstAbs < 1.0 && worstRel < 1e-2`. Full instrumentation
    trail + the decomposition proof in docs/noise/random-penalty-NOTES.md. Suite
    646/646 green (was 642 + 4 skipped), `vp check` clean. **Uncommitted** - Eric to
    review/commit.
- **Tasks 5-10 DONE** (2026-07-20, committed on branch):
  - T5 `src/noise/resources/resolveResource.ts` - order-priority overlay winner
    (`makeResourceResolver`/`pickWinner`; skip_span 6/offset patchSetIndex; "b">"c" then index).
  - T6 `src/model/resourceReads.ts` - `readResourceControls` (levers from preset, default 1/1/1).
  - T7 `src/noise/preview/renderResources.ts` - overlay onto terrain ImageData.
  - T8 `elevationRenderRequest.ts` - `view:"resources"` (terrain then overlay) + `resourceControls` field.
  - T9 `elevationPreviewCtx.ts` (+resourceControls) & `ElevationPreviewPanel.vue` - Resources toggle
    (Nauvis-gated like Terrain).
  - T10 eyeball: headless 1024px render confirms all 6 ore blobs over terrain, spawn cleared
    (scratchpad PNG, sent to Eric). In-app live-slider eyeball still Eric's to do.
  - ROADMAP M3a marked done. Full suite 661/661, `vp check` clean, all committed.

**M3a COMPLETE.** Remaining M3: M3b (starting patches + `max(starting,regular)`), M3.5 (per-tile
stipple).

> **STATUS UPDATE (2026-07-20, late): M3a + M3b are MERGED to `main`, pushed to
> `origin/main`, and DEPLOYED live** (Cloudflare Pages -> `map.factorygamefan.com` /
> `factorygamefan.com`). The `feat/m3-resources` branch was fast-forwarded into
> `main` (tip `0131aa8`). References below to the branch being "unmerged/unpushed"
> or "nothing pushed/deployed" are superseded by this. Next work: **M3.5** (per-tile
> placement stipple - un-RE'd entity-placement RNG) + the oil `random_probability`
> follow-up (see the ROADMAP for the caveat that the oil probability factor alone
> regresses the render without M3.5's roll).

### M3b (starting patches) COMPLETE (2026-07-20, tip 4cf6675)

Shipped: `src/noise/resources/startingPatches.ts` (`makeStartingPatches` - the
near-spawn guaranteed patches for iron/copper/coal/stone) and
`src/noise/resources/resourcePatches.ts` (`makeResourcePatches` -
`all_patches = max(starting, regular)` for the four solids; oil/uranium delegate
unchanged to the regular field since they have no starting placement).
`resolveResource.ts` threads the elevation ctx (`segmentationMultiplier`,
`waterLevel`, `startingLakePositions`) through so the starting favorability's lake
mask has what it needs. `selectSpots` gained a `favorabilityBatch` option
(spotSelection.ts) mirroring the existing `quantityBatch`, plus the hard-target
`coneScale` shrink now goes through `fastCbrt` instead of `Math.cbrt`. Oracle
fixture `test/fixtures/oracle-resource-starting.seed123456.json`
(`has_starting_area_placement=1`); `test/resourcePatches.spec.ts` validates near-spawn
points to well under 1.0 absolute error, using a combined `abs<1.0 OR rel<1e-2`
tolerance so the pre-existing far-field `basisNoise` f32 floor (~5e-4 relative on
~1e4-magnitude points, from the M3a fixture's far ring) doesn't mask real
near-spawn bugs. Full suite green throughout, `vp check` clean, all committed.
Headless full-view eyeball (Task 7) confirms iron/copper/coal/stone clustering
tightly around spawn with oil appearing as a sparse far-out dot, spawn not bare.

**Two findings worth being loud about, both recorded in
`docs/noise/spot-noise-NOTES.md`** (and the `factorio-data-version-hazard` Claude
memory note for the first):

1. **Stale data-dump hazard.** The M3b plan was drafted against
   `~/Downloads/factorio 4/data`, which is Factorio **2.0.77** - stale. The app and
   headless oracle both target **2.1.11**, and `starting_patches`
   (`core/prototypes/noise-functions.lua`) changed materially between those
   versions: `starting_resource_placement_radius` 120->150, `region_size`
   `radius*2`->`radius*3` (300->450), `suggested_minimum_candidate_point_spacing`
   32->48, `maximum_spot_basement_radius` a flat `128`->the formula
   `2*starting_rq_factor*starting_area_spot_quantity^(1/3)`, and the favorability
   term dropped `+ random_penalty_at(0.5, 1)` in favor of a deterministic
   `* origin_excluder` (`distance > 40`) with an explicit `min(1, ...)` wrapper on
   the distance term. `regular_patches` did NOT change between 2.0.77 and 2.1.11,
   which is why M3a was unaffected and this only bit M3b. The implementer caught it
   by cross-checking the plan's assumed constants against the has_starting=1 oracle
   and the game's own bundled Lua before trusting the plan's numbers.
   **The authoritative 2.1.11 source is the Steam app's own bundled data**:
   `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data/core/prototypes/{noise-functions,noise-programs}.lua`
   - it matches the oracle binary's version by construction (same install). Prefer
   it over any separately-downloaded data dump for noise/autoplace RE; verify the
   dump's `base/info.json` `version` field before trusting it if one must be used.
2. **`elevation_nauvis` coupling.** The starting favorability's lake mask
   (`starting_resources_lake_mask`) reads the map's `elevation` PROPERTY, which on
   the default Nauvis map resolves to `elevation_nauvis` - not the `elevation_lakes`
   literal an earlier draft assumed (a plausible guess, since `elevation_lakes` is
   the smaller/simpler tree and the *variable* is literally named
   `starting_resources_lake_mask`). `makeStartingPatches` hardcodes
   `makeElevationNauvis`, which is correct for the Nauvis-gated resources overlay
   this app renders; generalizing to Lakes/Island starting elevation is deferred
   (tracked in the ROADMAP) until the resolver needs a non-default map type for
   resources.

- **Post-M3a bug FIXED (2026-07-20, commit d0cc0e3): crescent-shaped patches near spawn.** Eric
  spotted a lake-sized iron crescent at seed 2883961880. Root cause (systematic-debugging, decomposed
  field into spotField+blob): `selectSpots` emitted spots with quantity <= 0, which the game skips
  (spot-noise-NOTES.md line 320 "non-positive quantity or radius is skipped"). Near spawn, regular
  density fades to 0 inside the 120-tile fade-in, so those spots have q=0; rendering one is
  catastrophic because `radius = rq*fastCbrt(0)` is a tiny positive -> `peak = 3*0/(pi*r^2) = 0`,
  `slope = 0` -> a FLAT cone=0 disk across the whole 128-tile cull radius, which beats the deep
  basement, so the blob term lifts parts of it >0.5 -> crescent. Fix: skip `q <= 0` in selectSpots'
  trim loop (before accumulation - not emitted, not counted toward target). Generic spot_noise, so
  it also protects M3b/enemies. Oracle unaffected (region 1,1 is far from spawn). 3 regression tests
  in spotSelection.spec. Iron footprint at that seed dropped 16462px crescent -> 2855px compact blobs.

Perf note: the 1024² resources render took ~60s headless (single-threaded node); in-app it runs
in the worker so it won't block the UI, but it's slow - a candidate for later optimisation
(the terrain resolver dominates; the 6 resource fields add region-cached spot work on top).

Full suite: 646 passed / 0 skipped. `vp check` clean. (Later merged + pushed +
deployed - see the STATUS UPDATE banner above; this line reflects the point in time
before the merge.)
The 2026-07-20 fastCbrt precision fix (fastApprox.ts + resourceMath.ts + regularPatches.ts
+ resourceMath.spec.ts + regularPatches.spec.ts un-skip) is **uncommitted** on the branch.

## Decisions locked (in the spec)

Spec: `docs/superpowers/specs/2026-07-19-milestone3-resources-design.md` (committed,
aee1ef8). Key decisions:

- **Full scope, all 6 resources** (iron/copper/coal/stone/uranium/crude-oil),
  regular + starting patches.
- **Oracle-validate probability + richness** point-by-point (M2 rigor).
- **Solid-footprint render**: opaque where `clamp(probability,0,1) >= 0.5`.
- **Order-priority overlap** (order "b" beats "c"; game-faithful), not richest-wins.
- **Single worker render pass** (`view: "resources"`), one overlay toggle (no
  per-resource checkboxes).
- **Per-tile placement roll (stipple) deferred to M3.5** (needs a separate,
  un-RE'd entity-placement RNG).
- **Sequencing**: (0) random_penalty spike FIRST -> (M3a) regular patches ->
  (M3b) starting patches. Split into two build plans, not one.

## Spike status: random_penalty - SOLVED

Reverse-engineered from the non-stripped Factorio 2.1.11 binary via
`lldb -b -o "disassemble --name '_ZNK15NoiseOperations13RandomPenalty3runER10NoiseCache'"`
(lldb disassembles by mangled name WITH source-line annotations - the fastest
oracle here; objdump range flags are broken, as the memory notes warned).

**The algorithm** (`NoiseOperations::RandomPenalty::run`, RandomPenalty.cpp):

```
output[i] = source[i] - amplitude * (taus88_next() / 2^32)      // U in [0,1)
```

- **word = max(341, 0x3FBE2C + 7919*trunc(x0) + 7907*trunc(y0 + seed))**  (u32 math)
  - Same RNG family/constants as spot_noise (base 0x3FBE2C, primes 7919/7907, 341
    clamp). NO map_seed dependence. `seed` is folded into y (y+seed) BEFORE trunc.
  - `trunc` = fcvtzs (toward zero). x0,y0 = the **first batch position** only.
- taus88 state s1=s2=s3=word (the exact taus88 already in `src/noise/spotSelection.ts`).
- **Batch semantics**: it is a BATCH op. Seeded once from position[0], then the
  taus88 stream is consumed across the batch, **processed last element -> first**
  (index counts down). `source <= 0` outputs source unchanged and consumes NO draw
  ("source must be > 0" guard).
- This batch/order dependence is real (verified: same tile gives different U in
  different batches), so **a bare `calculate_tile_properties` probe is NOT a
  faithful per-tile oracle** for random_penalty in isolation - same lesson as M2's
  get_tile. It matters for how the primitive composes inside spot expressions.

**Verified**: `src/noise/randomPenalty.ts` reproduces the game's values to < 1e-6
(oracle fixture, 5 configs incl. odd seeds + the source<=0 guard). Scratch verifier
already deleted.

Wrappers (`core/prototypes/noise-functions.lua`):
- `random_penalty_at(v, seed)` = random_penalty{source=v, amplitude=v}
- `random_penalty_between(from, to, seed)` = random_penalty{source=to, amplitude=to-from}
- `random_penalty_inverse(seed, penalty)` = random_penalty{source=1, amplitude=1/penalty}
- `1 - random_penalty{...}` shows up too. NB comment: "source must be > 0".

## Spike follow-through - all DONE (see "NEXT" at top for what remains)

randomPenalty.ts built (reuses shared `src/noise/taus88.ts`), fixture captured,
spec green, notes written, scratch deleted, ready to commit. The remaining M3 work
is the two build plans (M3a regular, M3b starting) - start at writing-plans for M3a.

## Ground truth / recipes

- Factorio bin present: `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio` (non-stripped, has NoiseOperations symbols).
- **Authoritative Lua source (use this one): `~/GitHub/factorio-data`** - a local
  clone of the official `wube/factorio-data` GitHub repo, with per-version git tags.
  `git -C ~/GitHub/factorio-data checkout 2.1.11` gives the game Lua data exactly
  matching the oracle binary's version; `git pull` fetches newer versions. Key files:
  `core/prototypes/{noise-functions,noise-programs}.lua`,
  `core/lualib/resource-autoplace.lua`, `base/prototypes/entity/resources.lua`.
  Verify `base/info.json`'s `"version"` matches the binary (`factorio --version`)
  before trusting it - `master` may sit a few commits past the latest tag.
  (Secondary, also version-correct: the Steam app's bundled
  `.../factorio.app/Contents/data/{core,base}/prototypes/*.lua`.)
- **`~/Downloads/factorio 4/data` is STALE (Factorio 2.0.77, confirmed via its
  `base/info.json` `"version"` field) - do NOT treat it as ground truth for 2.1.11
  RE.** `starting_patches` changed between 2.0.77 and 2.1.11 (see the M3b section
  above); this dump caused the M3b plan to specify wrong starting-patch constants.
  `regular_patches` happened not to change, so M3a was unaffected - but that was
  luck, not a property of the dump. Always check `base/info.json`'s version before
  trusting any downloaded data dump, and prefer `~/GitHub/factorio-data` outright.
  API JSON: `~/Downloads/factorioluaapi/`.
- Oracle harness: `test/oracle/oracle.ts` (`sampleExpression`), captures via `node --experimental-strip-types test/oracle/capture.ts`.
- Disasm a symbol: `lldb -b -o "disassemble --name '<mangled>'" "$BIN"`.
- Tests: `pnpm vp test`, single `pnpm vp test test/<f>.spec.ts`, lint `pnpm vp check --fix`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: <url>`. Hyphens, not em/en dashes. Commit/push only when Eric asks.

## Per-resource params (from resources.lua) - for M3a/M3b

All share seed1=100 (default), region_size=1024 (regular). Skip mechanism: the 6
share ONE candidate stream, partitioned by skip_span=6 / skip_offset=patch_set_index
(init order: iron0 copper1 coal2 stone3 crude-oil4 uranium5). Starting set: only
iron/copper/coal/stone, region_size=240, skip_span=4.

| resource | base_density | reg_rq_mult | start_rq_mult | cand_spot_count | notes |
|---|---|---|---|---|---|
| iron-ore | 10 | 1.10 | 1.5 | 22 | order b, starting yes |
| copper-ore | 8 | 1.10 | 1.2 | 22 | order b, starting yes |
| coal | 8 | 1.0 | 1.1 | 21(def) | order b, starting yes |
| stone | 4 | 1.0 | 1.1 | 21(def) | order b, starting yes |
| uranium-ore | 0.9 | 1 | - | 21(def) | order c, base_spots_per_km2=1.25, spot_size 2..4, NO starting |
| crude-oil | 8.2 | 1 | - | 21(def) | order c, base_spots_per_km2=1.8, random_probability=1/48, additional_richness=220000, spot_size 1..1, NO starting |

map_color (0-255 scale in render): iron {106,134,148}, copper {205,99,55}, coal {0,0,0},
stone {176,156,109}, uranium {0,179,0}, crude-oil {199,51,196}. (Cross-check byte-exact.)

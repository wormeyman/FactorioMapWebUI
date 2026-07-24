# Vulcanus in the client-side preview - design

Date: 2026-07-23
Status: approved (brainstorm), pending implementation plan

## Problem

The client-side noise preview (`src/noise/`, the in-browser reimplementation of
Factorio's map generation) is Nauvis-only. The `preview-service` container
already renders all five Space Age planets photo-realistically by running the
real game, so this is a **UX/offline/interactive-overlay** improvement, not a
correctness gap. This design covers extending the client-side preview to
**Vulcanus**, the first non-Nauvis planet.

Vulcanus is the deliberate first pick: of the four Space Age planets it reuses
the most existing machinery and carries the least new-primitive risk (see
Feasibility). Fulgora, Gleba, and Aquilo are out of scope here; each is a
separate future spec/plan/build cycle.

## Feasibility (established during brainstorm)

- **Source is available.** `~/GitHub/factorio-data` (tag 2.1.11) includes the
  `space-age/` DLC data, including
  `space-age/prototypes/planet/planet-vulcanus-map-gen.lua` (923 lines, ~40
  named noise-expressions). The "hand-port the Lua expressions" strategy that
  cracked Nauvis applies unchanged.
- **No new black-magic primitive.** Vulcanus uses `voronoi_cell_id` exactly once
  (line 900), and only for `demolisher_territory_radius` - the enemy-territory
  system, not terrain or resources. Skipping the demolisher overlay (see
  Non-goals) means Vulcanus terrain + resources need **zero `VoronoiNoise`**.
  (Fulgora and Aquilo build terrain on Voronoi - they are what will force that
  primitive later.)
- **Primitive gaps are small.** `RandomPenalty` is already ported
  (`src/noise/randomPenalty.ts`). The only likely gap is `Multisampling`
  (`multisample()`, used a handful of times), rated "small" in the roadmap.
  Everything else Vulcanus calls - `spot_noise`, the climate multioctave ops,
  `basis_noise`, `clamp`/`min`/`max`/`lerp` arithmetic - is already ported.
- **Radial biome geometry is seed-derived, not runtime.** Vulcanus's distinctive
  structure is a radial arrangement of ashlands / mountains / basalts biomes by
  angle + distance from spawn (`vulcanus_*_angle`, `vulcanus_*_start`,
  `vulcanus_starting_direction`, `vulcanus_starting_area_radius`). These are all
  declared as **noise-expressions**, i.e. computable from the seed client-side.
  This means we do **not** need to RE the engine's runtime spawn placement (the
  thing that limited Nauvis elevation to "far-from-spawn faithful"). Vulcanus
  should be faithful *at* spawn, which is exactly where its biomes matter.
  (Risk: this rests on `vulcanus_starting_direction` being purely seed-derived -
  V1's first task validates that against the oracle.)

## Approach

**Approach A - extend the Nauvis evaluator, hand-port Vulcanus's expressions,
phased**, with an explicit checkpoint after the terrain phase.

Chosen over (B) building a noise-DSL parser first - too large a detour before any
Vulcanus pixels, uncertain payoff, front-loads risk - and over committing to full
parity up front. The phased hand-port is the proven, low-risk, every-step-verifiable
method; the V1 checkpoint honors that this is polish over an already-working server
preview, so parity past V1 is re-decided with real cost data in hand.

## Architecture

The client renderer is already decomposed along the seams Vulcanus needs.
Vulcanus is added **alongside** Nauvis at each seam, selected by planet - not
grafted onto Nauvis code.

- **Expressions** (`src/noise/expressions/`): new Vulcanus named-expression
  closures (`vulcanusElevation.ts`, `vulcanusBiomes.ts`, `vulcanusClimate.ts`,
  `vulcanusShared.ts`), hand-ported 1:1 from `planet-vulcanus-map-gen.lua`, each
  oracle-validated to ~1e-6 (the fastapprox floor).
- **Tiles** (`src/noise/tiles/`): a Vulcanus tile catalog (lava, basalt, ashland
  variants, ...) run through the existing argmax `resolve.ts` to produce
  `map_color` per tile.
- **Subsystem catalogs** (`src/noise/resources/`, `src/noise/cliffs/`): a
  Vulcanus resource catalog (tungsten, calcite, coal, sulfuric-acid geysers,
  volcano spots) and cliff catalog, reusing the existing `spot_noise` / field /
  render pipeline.
- **Planet dispatch**: the current client render path is implicitly Nauvis
  (terrain keys off `mapType`; climate/tiles are Nauvis). We introduce a
  **planet dimension** into the render request + worker so `renderTerrain` /
  `renderResources` / `renderCliffs` / etc. dispatch on planet. The app already
  holds `selectedPlanet` in `App.vue` (today feeding only the preview-service
  `PreviewPanel`); the client preview reuses that single source of truth rather
  than introducing a second planet selector.
- **Reused wholesale, untouched**: `src/noise/eval/` primitives, `basisNoise`,
  `spotSelection`, `preview/tiling.ts` + the worker pool, the view-toggle UI,
  `randomPenalty.ts`.

The map-exchange codec is **not touched**. The exchange string does not encode a
planet (confirmed: `src/codec/mapExchangeString.ts` has no planet field), so this
is purely a render-layer + UI-selection change with no byte-exactness invariant at
risk.

## Phasing

### V1 - terrain & biomes (then CHECKPOINT)

- Resolve the exact Vulcanus expression dependency closure (which shared/base
  expressions it pulls in beyond the Vulcanus file).
- Validate `vulcanus_starting_direction` (and the angle/radius family) is purely
  seed-derived against the oracle. If it secretly needs runtime spawn data, fall
  back to the Nauvis far-from-spawn posture and note the fidelity limit.
- Port `vulcanus_elevation` and its dependency chain (`vulcanus_detail_noise`,
  `vulcanus_plasma`, `vulcanus_threshold`, `vulcanus_contrast`, the biome-noise
  expressions).
- Port the radial biome system (ashlands / mountains / basalts by angle +
  distance from spawn).
- Port Vulcanus climate (`vulcanus_temperature` / `_moisture` / `_aux`) - same op
  family as Nauvis climate, different tree.
- Build the Vulcanus tile catalog + run the argmax to colors.
- Port/verify the `Multisampling` primitive.
- Wire planet dispatch so the client preview renders Vulcanus when
  `selectedPlanet === "vulcanus"`.

**CHECKPOINT:** a recognizable Vulcanus surface renders in the client preview,
oracle-validated. Decide whether V2/V3 parity is worth continuing given the
preview-service already renders Vulcanus correctly.

### V2 - resources

Vulcanus resource overlays (tungsten, calcite, coal, sulfuric-acid geysers,
volcano spots) reusing the spot-noise resource pipeline and a Vulcanus resource
catalog.

### V3 - cliffs + polish

Vulcanus cliffs; wire the `control:vulcanus_volcanism` slider; composite Vulcanus
layers into the `all` view.

## Validation

Identical method to Nauvis:

- Every ported named expression is diffed against the game via
  `calculate_tile_properties`, using the running-game oracle **with Space Age
  enabled**, to ~1e-6.
- Tile-color argmax is validated against the `get_tile` oracle (the same
  mechanism that gave Nauvis 100% tile-selection agreement).
- The `preview-service` container render of Vulcanus is the visual cross-check
  oracle for the whole composite.

## Non-goals

- **Demolishers / enemy overlay.** Deferred, likely skipped entirely. This is the
  only Vulcanus consumer of `voronoi_cell_id`, and demolishers are roaming worms,
  not a map-preview autoplace footprint (the game's own preview does not chart
  them as bases). Skipping them keeps `VoronoiNoise` out of the Vulcanus port.
- **Trees.** Vulcanus has none.
- **Codec / map-exchange-string changes.** None - planet is not encoded there.
- **Fulgora / Gleba / Aquilo.** Separate future efforts; those are what force
  `VoronoiNoise` and further primitives.

## Risks

- **`vulcanus_starting_direction` seed-derivation** (see Feasibility). The
  at-spawn-fidelity claim rests on it; V1's first task confirms it. Fallback is
  the Nauvis far-from-spawn posture.
- **Expression volume.** ~40 named expressions is real hand-porting *labor* (the
  oracle makes it low-*risk*, not low-*effort*). The V1 checkpoint exists to price
  this before committing to V2/V3.
- **Base-expression dependencies.** Vulcanus may reference shared/base noise
  expressions beyond its own file; V1 scoping resolves the exact dependency
  closure first.
- **Perf.** Another full expression tree per tile; the existing tiling/worker pool
  should absorb it, but measure the Vulcanus render cost at the V1 checkpoint
  alongside the Nauvis baseline.

## Module layout (additions)

```
src/noise/
  expressions/
    vulcanusElevation.ts    # V1
    vulcanusBiomes.ts       # V1 (radial ashlands/mountains/basalts)
    vulcanusClimate.ts      # V1 (temp/moisture/aux)
    vulcanusShared.ts       # V1 (shared helpers: detail_noise, plasma, threshold, contrast)
  tiles/
    (Vulcanus tile catalog entries)   # V1
  eval/
    (Multisampling primitive)         # V1 if not already present
  resources/
    (Vulcanus resource catalog)       # V2
  cliffs/
    (Vulcanus cliff catalog)          # V3
```

Planet dispatch threads through `preview/elevationRenderRequest.ts`,
`preview/elevationRender.worker.ts`, and the `render*.ts` renderers.

# Milestone 3 - client-side resource patches (design)

Point-in-time design record (like the other docs under `docs/superpowers/specs/`),
written 2026-07-19 after Milestone 2 (climate terrain colors) shipped. Not a
living doc.

## Goal

Overlay all six Nauvis resources - iron-ore, copper-ore, coal, stone, uranium-ore,
crude-oil - on the client-side terrain preview, faithful to the game's
`resource_autoplace_all_patches` noise function, responding to the existing
`control:<resource>:frequency|size|richness` sliders the app already round-trips.

Correctness bar (unchanged from M1/M2): per-expression agreement to ~1e-5 against
the game via the headless oracle. Resources add a new oracle path - the M2
`get_tile` path validates terrain tiles, not resource autoplace - that reads each
resource's autoplace `probability_expression` and `richness_expression` through
`calculate_tile_properties` and diffs our port point-by-point.

Non-goal for M3: the per-tile entity-placement roll (the deterministic RNG that
turns a probability in [0, 1] into placed/not-placed for an individual tile).
That is a separate, not-yet-reverse-engineered mechanism; it is deferred to a
follow-on spike (M3.5). See "Deferred: per-tile placement roll" below.

## Scope decisions (settled during brainstorming)

- **Full patch model, all six resources** - but sequenced across two plans
  preceded by a spike (see "Sequencing" below). The end state ports the complete
  `max(starting_patches, regular_patches)`, including the near-spawn starting
  patches (guaranteed iron/copper/coal/stone at spawn), not just the whole-map
  regular patches.
- **Oracle-validate probability + richness point-by-point** (M2 rigor), not just
  visual faithfulness. `random_penalty` is validated standalone first.
- **Solid-footprint render.** A pixel is "ore" where `clamp(probability, 0, 1) >=
  0.5`, drawn as opaque `map_color`. No per-tile stipple in M3.
- **Order-priority overlap.** Where two patches overlap, the winner is chosen by
  the game's autoplace order (order `"b"` resources beat order `"c"`), matching
  `resources.lua`'s note that oil is `"c"` so it "won't get placed if another
  resource is already there." Not richest-wins.
- **Single worker render pass.** The overlay is composited onto the terrain image
  inside the render worker; one `ImageData` returns. A `view: "resources"` request
  renders terrain then overlays.
- **One overlay toggle** (all six at once), like the existing Terrain toggle.
  Per-resource visibility checkboxes are deferred.

## Sequencing (three units of work, not one plan)

Settled during brainstorming: de-risk the unknown first, then build in two
tighter plans rather than one large one.

0. **`random_penalty` spike (standalone, first).** Reverse-engineer and
   oracle-validate the `random_penalty` primitive in isolation - the way basis and
   spot RNGs were cracked - BEFORE writing the M3a plan. It gates correct spot
   quantities, so if it is harder than "small", we learn that before committing to
   the build. Deliverable: `src/noise/randomPenalty.ts` + committed fixture,
   validated to ~1e-5. If the spike surfaces surprises, revisit this design.
1. **M3a - regular (whole-map) patches, all six.** The bulk of the visible map:
   `regular_patches` only, all six resources, region cache, order-priority
   resolver, solid-footprint render, the Resources toggle, and the probability +
   richness oracle path. Ships and validates on its own. The three "pin against
   the oracle" unknowns that touch regular patches (`distance` origin/offset; the
   shared candidate-stream cache key with mismatched `candidate_spot_count`) are
   resolved empirically inside this plan.
2. **M3b - starting patches.** Adds `starting_patches` and the outer
   `max(starting, regular)`, where most of the subtlety lives: the
   `elevation_lakes` favorability coupling, `starting_modulation`, and the 240-tile
   starting region/skip set. Resolved empirically against the oracle. Layered on
   top of the shipped M3a machinery.

Each unit is planned and executed on its own (spike -> `writing-plans` for M3a ->
`writing-plans` for M3b). The rest of this document is the shared design both plans
draw from.

## Background: how the game places resource patches

Every resource's `autoplace` is produced by `resource_autoplace_settings` in
`core/lualib/resource-autoplace.lua`, which emits a `probability_expression` and
`richness_expression` built on one shared noise function,
`resource_autoplace_all_patches` (`core/prototypes/noise-functions.lua`). The
per-resource knobs come from `base/prototypes/entity/resources.lua`.

Structure of `resource_autoplace_all_patches`:

```
all_patches = if(has_starting_area_placement == 1,
                 max(starting_patches, regular_patches),
                 regular_patches)

regular_patches  = spot_noise{region_size=1024, candidate_spot_count, skip_span=regular_patch_set_count,
                              skip_offset=regular_patch_set_index, hard_region_target_quantity=0,
                              density=regular_density_at(distance), quantity=regular_spot_quantity_expression,
                              radius=min(32, regular_rq_factor * quantity^(1/3)), favorability=1,
                              basement_value, maximum_spot_basement_radius=128}
                 + (blobs0 + basis_noise{input_scale=1/64, output_scale=1.5} - 1/3) * regular_blob_amplitude_at(distance)

starting_patches = spot_noise{region_size=240 (=starting_resource_placement_radius*2),
                              candidate_spot_count=32, spacing=32, skip_span=starting_patch_set_count,
                              skip_offset=starting_patch_set_index, hard_region_target_quantity=1,
                              density=..., quantity=starting_area_spot_quantity,
                              radius=starting_rq_factor * quantity^(1/3),
                              favorability=clamp((elevation_lakes-1)/10,0,1)*starting_modulation*2
                                         - distance/starting_resource_placement_radius + random_penalty_at(0.5,1),
                              basement_value, maximum_spot_basement_radius=128}
                 + (blobs0 - 0.25) * starting_blob_amplitude

blobs0 = basis_noise{input_scale=1/8} + basis_noise{input_scale=1/24}   (both seed1=params.seed1)
```

Then, per resource:

```
probability_expression = (control:<res>:size > 0) * clamp(all_patches, 0, 1)
                         [* random_penalty{amplitude=1/random_probability}  if random_probability < 1]
richness_expression    = (control:<res>:size > 0)
                         * richness_post_multiplier * control:<res>:richness
                         * (all_patches [/random_probability] [+ additional_richness] [maxed with minimum_richness])
                         * richness_distance_factor
```

### The shared candidate stream + skip mechanism (key correctness point)

The six resources do NOT each get an independent spot RNG. They share one
candidate stream per region and partition it via `skip_span`/`skip_offset`, which
`selectSpots` (`src/noise/spotSelection.ts`) already implements:

- **Regular set** (all six, `autoplace_set = "default"`): `region_size = 1024`,
  `skip_span = regular_patch_set_count = 6`, `skip_offset = regular_patch_set_index`
  in `initialize_patch_set` order: iron 0, copper 1, coal 2, stone 3, crude-oil 4,
  uranium 5.
- **Starting set** (only iron/copper/coal/stone, `has_starting_area_placement =
  true`): `region_size = 240`, `skip_span = starting_patch_set_count = 4`,
  `skip_offset = starting_patch_set_index`: iron 0, copper 1, coal 2, stone 3.

Because the dart-throw is deterministic, the accepted-spot sequence is a single
shared list; each resource takes the subset `j % skip_span == skip_offset`. Note
`candidate_spot_count` differs by resource (iron/copper 22, others default 21),
which only changes how far down the shared accepted sequence each walks - the
prefix is identical. The regional target and favorability trim run per skip set.
This is validated end-to-end by the probability oracle.

### Distance dependence (why we cannot render "far from spawn")

Unlike M1 elevation (which had a render-far-from-spawn escape hatch), resources
are most interesting AT spawn, and the origin-centered 1024-tile preview already
covers it. `distance` (from world origin) enters throughout:

- Regular patches fade in over `starting_resource_placement_radius` (120) to
  `+ regular_patch_fade_in_distance` (300), i.e. 120 -> 420 tiles, and reach
  double density at `double_density_distance` (1300).
- Starting patches use `elevation_lakes` favorability and `distance` modulation
  (`starting_modulation = starting_resource_placement_radius > distance`).

So the port models `distance` directly and reuses the existing elevation closures
for the starting favorability term. `distance` here is Euclidean distance from
(0, 0) (to be pinned against the oracle; the starting_positions offset the app
already models for elevation may apply).

## Architecture

New modules, mirroring the existing `expressions/` and `tiles/` layout:

```
src/noise/
  randomPenalty.ts              # NEW primitive: RandomPenalty, reverse-engineered + oracle-validated
  resources/
    resourceCatalog.ts          # the 6 param sets + map_color + order, from resources.lua
    resourcePatches.ts          # makeResourcePatches(params, ctx) -> { probability(x,y), richness(x,y) }
    regionSpotCache.ts          # accepted-spot list per (autoplaceSet, regionKey), shared across resources
    resolveResource.ts          # per-pixel: winner by order-priority among { probability >= 0.5 }
  preview/
    renderResources.ts          # NEW: overlay winner.map_color onto a terrain ImageData
  model/
    resourceReads.ts            # read control:<res>:frequency|size|richness from the active Preset
```

### `randomPenalty.ts` (the standalone spike, done first)

`random_penalty{x, y, seed, source, amplitude}` is one of the 14 `NoiseOperations`
(marked "small" in the roadmap, not yet ported). It subtracts a per-tile
deterministic random amount in `[0, amplitude]` from `source`. The wrappers
(`core/prototypes/noise-functions.lua`):

- `random_penalty_at(value, seed)` = `random_penalty{source=value, amplitude=value}`
- `random_penalty_between(from, to, seed)` = `random_penalty{source=to, amplitude=to-from}`

It gates the regular spot quantity (hence the selection trim, hence which spots
render) and the starting favorability. The exact per-tile hash is unknown and must
be reverse-engineered against the oracle (and/or the non-stripped binary, as
basis/spot were), then validated standalone before it is trusted downstream.
This is the one genuine unknown in M3, so it is done as a preceding spike
(Sequencing step 0), not a task inside a build plan.

### `makeResourcePatches(params, ctx)`

A parameterized factory (mirroring `makeElevationNauvis`, `makeTileResolver`) that
hand-ports `resource_autoplace_all_patches` and the surrounding
`resource_autoplace_settings` wrapper into a closure returning both a
`probability(x, y)` and a `richness(x, y)`. `params` is the per-resource param set;
`ctx` carries `seed0`, `segmentationMultiplier`, `startingPositions`, and the
per-resource control values (frequency/size/richness). Internally it uses
`selectSpots` (via `regionSpotCache`) for both spot fields, `basisNoise` for
`blobs0`, `randomPenalty`, and the existing elevation closures for the starting
favorability's `elevation_lakes` term.

### `regionSpotCache.ts`

For a given `(autoplaceSet, regionKey)` the accepted-spot dart-throw is identical
across all resources in the set. Compute it once per region and memoize, so a
single pixel that touches six resources does not redo the same dart-throw six
times, and adjacent pixels in the same region reuse it. Keyed by seed + region
index + set. (The game caches on the same key; this mirrors it. Pure optimization,
validated to produce identical results to calling `selectSpots` per resource.)

### `resolveResource.ts` + `renderResources.ts`

`resolveResource(x, y)` evaluates each resource's `probability(x, y)`, keeps those
`>= 0.5`, and returns the order-priority winner (order `"b"`: iron, copper, coal,
stone; then order `"c"`: crude-oil, uranium; ties broken by patch-set index) or
`null`. `renderResources` sweeps the pixel grid and paints `winner.map_color`
opaque over the passed-in terrain `ImageData`, leaving terrain visible where there
is no winner.

`map_color` values come straight from `resources.lua` (e.g. iron `{0.415, 0.525,
0.580}`, copper `{0.803, 0.388, 0.215}`, coal `{0, 0, 0}`, stone `{0.690, 0.611,
0.427}`, uranium `{0, 0.7, 0}`, crude-oil `{0.78, 0.2, 0.77}`), scaled to 0-255,
cross-checked byte-for-byte like the M2 tile palette.

## Render pipeline integration

`ElevationRenderRequest` gains `view: "resources"` alongside `"elevation"` and
`"terrain"`. `runRenderRequest` for `"resources"`:

```
base = renderTerrain({ ...terrain args from the request })
renderResources({ base, seed0, origin, tilesPerPixel, controls, ctx })  // mutates base in place
return base
```

Resources are Nauvis-only in M3 (they layer on the Nauvis terrain view), so the
preview panel enables the Resources toggle only for the Nauvis map type, exactly
as it gates the Terrain toggle today. The request carries the per-resource control
values (frequency/size/richness for each of the six), read from the active Preset
by `resourceReads.ts`.

## UI

A **Resources** toggle on `PreviewPanel.vue`, next to the Terrain/Elevation toggle,
Nauvis-only. When on, the panel sends `view: "resources"`; the six resources'
`control:*` values ride along in the request. The frequency/size/richness sliders
already exist in the Resources tab and mutate `autoplaceControls`; changing one
re-renders (the terrain render is the slow part regardless). No per-resource
checkboxes in M3.

## Testing / validation

Built test-first against the oracle, like every prior layer:

1. **`random_penalty` standalone (the spike, step 0).** Capture
   `calculate_tile_properties` for a `random_penalty` probe expression over a grid;
   port; assert ~1e-5. Reverse-engineer the hash first (oracle-driven, binary if
   needed). Committed fixture. Done before M3a.
2. **`makeResourcePatches` probability + richness.** New oracle path
   `sampleResourceProperty` reads `['nauvis-<res>-probability',
   'nauvis-<res>-richness']` (the named expressions
   `resource_autoplace_settings` emits with `create_named_expressions`) via
   `calculate_tile_properties` over a grid x a few seeds x near/far-from-spawn x
   all six resources. Assert our port agrees to the noise floor. This validates
   the shared-stream/skip partition, the distance terms, and the starting/regular
   max end-to-end.
3. **`regionSpotCache` equivalence.** Unit test: the cached path returns spots
   identical to calling `selectSpots` per resource.
4. **`resolveResource` order priority + threshold.** Unit tests for the `>= 0.5`
   footprint and the order-priority tie-break.
5. **Eyeball.** Render the overlay and compare against a real
   `--generate-map-preview` for the default preset (sanity only; the oracle is the
   real gate).

Fixtures are captured once and committed as read-only JSON; CI runs the diffs
without Factorio, gated on a local install (same policy as M1/M2). Oracle fixtures
are never hand-authored or edited to pass - a mismatch is a real finding.

## Deferred: per-tile placement roll (M3.5)

The game decides per individual tile whether to place a resource entity by rolling
a deterministic per-tile RNG (seeded from map seed + tile x/y) against
`probability`. That RNG is not yet reverse-engineered (distinct from the noise
RNGs already solved). Reproducing it buys realistic stippled patch edges, but:

- For the five `random_probability = 1` resources (all but crude-oil) the patch
  interior has `probability` ~ 1, so nearly every interior tile places regardless;
  the roll only matters at the ~1-pixel soft edge at preview scale.
- The genuinely sparse case (crude-oil, `random_probability = 1/48`) is handled by
  the already-portable `random_penalty` inside the probability expression, not the
  placement roll.

So M3 ships the deterministic `>= 0.5` footprint; M3.5 is a dedicated spike to
crack the placement RNG, validated against `surface.find_entities{type =
"resource"}` tile-for-tile, adding the stipple.

## Risks / open questions

1. **`random_penalty` RE** is the one real unknown (small, but everything
   downstream needs correct spot quantities). It is the preceding standalone spike
   (Sequencing step 0), done before any build plan.
2. **`starting_patches` favorability couples to `elevation_lakes`** even on a
   Nauvis map (M3b). Confirm against the oracle whether the game feeds the literal
   `elevation_lakes` expression there or the active map-type elevation - pin it,
   do not assume.
3. **`distance` origin/offset** (M3a): confirm `distance` is Euclidean from (0, 0)
   vs the `starting_positions` the app already models for elevation.
4. **Shared candidate-stream cache key** (M3a): `candidate_spot_count` differs per
   resource (22 vs 21) while other key fields match; validate the shared-prefix
   assumption holds via the probability oracle before trusting the cache.
```

/**
 * The `starting_patches` branch of `resource_autoplace_all_patches` (the near-spawn
 * ore patches), a close sibling of `regularPatches.ts` over the same solved
 * primitives (`selectSpots`, `basisNoise`, `randomPenaltyBatch`), plus
 * `elevation_lakes` for the favorability coupling and `distance_from_nearest_point`
 * for distance.
 *
 *   starting_patches = spotField + (blobs0 - 1/4) * startingBlobAmplitude
 *   spotField        = max(basement_value, max over nearby spots of (peak - dist*slope))
 *   blobs0           = basis_noise{1/8,1} + basis_noise{1/24,1}
 *
 * Differences from `regularPatches.ts` (see docs/superpowers/sdd/task-3-brief.md):
 * - region_size = 240 (not 1024), candidate_spot_count = 32, spacing = 32,
 *   hard_region_target_quantity = true (the last kept spot's cone shrinks
 *   self-similarly to hit the starting-area budget exactly).
 * - The candidate stream is seeded with `seed1 = params.seed1 + 1` (a distinct
 *   stream from the regular set), but the blob noise (`blobs0`) still uses the
 *   bare `params.seed1`.
 * - Spot QUANTITY is the constant `startingAreaSpotQuantity` (no random_penalty,
 *   no batching); spot FAVORABILITY is the batch op instead
 *   (`starting_favorability_base_at(distance, elevation_lakes) +
 *   random_penalty_at(0.5, 1)`).
 * - The cone radius has no `min(32, ...)` cap (regular patches cap at 32 tiles;
 *   starting patches can be larger).
 * - No `basis_noise{1/64,1.5}` term in the blob (that is regular-only).
 */
import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "../basisNoise";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { makeElevationLakes } from "../expressions/elevationLakes";
import { fastCbrt } from "../fastApprox";
import { randomPenaltyBatch } from "../randomPenalty";
import { selectSpots, type SelectedSpot } from "../spotSelection";
import type { SpotRegionKey } from "../spotCandidates";
import type { ResourceParams } from "./resourceCatalog";
import {
  basementValue,
  startingAreaSpotQuantity,
  startingBlobAmplitude,
  startingDensityAt,
  startingFavorabilityBaseAt,
  type ResourceControls,
} from "./resourceMath";

/** suggested_minimum_candidate_point_spacing for the starting set. */
const STARTING_SPACING = 32;
const STARTING_REGION_SIZE = 240;
const STARTING_CANDIDATE_SPOT_COUNT = 32;
/** maximum_spot_basement_radius - the per-query cone cull radius. */
const MAX_SPOT_BASEMENT_RADIUS = 128;

export interface StartingPatchesCtx {
  readonly seed0: number;
  /** control:<x>:frequency, size, richness (the noise-function multipliers). */
  readonly controls: { frequency: number; size: number; richness: number };
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
  /** elevation_lakes inputs for the favorability coupling. */
  readonly segmentationMultiplier?: number;
  readonly waterLevel?: number;
  readonly startingLakePositions?: readonly Point[];
  /** starting_patch_set_count (skip_span). 1 for the isolated oracle; 4 in the app. */
  readonly skipSpan?: number;
  /** starting_patch_set_index (skip_offset). */
  readonly skipOffset?: number;
}

export interface StartingPatches {
  /** Raw `starting_patches` field value (the counterpart to regular's `field`). */
  field(x: number, y: number): number;
}

const f32 = Math.fround;
/** region index for a coordinate (regions centred on multiples of STARTING_REGION_SIZE). */
const regionIndex = (c: number): number =>
  Math.floor((c + STARTING_REGION_SIZE / 2) / STARTING_REGION_SIZE);

export function makeStartingPatches(
  params: ResourceParams,
  ctx: StartingPatchesCtx,
): StartingPatches {
  const controls: ResourceControls = { frequency: ctx.controls.frequency, size: ctx.controls.size };
  const spawn: readonly Point[] = ctx.startingPositions ?? [{ x: 0, y: 0 }];
  const distanceAt = (x: number, y: number): number =>
    distanceFromNearestPoint(x, y, spawn as Point[]);

  const elevationLakes = makeElevationLakes({
    seed0: ctx.seed0,
    waterLevel: ctx.waterLevel,
    segmentationMultiplier: ctx.segmentationMultiplier,
    startingPositions: spawn as Point[],
    startingLakePositions: ctx.startingLakePositions as Point[] | undefined,
  });

  // blobs0 uses the bare seed1 (NOT +1 - that offset is candidate-stream only).
  const tables: BasisNoiseTables = basisNoiseTablesFromSeed(ctx.seed0, params.seed1);
  const basement = basementValue(params, controls);

  const skipSpan = ctx.skipSpan ?? 1;
  const skipOffset = ctx.skipOffset ?? 0;

  const quantity = startingAreaSpotQuantity(params, controls);

  // starting_favorability_expression = starting_favorability_base_at(distance,
  // elevation_lakes) + random_penalty_at(0.5, 1) (source 0.5, amplitude 0.5, seed
  // 1), evaluated over ALL skip-set spots as one batch (random_penalty is a batch
  // op seeded from the first spot and streamed).
  const favorabilityBatch = (spots: readonly { x: number; y: number }[]): number[] => {
    const rp = randomPenaltyBatch(
      spots,
      spots.map(() => 0.5),
      { seed: 1, amplitude: 0.5 },
    );
    return spots.map(
      (s, i) =>
        startingFavorabilityBaseAt(
          distanceAt(s.x, s.y),
          elevationLakes(s.x, s.y),
          params,
          controls,
        ) + rp[i],
    );
  };

  // Selected spots per region, memoized (all resources in a set share the stream).
  const regionCache = new Map<string, SelectedSpot[]>();
  const regionSpots = (rX: number, rY: number): SelectedSpot[] => {
    const key = `${rX},${rY}`;
    let spots = regionCache.get(key);
    if (spots) return spots;
    const regionKey: SpotRegionKey = {
      seed0: ctx.seed0,
      seed1: params.seed1 + 1,
      regionX: rX,
      regionY: rY,
    };
    spots = selectSpots(regionKey, {
      density: (x, y) => startingDensityAt(distanceAt(x, y), params, controls),
      quantity: () => quantity,
      favorability: () => 0, // unused: favorabilityBatch overrides
      favorabilityBatch,
      regionSize: STARTING_REGION_SIZE,
      candidateSpotCount: STARTING_CANDIDATE_SPOT_COUNT,
      spacing: STARTING_SPACING,
      skipSpan,
      skipOffset,
      hardRegionTargetQuantity: true,
    });
    regionCache.set(key, spots);
    return spots;
  };

  const spotFieldAt = (x: number, y: number): number => {
    let best = basement;
    const rXlo = regionIndex(x - MAX_SPOT_BASEMENT_RADIUS);
    const rXhi = regionIndex(x + MAX_SPOT_BASEMENT_RADIUS);
    const rYlo = regionIndex(y - MAX_SPOT_BASEMENT_RADIUS);
    const rYhi = regionIndex(y + MAX_SPOT_BASEMENT_RADIUS);
    for (let rX = rXlo; rX <= rXhi; rX++) {
      for (let rY = rYlo; rY <= rYhi; rY++) {
        for (const s of regionSpots(rX, rY)) {
          const dx = x - s.x;
          const dy = y - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > MAX_SPOT_BASEMENT_RADIUS * MAX_SPOT_BASEMENT_RADIUS) continue;
          // The cone is rendered per-tile in the f32 noise machine (cube root via
          // fastapprox `pow`), matching regularPatches. Starting patches have no
          // min(32, ...) radius cap; the hard-target trim's coneScale shrinks the
          // last kept spot's radius and peak self-similarly.
          const rBase = f32(params.startingRqFactor * fastCbrt(s.quantity));
          const radius = f32(rBase * s.coneScale);
          const peak = f32(f32(3 * s.quantity) / f32(f32(Math.PI * radius) * radius));
          const cone = f32(peak - f32(f32(Math.sqrt(d2)) * f32(peak / radius)));
          if (cone > best) best = cone;
        }
      }
    }
    return best;
  };

  const blobTermAt = (x: number, y: number): number => {
    const blobs0 = basisNoise(x / 8, y / 8, tables) + basisNoise(x / 24, y / 24, tables);
    return (blobs0 - 1 / 4) * startingBlobAmplitude(params, controls);
  };

  const field = (x: number, y: number): number => spotFieldAt(x, y) + blobTermAt(x, y);

  return { field };
}

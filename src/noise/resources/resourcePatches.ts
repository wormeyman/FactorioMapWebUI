/**
 * The outer `resource_autoplace_all_patches` expression - the combination of the
 * regular (whole-map) and starting (near-spawn) patch fields:
 *
 *   all_patches = if(has_starting_area_placement == 1,
 *                    max(starting_patches, regular_patches),
 *                    regular_patches)
 *
 * - Oil/uranium (`hasStartingAreaPlacement === false`) have no starting field, so
 *   this delegates verbatim to `makeRegularPatches` (M3a) - the deferred oil items
 *   (`random_probability` probability factor, M3.5 stipple) stay exactly as they
 *   are; M3b does NOT touch them.
 * - Solids (`hasStartingAreaPlacement === true`) build BOTH fields and expose
 *   `field = max(starting, regular)`. The four solids all have
 *   `randomProbability === 1`, `additionalRichness === 0`, `minimumRichness === 0`,
 *   so the probability/richness wrappers are trivial (2-3 lines duplicated from
 *   regularPatches - NOT worth a shared helper per the brief's YAGNI note).
 *
 * The starting favorability couples to the map's `elevation` PROPERTY, which on the
 * default Nauvis map is `elevation_nauvis` (NOT the literal `elevation_lakes`, as an
 * earlier draft assumed - proven against the headless oracle in
 * test/resourcePatches.spec.ts). `makeStartingPatches` builds that elevation.
 */
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import type { ResourceParams } from "./resourceCatalog";
import { makeRegularPatches, type RegularPatches } from "./regularPatches";
import { makeStartingPatches } from "./startingPatches";
import { DOUBLE_DENSITY_DISTANCE, REGULAR_PATCH_FADE_IN_DISTANCE } from "./resourceMath";

export interface ResourcePatchesCtx {
  readonly seed0: number;
  readonly controls: { frequency: number; size: number; richness: number };
  readonly startingPositions?: readonly Point[];
  /** elevation inputs for the starting favorability (only used by solids). */
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

export interface ResourcePatches {
  /** Raw `all_patches` field value. */
  field(x: number, y: number): number;
  /** clamp(field, 0, 1) - the solid-footprint probability (stipple deferred). */
  probability(x: number, y: number): number;
  /** The autoplace richness at (x, y) (0 where size <= 0). */
  richness(x: number, y: number): number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export function makeResourcePatches(
  params: ResourceParams,
  ctx: ResourcePatchesCtx,
): ResourcePatches {
  const regular: RegularPatches = makeRegularPatches(params, {
    seed0: ctx.seed0,
    controls: ctx.controls,
    startingPositions: ctx.startingPositions,
    skipSpan: ctx.regularSkipSpan ?? 1,
    skipOffset: ctx.regularSkipOffset ?? 0,
  });

  // Oil/uranium: no starting placement - delegate unchanged (keeps oil's general
  // wrapper math - random_probability, additional_richness - in one place).
  if (!params.hasStartingAreaPlacement) {
    return regular;
  }

  // Solids: all_patches = max(starting_patches, regular_patches).
  const starting = makeStartingPatches(params, {
    seed0: ctx.seed0,
    controls: ctx.controls,
    startingPositions: ctx.startingPositions,
    segmentationMultiplier: ctx.segmentationMultiplier,
    waterLevel: ctx.waterLevel,
    startingLakePositions: ctx.startingLakePositions,
    skipSpan: ctx.startingSkipSpan ?? 1,
    skipOffset: ctx.startingSkipOffset ?? 0,
  });

  const spawn: readonly Point[] = ctx.startingPositions ?? [{ x: 0, y: 0 }];
  const distanceAt = (x: number, y: number): number =>
    distanceFromNearestPoint(x, y, spawn as Point[]);

  const field = (x: number, y: number): number =>
    Math.max(starting.field(x, y), regular.field(x, y));

  // Same fade-in-adjusted richness distance factor as regularPatches.ts.
  const richnessDistanceFactor = (distance: number): number =>
    Math.max(
      (DOUBLE_DENSITY_DISTANCE - REGULAR_PATCH_FADE_IN_DISTANCE + distance) /
        (DOUBLE_DENSITY_DISTANCE * 2),
      1,
    );

  return {
    field,
    // The four solids all have randomProbability=1, additionalRichness=0,
    // minimumRichness=0, so the wrappers reduce to these trivial forms.
    probability: (x, y) => (ctx.controls.size > 0 ? clamp(field(x, y), 0, 1) : 0),
    richness: (x, y) => {
      if (ctx.controls.size <= 0) return 0;
      return (
        params.richnessPostMultiplier *
        ctx.controls.richness *
        field(x, y) *
        richnessDistanceFactor(distanceAt(x, y))
      );
    },
  };
}

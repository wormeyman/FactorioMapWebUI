/**
 * `cliff_elevation_nauvis`: the elevation field the game samples cliffs against
 * (before the lever-derived elevation-0/interval remap and no-cliff clamp,
 * which land in a later task). A two-line combination of already-validated
 * ports (`nauvis_hills`, `nauvis_hills_cliff_level`) from the shared Nauvis
 * noise sub-tree.
 *
 * See noise-programs.lua's `cliff_elevation_nauvis` and
 * `docs/superpowers/sdd/` for the cliffs design spec.
 */

import { makeNauvisShared } from "../expressions/nauvisShared";
import { makeElevationNauvis } from "../expressions/elevationNauvis";
import { basisNoiseExpr } from "../eval/primitives";
import { basisNoiseTablesFromSeed } from "../basisNoise";
import { distanceFromNearestPoint } from "../distanceFromNearestPoint";
import {
  LOW_FREQ_CLIFFINESS_SEED1,
  getModifiedElevationInterval,
  getModifiedRichness,
  sliderToLinear,
} from "./cliffCatalog";
import type { CliffControls, CliffSettingsInput } from "./cliffCatalog";
import type { Point } from "../distanceFromNearestPoint";

/** Inputs `makeCliffElevation` (and later cliff-field builders) need. */
export interface CliffFieldCtx {
  readonly seed0: number;
  readonly controls: CliffControls; // { frequency, continuity }
  readonly settings: CliffSettingsInput; // { cliffElevation0, cliffElevationInterval, richness }
  readonly segmentationMultiplier?: number; // control:water:frequency; default 1
  readonly waterLevel?: number; // default 0 (used by the no_cliff elevation term, Task 6)
  readonly startingPositions?: readonly Point[]; // default [{x:0,y:0}]
  readonly startingLakePositions?: readonly Point[];
}

/**
 * `cliff_elevation_nauvis(x,y) = 10 + 30 * (nauvis_hills(x,y) - nauvis_hills_cliff_level(x,y))`,
 * from the shared Nauvis noise sub-tree (`nz = makeNauvisShared({ seed0, segmentationMultiplier })`).
 */
export function makeCliffElevation(ctx: CliffFieldCtx): (x: number, y: number) => number {
  const nz = makeNauvisShared({
    seed0: ctx.seed0,
    segmentationMultiplier: ctx.segmentationMultiplier,
  });
  return (x: number, y: number): number => 10 + 30 * (nz.hills(x, y) - nz.cliffLevel(x, y));
}

/**
 * `cliffiness_nauvis(x,y) = (main_cliffiness >= cliff_cutoff) * 10` - the core cliff
 * GATE field, so every output is exactly `0` or `10` (a mismatch against the oracle
 * is a real cutoff/term bug, not f32 drift). `main_cliffiness` is the `min` of six
 * sub-terms, each a scaled combination of already-validated ports:
 *
 *   base_cliffiness          = (nauvis_cliff_ringbreak - 0.01) * 60
 *   forest_path_cliffiness   = (forest_path_billows   - 0.03) * 12
 *   bridge_path_cliffiness   = (nauvis_bridge_billows - 0.05) * 15
 *   elevation_cliffiness     = (elevation_nauvis_no_cliff - 4) / 2
 *   starting_area_cliffiness = -2 + distance * segmentation_multiplier / 120
 *   4 * low_frequency_cliffiness
 *
 * with cliff_cutoff = 2 * (0.5 - 0.5*slider_to_linear(cliff_richness,-1,1))^1.5
 * (= 0.7071 at the default richness). `starting_area_cliffiness` uses the PLAIN
 * `segmentation_multiplier` (control:water:frequency), NOT `nauvis_segmentation_multiplier`,
 * and its `distance` is `distance_from_nearest_point{points = starting_positions}`
 * with NO `maximum_distance` - the game leaves it uncapped (oracle-confirmed: the
 * uncapped `distance` returns the true Euclidean distance out past 14000 tiles), so
 * we pass no cap (default Infinity). See noise-programs.lua's `cliffiness_nauvis`.
 */
export function makeCliffiness(ctx: CliffFieldCtx): (x: number, y: number) => number {
  const seed0 = ctx.seed0;
  const seg = ctx.segmentationMultiplier ?? 1;
  const nz = makeNauvisShared({ seed0, segmentationMultiplier: seg });
  const nauvisSeg = nz.nauvisSeg;

  // Effective levers.
  const interval = getModifiedElevationInterval(
    ctx.settings.cliffElevationInterval,
    ctx.controls.frequency,
  );
  const cliffRichness = getModifiedRichness(ctx.settings.richness, ctx.controls.continuity);
  const cliffFrequency = 40 / interval;

  // elevation_nauvis_no_cliff: the elevation tree with added_cliff_elevation = 0.
  const noCliffElev = makeElevationNauvis({
    seed0,
    waterLevel: ctx.waterLevel,
    segmentationMultiplier: seg,
    startingPositions: ctx.startingPositions ? [...ctx.startingPositions] : undefined,
    startingLakePositions: ctx.startingLakePositions ? [...ctx.startingLakePositions] : undefined,
    withCliffElevation: false,
  });

  const lowFreqTables = basisNoiseTablesFromSeed(seed0, LOW_FREQ_CLIFFINESS_SEED1);
  const spawn: readonly Point[] = ctx.startingPositions ?? [{ x: 0, y: 0 }];

  // Distance-independent parts of low_frequency_cliffiness and the cutoff.
  const lowFreqLever = Math.min(
    sliderToLinear(cliffFrequency, -1.7, 1.7),
    sliderToLinear(cliffRichness, -1, 1),
  );
  const cliffGapSize = 0.5 - 0.5 * sliderToLinear(cliffRichness, -1, 1);
  const cliffCutoff = 2 * cliffGapSize ** 1.5;

  return (x: number, y: number): number => {
    const base = (nz.cliffRingbreak(x, y) - 0.01) * 60;
    const forest = (nz.forestPathBillows(x, y) - 0.03) * 12;
    const bridge = (nz.bridgeBillows(x, y) - 0.05) * 15;
    const elev = (noCliffElev(x, y) - 4) / 2;
    // distance is uncapped (no maximum_distance in the game's `distance` expression).
    const startArea = -2 + (distanceFromNearestPoint(x, y, spawn) * seg) / 120;
    const lowFreq =
      1.5 +
      basisNoiseExpr(
        x,
        y,
        { seed0, seed1: LOW_FREQ_CLIFFINESS_SEED1, inputScale: nauvisSeg / 500, outputScale: 0.51 },
        lowFreqTables,
      ) +
      lowFreqLever;
    const mainCliffiness = Math.min(base, forest, bridge, elev, startArea, 4 * lowFreq);
    return mainCliffiness >= cliffCutoff ? 10 : 0;
  };
}

/**
 * Both Nauvis cliff fields the placement pass needs: `cliff_elevation_nauvis`
 * (which band a cliff sits on) and `cliffiness_nauvis` (the 0/10 gate for whether
 * a cell may carry a cliff at all).
 */
export function makeCliffFields(ctx: CliffFieldCtx): {
  cliffElevation: (x: number, y: number) => number;
  cliffiness: (x: number, y: number) => number;
} {
  return {
    cliffElevation: makeCliffElevation(ctx),
    cliffiness: makeCliffiness(ctx),
  };
}

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

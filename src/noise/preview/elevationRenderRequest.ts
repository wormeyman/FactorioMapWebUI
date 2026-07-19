import type { Point } from "../distanceFromNearestPoint";
import { renderElevation } from "./renderElevation";

/** A render job posted to the worker. `id` tags the response for staleness. */
export interface ElevationRenderRequest {
  id: number;
  seed0: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  tilesPerPixel: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  /** Omitted => the game's real lake positions are computed inside the render. */
  startingLakePositions?: Point[];
}

/** The rendered pixels, with `buffer` posted back as a transferable. */
export interface ElevationRenderResult {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * Pure render step shared by the worker and its tests: run renderElevation and
 * hand back the transferable RGBA buffer. No Worker or DOM canvas involved.
 */
export function runRenderRequest(req: ElevationRenderRequest): ElevationRenderResult {
  const image = renderElevation({
    seed0: req.seed0,
    width: req.width,
    height: req.height,
    originX: req.originX,
    originY: req.originY,
    tilesPerPixel: req.tilesPerPixel,
    ctx: {
      waterLevel: req.waterLevel,
      segmentationMultiplier: req.segmentationMultiplier,
      startingPositions: req.startingPositions,
      startingLakePositions: req.startingLakePositions,
    },
  });
  return { id: req.id, buffer: image.data.buffer, width: req.width, height: req.height };
}

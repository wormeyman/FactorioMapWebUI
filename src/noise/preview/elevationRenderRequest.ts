import type { Point } from "../distanceFromNearestPoint";
import { renderElevation } from "./renderElevation";
import { renderTerrain } from "./renderTerrain";

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
  /**
   * Climate controls (Task 12b) - consumed only when `view: "terrain"`; the
   * elevation renderers ignore these. Each defaults to the game's default
   * (freq 1, bias 0, starting-area size/frequency 1) when omitted.
   */
  moistureFrequency?: number;
  moistureBias?: number;
  auxFrequency?: number;
  auxBias?: number;
  startingAreaMoistureSize?: number;
  startingAreaMoistureFrequency?: number;
  /** Which elevation tree to render. Default "lakes". */
  mapType?: "lakes" | "nauvis" | "island";
  /**
   * Which render to run: the water/land elevation mask ("elevation") or the
   * full terrain-tile color render ("terrain", Task 11's renderTerrain).
   * Default "elevation". renderTerrain always uses the Nauvis climate + tile
   * catalog (see renderTerrain.ts), so it is only faithful when `mapType` is
   * "nauvis" - callers (the preview panel) disable the terrain toggle for
   * lakes/island presets rather than send an unfaithful request here.
   */
  view?: "elevation" | "terrain";
}

/** The rendered pixels, with `buffer` posted back as a transferable. */
export interface ElevationRenderResult {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * Pure render step shared by the worker and its tests: run renderElevation or
 * renderTerrain (per `req.view`) and hand back the transferable RGBA buffer. No
 * Worker or DOM canvas involved.
 */
export function runRenderRequest(req: ElevationRenderRequest): ElevationRenderResult {
  const image =
    req.view === "terrain"
      ? renderTerrain({
          seed0: req.seed0,
          width: req.width,
          height: req.height,
          originX: req.originX,
          originY: req.originY,
          tilesPerPixel: req.tilesPerPixel,
          ctx: {
            segmentationMultiplier: req.segmentationMultiplier,
            startingPositions: req.startingPositions,
            moistureFrequency: req.moistureFrequency,
            moistureBias: req.moistureBias,
            auxFrequency: req.auxFrequency,
            auxBias: req.auxBias,
            startingAreaMoistureSize: req.startingAreaMoistureSize,
            startingAreaMoistureFrequency: req.startingAreaMoistureFrequency,
          },
        })
      : renderElevation({
          seed0: req.seed0,
          width: req.width,
          height: req.height,
          originX: req.originX,
          originY: req.originY,
          tilesPerPixel: req.tilesPerPixel,
          mapType: req.mapType,
          ctx: {
            waterLevel: req.waterLevel,
            segmentationMultiplier: req.segmentationMultiplier,
            startingPositions: req.startingPositions,
            startingLakePositions: req.startingLakePositions,
          },
        });
  return { id: req.id, buffer: image.data.buffer, width: req.width, height: req.height };
}

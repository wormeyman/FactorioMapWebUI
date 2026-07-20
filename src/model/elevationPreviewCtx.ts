import { readClimateControls } from "./climateReads";
import type { Point } from "../noise/distanceFromNearestPoint";
import { readMapType } from "./mapType";
import type { Preset } from "./types";

export interface ElevationPreviewCtx {
  /** false => the active map type has no client renderer (unknown/modded map type). */
  supported: boolean;
  /** Which client renderer to use when supported. */
  mapType: "lakes" | "nauvis" | "island";
  /** Resolved map-type label, for the "not available for <label>" message. */
  mapTypeLabel: string;
  /**
   * Non-seed free variables for renderElevation/renderTerrain
   * (Omit<..., "seed0">-compatible). The climate fields (aux/moisture
   * frequency+bias, starting-area moisture) are consumed only by
   * renderTerrain's tile resolver - the elevation renderers ignore them.
   *
   * Task 12b: non-default climate values are faithful ports of the game's
   * climate tree (same caveat as the starting-area/starting-lake elevation
   * levers above) but are NOT themselves oracle-validated point-by-point -
   * only the all-defaults path (Task 10's fixtures) is.
   */
  ctx: {
    waterLevel: number;
    segmentationMultiplier: number;
    startingPositions: Point[];
    moistureFrequency: number;
    moistureBias: number;
    auxFrequency: number;
    auxBias: number;
    startingAreaMoistureSize: number;
    startingAreaMoistureFrequency: number;
  };
}

/**
 * Map the active preset onto the free variables the elevation renderer needs,
 * and report which client tree (nauvis, lakes, or island) renders it. waterLevel =
 * 10*log2(control:water:size), segmentation = control:water:frequency; an
 * absent water control collapses to the renderer's own defaults (waterLevel 0,
 * seg 1). A disabled control (size <= 0) is guarded to size 1 rather than
 * emitting -Infinity. The climate fields (moisture/aux frequency+bias,
 * starting-area moisture) come from `readClimateControls`, which applies the
 * game's own defaults for any absent key.
 */
export function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx {
  const mt = readMapType(preset.propertyExpressionNames);
  const water = preset.autoplaceControls.water;
  const size = water && water.size > 0 ? water.size : 1;
  const startingPositions: Point[] =
    preset.startingPoints.length > 0
      ? preset.startingPoints.map((p) => ({ x: p.x, y: p.y }))
      : [{ x: 0, y: 0 }];
  const climate = readClimateControls(preset.propertyExpressionNames);

  const supported = mt.id === "nauvis" || mt.id === "lakes" || mt.id === "island";
  const mapType = mt.id === "nauvis" ? "nauvis" : mt.id === "island" ? "island" : "lakes";
  return {
    supported,
    mapType,
    mapTypeLabel: mt.label,
    ctx: {
      waterLevel: 10 * Math.log2(size),
      segmentationMultiplier: water?.frequency ?? 1,
      startingPositions,
      moistureFrequency: climate.moisture.frequency,
      moistureBias: climate.moisture.bias,
      auxFrequency: climate.aux.frequency,
      auxBias: climate.aux.bias,
      startingAreaMoistureSize: climate.startingAreaMoisture.size,
      startingAreaMoistureFrequency: climate.startingAreaMoisture.frequency,
    },
  };
}

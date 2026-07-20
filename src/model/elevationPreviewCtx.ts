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
  /** Non-seed free variables for renderElevation (Omit<..., "seed0">-compatible). */
  ctx: {
    waterLevel: number;
    segmentationMultiplier: number;
    startingPositions: Point[];
  };
}

/**
 * Map the active preset onto the free variables the elevation renderer needs,
 * and report which client tree (nauvis, lakes, or island) renders it. waterLevel =
 * 10*log2(control:water:size), segmentation = control:water:frequency; an
 * absent water control collapses to the renderer's own defaults (waterLevel 0,
 * seg 1). A disabled control (size <= 0) is guarded to size 1 rather than
 * emitting -Infinity.
 */
export function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx {
  const mt = readMapType(preset.propertyExpressionNames);
  const water = preset.autoplaceControls.water;
  const size = water && water.size > 0 ? water.size : 1;
  const startingPositions: Point[] =
    preset.startingPoints.length > 0
      ? preset.startingPoints.map((p) => ({ x: p.x, y: p.y }))
      : [{ x: 0, y: 0 }];

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
    },
  };
}

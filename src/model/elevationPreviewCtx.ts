import { readClimateControls } from "./climateReads";
import type { Point } from "../noise/distanceFromNearestPoint";
import { readMapType } from "./mapType";
import { readResourceControls } from "./resourceReads";
import type { ResourceControlLevers } from "../noise/resources/resolveResource";
import type { Preset } from "./types";
import { ENEMY_CONTROL_NAME, type EnemyControls } from "../noise/enemies/enemyCatalog";
import {
  CLIFF_CONTROL_NAME,
  type CliffControls,
  type CliffSettingsInput,
} from "../noise/cliffs/cliffCatalog";

export interface ElevationPreviewCtx {
  /** false => the active map type has no client renderer (unknown/modded map type). */
  supported: boolean;
  /** Which client renderer to use when supported. */
  mapType: "lakes" | "nauvis" | "island";
  /** Resolved map-type label, for the "not available for <label>" message. */
  mapTypeLabel: string;
  /**
   * Per-resource control levers (control:<res>:frequency|size|richness), keyed by
   * controlName - consumed only by the `view: "resources"` overlay (renderResources).
   * Absent resources default to 1/1/1. Faithful only on the Nauvis map type, same as
   * the terrain view.
   */
  resourceControls: Record<string, ResourceControlLevers>;
  /**
   * The enemy-base autoplace control's frequency/size (control:enemy-base:*) -
   * consumed only by the `view: "enemies"` overlay (renderEnemies). Absent
   * defaults to `{ frequency: 1, size: 1 }`. Faithful only on the Nauvis map
   * type, same as the terrain/resources views.
   */
  enemyControls: EnemyControls;
  /**
   * The `nauvis_cliff` autoplace control's frequency/size (control:nauvis_cliff:*,
   * size doubles as continuity) - consumed only by the `view: "cliffs"` overlay
   * (renderCliffs). Absent defaults to `{ frequency: 1, continuity: 1 }`.
   * Faithful only on the Nauvis map type, same as the terrain/resources/enemies
   * views.
   */
  cliffControls: CliffControls;
  /**
   * The cliff-related MapGenSettings fields (cliff_elevation_0,
   * cliff_elevation_interval, cliff richness), read straight off
   * `preset.cliffSettings` - consumed only by the `view: "cliffs"` overlay.
   */
  cliffSettings: CliffSettingsInput;
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
  const eb = preset.autoplaceControls[ENEMY_CONTROL_NAME];
  const cc = preset.autoplaceControls[CLIFF_CONTROL_NAME];
  return {
    supported,
    mapType,
    mapTypeLabel: mt.label,
    resourceControls: readResourceControls(preset),
    enemyControls: eb ? { frequency: eb.frequency, size: eb.size } : { frequency: 1, size: 1 },
    cliffControls: cc
      ? { frequency: cc.frequency, continuity: cc.size }
      : { frequency: 1, continuity: 1 },
    cliffSettings: {
      cliffElevation0: preset.cliffSettings.cliffElevation0,
      cliffElevationInterval: preset.cliffSettings.cliffElevationInterval,
      richness: preset.cliffSettings.richness,
    },
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

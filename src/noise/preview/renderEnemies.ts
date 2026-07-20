/**
 * Composite the enemy-base footprint overlay onto a terrain ImageData: sweep the
 * same pixel grid as renderTerrain/renderResources, and where
 * `enemy_base_probability` clears the footprint threshold, paint `ENEMY_MAP_COLOR`
 * opaque; leave the terrain pixel untouched elsewhere. Mutates `base` in place.
 * See M4 plan T4.
 *
 * Enemy bases never spawn on water, so we skip any pixel the terrain drew as
 * water/deepwater - the same `WATER_TILE_COLORS` water-skip renderResources uses,
 * reused (not re-derived) so the enemy-footprint edge lines up with the coastline
 * the terrain already drew.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeEnemyBaseField } from "../enemies/enemyBaseField";
import {
  ENEMY_FOOTPRINT_THRESHOLD,
  ENEMY_MAP_COLOR,
  type EnemyControls,
} from "../enemies/enemyCatalog";
import { WATER_TILE_COLORS } from "./renderResources";

export interface RenderEnemiesOptions {
  readonly seed0: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  readonly controls: EnemyControls;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function renderEnemies(base: ImageData, opts: RenderEnemiesOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const f = makeEnemyBaseField({
    seed0: opts.seed0,
    controls: opts.controls,
    startingPositions: opts.startingPositions,
  });

  const isWater = (r: number, g: number, b: number): boolean => {
    for (const [wr, wg, wb] of WATER_TILE_COLORS) {
      if (r === wr && g === wg && b === wb) return true;
    }
    return false;
  };

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      // Enemy bases never sit on water - skip water tiles (and the field call for them).
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const wx = originX + px * tpp;
      if (f.probability(wx, wy) < ENEMY_FOOTPRINT_THRESHOLD) continue;
      base.data[o] = ENEMY_MAP_COLOR[0];
      base.data[o + 1] = ENEMY_MAP_COLOR[1];
      base.data[o + 2] = ENEMY_MAP_COLOR[2];
      base.data[o + 3] = 255;
    }
  }
}

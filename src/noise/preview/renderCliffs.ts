/**
 * Composite the cliff footprint overlay onto a terrain ImageData: enumerate
 * placed cliff cells over the pixel grid's world box (via `makeCliffPlacement`,
 * T7), map each cell center to a pixel, and paint `CLIFF_MAP_COLOR` opaque;
 * leave the terrain pixel untouched elsewhere. Mutates `base` in place. See M4
 * cliffs plan T9.
 *
 * Unlike renderResources/renderEnemies (which sweep every pixel and query a
 * field), cliffs are placed on a sparse 4-tile grid - `placedCells` already
 * enumerates just the placed cells over the box, so we map cell centers to
 * pixels instead of sweeping.
 *
 * Cliffs never sit on water, so we skip any pixel the terrain drew as
 * water/deepwater - the same `WATER_TILE_COLORS` water-skip renderResources
 * and renderEnemies use, reused (not re-derived) so the cliff footprint edge
 * lines up with the coastline the terrain already drew.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeCliffPlacement } from "../cliffs/cliffPlacement";
import {
  CLIFF_MAP_COLOR,
  type CliffControls,
  type CliffSettingsInput,
} from "../cliffs/cliffCatalog";
import { WATER_TILE_COLORS } from "./renderResources";

export interface RenderCliffsOptions {
  readonly seed0: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  readonly controls: CliffControls;
  readonly settings: CliffSettingsInput;
  readonly segmentationMultiplier?: number;
  readonly waterLevel?: number;
  readonly startingPositions?: readonly Point[];
  readonly startingLakePositions?: readonly Point[];
}

export function renderCliffs(base: ImageData, opts: RenderCliffsOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const isWater = (r: number, g: number, b: number): boolean => {
    for (const [wr, wg, wb] of WATER_TILE_COLORS) {
      if (r === wr && g === wg && b === wb) return true;
    }
    return false;
  };

  const placement = makeCliffPlacement({
    seed0: opts.seed0,
    controls: opts.controls,
    settings: opts.settings,
    segmentationMultiplier: opts.segmentationMultiplier,
    waterLevel: opts.waterLevel,
    startingPositions: opts.startingPositions,
    startingLakePositions: opts.startingLakePositions,
  });

  const x0 = originX;
  const y0 = originY;
  const x1 = originX + width * tpp;
  const y1 = originY + height * tpp;
  const cells = placement.placedCells(x0, y0, x1, y1);

  for (const { x: wx, y: wy } of cells) {
    const px = Math.floor((wx - originX) / tpp);
    const py = Math.floor((wy - originY) / tpp);
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const o = (py * width + px) * 4;
    if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
    base.data[o] = CLIFF_MAP_COLOR[0];
    base.data[o + 1] = CLIFF_MAP_COLOR[1];
    base.data[o + 2] = CLIFF_MAP_COLOR[2];
    base.data[o + 3] = 255;
  }
}

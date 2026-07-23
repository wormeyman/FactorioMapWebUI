/**
 * Composite the rocks overlay onto a terrain ImageData: sweep the same pixel grid
 * as renderTerrain/renderEnemies, and where `max_i rock_probability_i` clears the
 * footprint threshold, paint ROCK_MAP_COLOR opaque; leave the terrain pixel
 * untouched elsewhere. Mutates `base` in place.
 *
 * Interim fidelity: rocks are sparse (peak per-tile probability ~0.02-0.17), so an
 * expected-value alpha shade would be near-invisible - a threshold footprint reads
 * as the scattered specks the game shows. The session-2 world-position dither
 * (docs/superpowers/specs/2026-07-22-rocks-overlay-and-density-dither-design.md)
 * replaces this render. 1 pixel per rock cell, no legibility block: rocks are
 * point-like, and a block would merge scattered rocks into a blob.
 *
 * Rocks collide with water, so water pixels are skipped, reusing renderTerrain's
 * exact water decision via WATER_TILE_COLORS the same way renderResources does.
 * Cliff exclusion is not wired, matching the existing ore-on-cliffs deferred item.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeRockDensity } from "../rocks/rockField";
import { ROCK_FOOTPRINT_THRESHOLD, ROCK_MAP_COLOR, type RockControls } from "../rocks/rockCatalog";
import { WATER_TILE_COLORS } from "./renderResources";

export interface RenderRocksOptions {
  readonly seed0: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** control:rocks:frequency/size. Defaults to { frequency: 1, size: 1 }. */
  readonly controls?: RockControls;
  readonly segmentationMultiplier?: number;
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly auxFrequency?: number;
  readonly auxBias?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function renderRocks(base: ImageData, opts: RenderRocksOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const density = makeRockDensity({
    seed0: opts.seed0,
    rocksFrequency: opts.controls?.frequency ?? 1,
    rocksSize: opts.controls?.size ?? 1,
    segmentationMultiplier: opts.segmentationMultiplier,
    moistureFrequency: opts.moistureFrequency,
    moistureBias: opts.moistureBias,
    auxFrequency: opts.auxFrequency,
    auxBias: opts.auxBias,
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
      // Rocks never sit on water - skip water tiles (and the field call for them).
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const wx = originX + px * tpp;
      if (density(wx, wy) < ROCK_FOOTPRINT_THRESHOLD) continue;
      base.data[o] = ROCK_MAP_COLOR[0];
      base.data[o + 1] = ROCK_MAP_COLOR[1];
      base.data[o + 2] = ROCK_MAP_COLOR[2];
      base.data[o + 3] = 255;
    }
  }
}

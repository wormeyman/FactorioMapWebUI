/**
 * Composite the resource-patch overlay onto a terrain ImageData: sweep the same
 * pixel grid as renderTerrain, and where a resource wins (order-priority,
 * probability >= 0.5), paint its `map_color` opaque; leave the terrain pixel
 * untouched elsewhere. Mutates `base` in place. See M3a plan T7.
 *
 * Resources collide with water, so ore is never placed on a water tile - we skip
 * any pixel the terrain drew as water/deepwater (which also skips the expensive
 * resolver there). This reuses renderTerrain's exact water decision rather than
 * re-deriving it from elevation, so the ore edge lines up with the coastline the
 * terrain already drew. Cliffs would be excluded the same way once rendered.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeResourceResolver, type ResourceControlLevers } from "../resources/resolveResource";

/**
 * The Nauvis water tiles' `map_color` RGB (deepwater, water) - mirrors catalog.ts.
 * Resources are excluded from these tiles. A drift-guard test (renderResources.spec)
 * asserts these still match the catalog.
 */
export const WATER_TILE_COLORS: readonly (readonly [number, number, number])[] = [
  [38, 64, 73], // deepwater
  [51, 83, 95], // water
];

export interface RenderResourcesOptions {
  readonly seed0: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** Per-resource control levers, keyed by controlName; missing => all-default. */
  readonly controls: Record<string, ResourceControlLevers>;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function renderResources(base: ImageData, opts: RenderResourcesOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const resolve = makeResourceResolver({
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
      // Ore never sits on water - skip water tiles (and the resolver call for them).
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const wx = originX + px * tpp;
      const winner = resolve(wx, wy);
      if (!winner) continue;
      base.data[o] = winner.mapColor[0];
      base.data[o + 1] = winner.mapColor[1];
      base.data[o + 2] = winner.mapColor[2];
      base.data[o + 3] = 255;
    }
  }
}

/**
 * Composite the resource-patch overlay onto a terrain ImageData: sweep the same
 * pixel grid as renderTerrain, and where a resource wins (order-priority,
 * probability >= 0.5), paint its `map_color` opaque; leave the terrain pixel
 * untouched elsewhere. Mutates `base` in place. See M3a plan T7.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeResourceResolver, type ResourceControlLevers } from "../resources/resolveResource";

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

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const wx = originX + px * tpp;
      const winner = resolve(wx, wy);
      if (!winner) continue;
      const o = (py * width + px) * 4;
      base.data[o] = winner.mapColor[0];
      base.data[o + 1] = winner.mapColor[1];
      base.data[o + 2] = winner.mapColor[2];
      base.data[o + 3] = 255;
    }
  }
}

import { makeElevationLakes, type ElevationLakesParams } from "../expressions/elevationLakes";

/** RGBA for water (elevation < 0) and land, as [r, g, b, a] byte tuples. */
export const WATER_RGBA: [number, number, number, number] = [40, 90, 150, 255];
export const LAND_RGBA: [number, number, number, number] = [70, 120, 60, 255];

export interface RenderElevationOptions {
  /** Map seed (= map_seed / seed0). Callers resolve a null "random" seed first. */
  readonly seed0: number;
  /** Output pixel dimensions. */
  readonly width: number;
  readonly height: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** Non-seed tree params (waterLevel, segmentationMultiplier, spawn/lake points). */
  readonly ctx?: Omit<ElevationLakesParams, "seed0">;
}

/**
 * Sweep a `width x height` pixel grid over world space and return an `ImageData`
 * whose pixels are {@link WATER_RGBA} where `elevation_lakes < 0` and
 * {@link LAND_RGBA} otherwise. The tree evaluator is compiled once (heavy octave
 * closures built up front) and reused across pixels.
 *
 * Near-spawn fidelity: the render computes the game's real starting lake positions
 * (see startingLakes.ts) by default, so the coastline is faithful near spawn as
 * well as far out. Callers may still pass an explicit `ctx.startingLakePositions`
 * (including `[]`) to override.
 */
export function renderElevation(opts: RenderElevationOptions): ImageData {
  const { width, height } = opts;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const evalAt = makeElevationLakes({ seed0: opts.seed0, ...opts.ctx });
  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const wx = originX + px * tpp;
      const rgba = evalAt(wx, wy) < 0 ? WATER_RGBA : LAND_RGBA;
      const o = (py * width + px) * 4;
      data[o] = rgba[0];
      data[o + 1] = rgba[1];
      data[o + 2] = rgba[2];
      data[o + 3] = rgba[3];
    }
  }

  return new ImageData(data, width, height);
}

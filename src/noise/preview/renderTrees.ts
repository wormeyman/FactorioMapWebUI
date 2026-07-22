/**
 * Composite the tree overlay onto a terrain ImageData: sweep the same pixel grid
 * as renderTerrain and blend the game's tree chart color over each pixel with an
 * alpha proportional to tree density. Mutates `base` in place.
 *
 * Why a blend and not a footprint (as resources/enemies/cliffs use): the game's
 * own map preview places real tree entities and charts each one with the RGBA
 * `default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}` - the 40% alpha is
 * the game blending trees over terrain. We cannot place individual trees without
 * the per-chunk placement roll (deferred - see docs/noise/placement-roll-NOTES.md),
 * so we draw the EXPECTED value instead: the density is exactly the probability
 * the game rolls against, because arbitration picks the max-probability entity per
 * tile and rolls once. See the design spec for the full RE.
 *
 * Trees do not place on water, so water pixels are skipped, reusing renderTerrain's
 * exact water decision via WATER_TILE_COLORS the same way renderResources does.
 * Cliff exclusion is not wired, matching the existing deferred ore-on-cliffs item.
 */
import { WATER_TILE_COLORS } from "./renderResources";
import { makeTreeDensity, type TreeFieldParams } from "../trees/treeField";

/** `{0.19, 0.39, 0.19}` in 8-bit - utility-constants.lua:201. */
export const TREE_MAP_COLOR: readonly [number, number, number] = [48, 99, 48];
/** The alpha component of the same constant: fully-forested tiles blend at 40%. */
export const TREE_MAX_ALPHA = 0.4;

export interface RenderTreesOptions extends TreeFieldParams {
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
}

export function renderTrees(base: ImageData, opts: RenderTreesOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const density = makeTreeDensity(opts);

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
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const d = density(originX + px * tpp, wy);
      if (d <= 0) continue;
      const a = TREE_MAX_ALPHA * d;
      base.data[o] = Math.round(base.data[o] * (1 - a) + TREE_MAP_COLOR[0] * a);
      base.data[o + 1] = Math.round(base.data[o + 1] * (1 - a) + TREE_MAP_COLOR[1] * a);
      base.data[o + 2] = Math.round(base.data[o + 2] * (1 - a) + TREE_MAP_COLOR[2] * a);
      base.data[o + 3] = 255;
    }
  }
}

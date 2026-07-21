/**
 * Pure tile geometry for the region-tiled renderer: split a pixel image into a
 * grid of sub-boxes, each carrying both its pixel offset within the full image
 * (`dx`/`dy`, for blitting) and its own world origin (for rendering). No Worker,
 * no renderer, no DOM - see the region-tiling design doc.
 */

/** A pixel rectangle plus the world coordinates it maps onto. */
export interface ImageBox {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly tilesPerPixel: number;
}

/** An `ImageBox` that is part of a larger image, at pixel offset `dx`/`dy`. */
export interface TileBox extends ImageBox {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Split `full` into a row-major grid of at most `tileSize`-square tiles. The
 * trailing row and column are narrower when the size is not divisible, so the
 * tiles cover the image exactly once with no overlap.
 *
 * Byte-identity precondition: a tile computes world coordinates as
 * `(originX + dx * tilesPerPixel) + px * tilesPerPixel`, while the untiled
 * render computes `originX + (dx + px) * tilesPerPixel`. Those agree exactly
 * only when the intermediate products are exactly representable in f64 - true
 * for integer origins and integer `tilesPerPixel`, which is all the app uses
 * (the preview is fixed at 1). A fractional `tilesPerPixel` (a zoom feature,
 * say) could make the two disagree in the last bit and silently break the
 * tiled-equals-untiled invariant. Do not generalize this without extending the
 * equality gate to the new scale.
 */
export function planTiles(full: ImageBox, tileSize: number): TileBox[] {
  if (!(tileSize > 0)) throw new Error("planTiles: tileSize must be positive");
  const tiles: TileBox[] = [];
  for (let dy = 0; dy < full.height; dy += tileSize) {
    const height = Math.min(tileSize, full.height - dy);
    for (let dx = 0; dx < full.width; dx += tileSize) {
      const width = Math.min(tileSize, full.width - dx);
      tiles.push({
        dx,
        dy,
        width,
        height,
        originX: full.originX + dx * full.tilesPerPixel,
        originY: full.originY + dy * full.tilesPerPixel,
        tilesPerPixel: full.tilesPerPixel,
      });
    }
  }
  return tiles;
}

/** A rendered tile's pixels, positioned within the full image. */
export interface StitchTile {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Assemble rendered tiles into one full-image RGBA buffer. The app blits tiles
 * straight to the canvas instead (so they appear progressively); this exists for
 * consumers that need a flat buffer, notably the tiled-equals-untiled gate.
 */
export function stitchTiles(
  full: { readonly width: number; readonly height: number },
  tiles: readonly StitchTile[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(full.width * full.height * 4);
  for (const t of tiles) {
    const rowBytes = t.width * 4;
    for (let y = 0; y < t.height; y++) {
      const src = y * rowBytes;
      out.set(t.data.subarray(src, src + rowBytes), ((t.dy + y) * full.width + t.dx) * 4);
    }
  }
  return out;
}

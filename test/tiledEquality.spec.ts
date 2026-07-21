import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";
import { planTiles, stitchTiles, type ImageBox } from "../src/noise/preview/tiling";

// The definitive correctness gate for region tiling: rendering an area as tiles
// must reproduce the single whole-image render byte for byte. The renderer is
// validated point-by-point against headless Factorio as an oracle, so any pixel
// change here is a regression against the game itself, not a matter of taste.
//
// The region below was not picked by hand. A search over the seed's world grid
// rendered every candidate both ways and kept the one where haloless tiling
// differed MOST from the whole render (84 bytes across the cliff seams). Picking
// the region by the gate's own assertion is what guarantees the gate can fail:
// before the cliff halo existed, this case failed with exactly that difference.
const SEAM_SEED = 123456;
const SEAM_ORIGIN_X = 320;
const SEAM_ORIGIN_Y = 64;

function baseReq(over: Partial<ElevationRenderRequest> = {}): ElevationRenderRequest {
  return {
    id: 0,
    seed0: SEAM_SEED,
    width: 64,
    height: 64,
    originX: SEAM_ORIGIN_X,
    originY: SEAM_ORIGIN_Y,
    tilesPerPixel: 1,
    waterLevel: 0,
    segmentationMultiplier: 1,
    startingPositions: [{ x: 0, y: 0 }],
    mapType: "nauvis",
    ...over,
  };
}

/** Render `req` as a grid of `tileSize` tiles and stitch the result. */
function renderTiled(req: ElevationRenderRequest, tileSize: number): Uint8ClampedArray {
  const full: ImageBox = {
    originX: req.originX,
    originY: req.originY,
    width: req.width,
    height: req.height,
    tilesPerPixel: req.tilesPerPixel,
  };
  const fullImage = {
    originX: full.originX,
    originY: full.originY,
    width: full.width,
    height: full.height,
  };
  const tiles = planTiles(full, tileSize).map((t) => {
    const out = runRenderRequest({
      ...req,
      originX: t.originX,
      originY: t.originY,
      width: t.width,
      height: t.height,
      fullImage,
    });
    return {
      dx: t.dx,
      dy: t.dy,
      width: t.width,
      height: t.height,
      data: new Uint8ClampedArray(out.buffer),
    };
  });
  return stitchTiles(full, tiles);
}

function renderWhole(req: ElevationRenderRequest): Uint8ClampedArray {
  return new Uint8ClampedArray(runRenderRequest(req).buffer);
}

describe("tiled render equals untiled render", () => {
  it("matches byte for byte on the cliffs view across a seam", () => {
    const req = baseReq({ view: "cliffs" });
    expect(renderTiled(req, 32)).toEqual(renderWhole(req));
  });
});

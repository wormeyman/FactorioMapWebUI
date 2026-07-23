import { describe, expect, it } from "vite-plus/test";
import { renderRocks } from "../src/noise/preview/renderRocks";
import { makeRockDensity } from "../src/noise/rocks/rockField";
import { ROCK_MAP_COLOR, ROCK_FOOTPRINT_THRESHOLD } from "../src/noise/rocks/rockCatalog";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";

function solidImage(w: number, h: number, rgb: readonly [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("renderRocks", () => {
  const seed0 = 123456;
  const W = 48;
  const H = 48;
  const originX = 288;
  const originY = -216;

  it("paints ROCK_MAP_COLOR exactly where max_i probability_i clears the threshold", () => {
    const field = makeRockDensity({ seed0, startingPositions: [{ x: 0, y: 0 }] });
    const img = solidImage(W, H, [100, 100, 100]); // non-water land
    renderRocks(img, { seed0, originX, originY, startingPositions: [{ x: 0, y: 0 }] });
    let painted = 0;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const o = (py * W + px) * 4;
        const isRock =
          img.data[o] === ROCK_MAP_COLOR[0] &&
          img.data[o + 1] === ROCK_MAP_COLOR[1] &&
          img.data[o + 2] === ROCK_MAP_COLOR[2];
        const shouldRock = field(originX + px, originY + py) >= ROCK_FOOTPRINT_THRESHOLD;
        expect(isRock).toBe(shouldRock);
        if (isRock) painted++;
      }
    }
    // Sparse but present in this region (guards against "painted nothing"/"painted all").
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(W * H);
  });

  it("never paints over water pixels", () => {
    const water = WATER_TILE_COLORS[0];
    const img = solidImage(W, H, water);
    renderRocks(img, { seed0, originX, originY, startingPositions: [{ x: 0, y: 0 }] });
    for (let i = 0; i < W * H; i++) {
      expect(img.data[i * 4]).toBe(water[0]);
      expect(img.data[i * 4 + 1]).toBe(water[1]);
      expect(img.data[i * 4 + 2]).toBe(water[2]);
    }
  });
});

import { describe, expect, it } from "vite-plus/test";
import { renderEnemies } from "../src/noise/preview/renderEnemies";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { ENEMY_MAP_COLOR } from "../src/noise/enemies/enemyCatalog";

// helper: a 1x1 ImageData at a chosen world origin, pre-filled with a land color.
function land1x1(): ImageData {
  const img = { width: 1, height: 1, data: new Uint8ClampedArray([90, 120, 60, 255]) } as ImageData;
  return img;
}

describe("renderEnemies", () => {
  it("leaves the starting area unpainted", () => {
    const img = land1x1();
    renderEnemies(img, {
      seed0: 123456,
      originX: 0,
      originY: 0,
      tilesPerPixel: 1,
      controls: { frequency: 1, size: 1 },
    });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([90, 120, 60]); // untouched
  });
  it("paints a pixel inside a base spot", () => {
    // (1000,1040) had ebp ~0.78 in the fixture region -> min(.,0.25)=0.25 >= T -> painted.
    const img = land1x1();
    renderEnemies(img, {
      seed0: 123456,
      originX: 1000,
      originY: 1040,
      tilesPerPixel: 1,
      controls: { frequency: 1, size: 1 },
    });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([...ENEMY_MAP_COLOR]);
  });
  it("never paints water", () => {
    const [wr, wg, wb] = WATER_TILE_COLORS[0];
    const img = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([wr, wg, wb, 255]),
    } as ImageData;
    renderEnemies(img, {
      seed0: 123456,
      originX: 1000,
      originY: 1040,
      tilesPerPixel: 1,
      controls: { frequency: 1, size: 1 },
    });
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([wr, wg, wb]); // still water
  });
  it("map color drift guard", () => expect([...ENEMY_MAP_COLOR]).toEqual([255, 26, 26]));
});

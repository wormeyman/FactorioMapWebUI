import { describe, expect, it } from "vite-plus/test";
import { renderCliffs } from "../src/noise/preview/renderCliffs";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { CLIFF_MAP_COLOR } from "../src/noise/cliffs/cliffCatalog";

const land = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(90) }) as ImageData;
const settings = { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 };

describe("renderCliffs", () => {
  it("paints cliff cells the cliff color", () => {
    // Render a 64x64 window known to contain cliffs (dense sub-window of the Task 8
    // fixture region [512,1024)^2, which has ~282 cliffs at seed 123456; this window
    // has 39) at tpp 1.
    const img = land(64, 64);
    renderCliffs(img, {
      seed0: 123456,
      originX: 960,
      originY: 512,
      tilesPerPixel: 1,
      controls: { frequency: 1, continuity: 1 },
      settings,
    });
    // At least one pixel became the cliff color.
    let painted = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (
        img.data[i] === CLIFF_MAP_COLOR[0] &&
        img.data[i + 1] === CLIFF_MAP_COLOR[1] &&
        img.data[i + 2] === CLIFF_MAP_COLOR[2]
      )
        painted++;
    expect(painted).toBeGreaterThan(0);
  });
  it("continuity 0 paints nothing", () => {
    const img = land(64, 64);
    renderCliffs(img, {
      seed0: 123456,
      originX: 512,
      originY: 512,
      tilesPerPixel: 1,
      controls: { frequency: 1, continuity: 0 },
      settings,
    });
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(90);
  });
  it("never paints water", () => {
    const [wr, wg, wb] = WATER_TILE_COLORS[0];
    const img = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as ImageData;
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = wr;
      img.data[i + 1] = wg;
      img.data[i + 2] = wb;
      img.data[i + 3] = 255;
    }
    renderCliffs(img, {
      seed0: 123456,
      originX: 960,
      originY: 512,
      tilesPerPixel: 1,
      controls: { frequency: 1, continuity: 1 },
      settings,
    });
    for (let i = 0; i < img.data.length; i += 4)
      expect([img.data[i], img.data[i + 1], img.data[i + 2]]).toEqual([wr, wg, wb]);
  });
  it("map color drift guard", () => expect([...CLIFF_MAP_COLOR]).toEqual([144, 119, 87]));
});

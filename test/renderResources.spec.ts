import { describe, expect, it } from "vite-plus/test";
import { renderResources } from "../src/noise/preview/renderResources";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";

/** A base filled with a sentinel color no resource uses, alpha 255. */
function sentinelBase(w: number, h: number): ImageData {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 7;
    d[i * 4 + 1] = 8;
    d[i * 4 + 2] = 9;
    d[i * 4 + 3] = 255;
  }
  return new ImageData(d, w, h);
}

const catalogColors = new Set(RESOURCE_CATALOG.map((r) => r.mapColor.join(",")));

describe("renderResources", () => {
  it("paints resource patches and leaves terrain (sentinel) elsewhere", () => {
    // 64x64 px at 16 tiles/px over world [512, 1536) - a region with patches.
    const base = sentinelBase(64, 64);
    renderResources(base, {
      seed0: 123456,
      originX: 512,
      originY: 512,
      tilesPerPixel: 16,
      controls: {},
    });

    let painted = 0;
    let sentinel = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const [r, g, b, a] = [
        base.data[i * 4],
        base.data[i * 4 + 1],
        base.data[i * 4 + 2],
        base.data[i * 4 + 3],
      ];
      if (r === 7 && g === 8 && b === 9) {
        sentinel++;
      } else {
        painted++;
        expect(a).toBe(255);
        expect(catalogColors.has(`${r},${g},${b}`)).toBe(true);
      }
    }
    expect(painted).toBeGreaterThan(0); // some ore appears
    expect(sentinel).toBeGreaterThan(0); // but not everywhere
  });

  it("leaves the spawn pixel untouched (no patches inside the fade-in radius)", () => {
    const base = sentinelBase(1, 1);
    renderResources(base, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1, controls: {} });
    expect([base.data[0], base.data[1], base.data[2]]).toEqual([7, 8, 9]);
  });
});

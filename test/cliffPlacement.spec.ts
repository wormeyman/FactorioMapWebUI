import { describe, expect, it } from "vite-plus/test";
import { crossesCliff, makeCliffPlacement } from "../src/noise/cliffs/cliffPlacement";

describe("crossesCliff", () => {
  const I = 40,
    E0 = 10;
  it("no crossing within a band", () => expect(crossesCliff(12, 20, 10, E0, I)).toBe(0)); // both band 0
  it("negative elevation never crosses", () => expect(crossesCliff(-1, 60, 10, E0, I)).toBe(0));
  it("below elevation_0 never crosses", () => expect(crossesCliff(5, 8, 10, E0, I)).toBe(0)); // max<E0
  it("crossing gated OFF when cliffiness avg <= 0.5", () =>
    expect(crossesCliff(45, 55, 0, E0, I)).toBe(0));
  it("signed crossing up", () => {
    // max=55 -> boundary = 10 + 40*floor((55-10)/40)=10+40=50; a=45<50, b=55>50, avg>0.5 -> +1
    expect(crossesCliff(45, 55, 10, E0, I)).toBe(1);
  });
  it("signed crossing down", () => expect(crossesCliff(55, 45, 10, E0, I)).toBe(-1));
});

describe("makeCliffPlacement lattice", () => {
  it("all placed cliffs sit on x≡2, y≡2.5 (mod 4)", () => {
    const pl = makeCliffPlacement({
      seed0: 123456,
      controls: { frequency: 1, continuity: 1 },
      settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
    });
    const cells = pl.placedCells(0, 0, 512, 512);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(((c.x % 4) + 4) % 4).toBe(2);
      expect(((c.y % 4) + 4) % 4).toBeCloseTo(2.5, 9);
    }
  });
  it("continuity 0 places no cliffs", () => {
    const pl = makeCliffPlacement({
      seed0: 123456,
      controls: { frequency: 1, continuity: 0 },
      settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
    });
    expect(pl.placedCells(0, 0, 512, 512).length).toBe(0);
  });
});

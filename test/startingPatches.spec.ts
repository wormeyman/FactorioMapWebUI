import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeStartingPatches } from "../src/noise/resources/startingPatches";

const iron = RESOURCE_CATALOG[0];

describe("makeStartingPatches", () => {
  const start = makeStartingPatches(iron, {
    seed0: 123456,
    controls: { frequency: 1, size: 1, richness: 1 },
    skipSpan: 1,
    skipOffset: 0,
  });
  it("produces a starting patch near spawn (field rises above basement)", () => {
    let maxNear = -Infinity;
    for (let y = -120; y <= 120; y += 4)
      for (let x = -120; x <= 120; x += 4) maxNear = Math.max(maxNear, start.field(x, y));
    // a real starting patch peaks in the hundreds+; basement is deeply negative.
    expect(maxNear).toBeGreaterThan(1);
  });
  it("is basement + blob only far from spawn (no starting spots past 120)", () => {
    // At 1000 tiles out, starting_modulation = 0 everywhere in-region -> no spots.
    // The field is then basement + blobTerm; well below any patch peak (< ~100).
    const far = start.field(1000, 1000);
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeLessThan(100);
  });
});

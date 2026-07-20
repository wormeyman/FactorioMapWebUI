import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";

// Params copied from base/prototypes/entity/resources.lua + the defaults in
// core/lualib/resource-autoplace.lua. See docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md.

describe("RESOURCE_CATALOG", () => {
  it("has the 6 Nauvis resources in patch-set init order", () => {
    expect(RESOURCE_CATALOG.map((r) => r.name)).toEqual([
      "iron-ore",
      "copper-ore",
      "coal",
      "stone",
      "crude-oil",
      "uranium-ore",
    ]);
    RESOURCE_CATALOG.forEach((r, i) => expect(r.patchSetIndex).toBe(i));
  });

  it("carries iron's params from resources.lua", () => {
    const iron = RESOURCE_CATALOG[0];
    expect(iron).toMatchObject({
      name: "iron-ore",
      controlName: "iron-ore",
      baseDensity: 10,
      candidateSpotCount: 22,
      regularRqFactor: 1.1 / 10,
      startingRqFactor: 1.5 / 7,
      baseSpotsPerKm2: 2.5,
      seed1: 100,
      order: "b",
      randomProbability: 1,
      randomSpotSizeMin: 0.25,
      randomSpotSizeMax: 2,
      additionalRichness: 0,
      minimumRichness: 0,
      richnessPostMultiplier: 1,
      hasStartingAreaPlacement: true,
      mapColor: [106, 134, 148],
    });
  });

  it("defaults coal/stone candidate count to 21 and rq factor to /10", () => {
    const coal = RESOURCE_CATALOG.find((r) => r.name === "coal")!;
    expect(coal).toMatchObject({
      baseDensity: 8,
      candidateSpotCount: 21,
      regularRqFactor: 1.0 / 10,
      order: "b",
      hasStartingAreaPlacement: true,
      mapColor: [0, 0, 0],
    });
    const stone = RESOURCE_CATALOG.find((r) => r.name === "stone")!;
    expect(stone.baseDensity).toBe(4);
    expect(stone.mapColor).toEqual([176, 156, 109]);
  });

  it("carries the oil/uranium specials", () => {
    const oil = RESOURCE_CATALOG.find((r) => r.name === "crude-oil")!;
    expect(oil).toMatchObject({
      order: "c",
      baseDensity: 8.2,
      baseSpotsPerKm2: 1.8,
      randomProbability: 1 / 48,
      additionalRichness: 220000,
      randomSpotSizeMin: 1,
      randomSpotSizeMax: 1,
      hasStartingAreaPlacement: false,
      mapColor: [199, 51, 196],
    });
    const u = RESOURCE_CATALOG.find((r) => r.name === "uranium-ore")!;
    expect(u).toMatchObject({
      order: "c",
      baseDensity: 0.9,
      baseSpotsPerKm2: 1.25,
      candidateSpotCount: 21,
      randomSpotSizeMin: 2,
      randomSpotSizeMax: 4,
      hasStartingAreaPlacement: false,
      mapColor: [0, 179, 0],
    });
  });
});

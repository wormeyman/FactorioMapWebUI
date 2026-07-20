import { describe, expect, it } from "vite-plus/test";

import { makeTileCatalog } from "../src/noise/tiles/catalog";
import { waterBase } from "../src/noise/tiles/helpers";

// Task 9: the 21 Nauvis tiles as data, transcribed verbatim from the design
// spec's tile table (docs/superpowers/specs/2026-07-19-milestone2-climate-terrain-design.md).
// Each tile's probability(env) is the game's probability_expression, composed
// from Task 8's helpers over env = { x, y, elevation, aux, moisture }.

const EXPECTED_NAMES = [
  "deepwater",
  "water",
  "grass-1",
  "grass-2",
  "grass-3",
  "grass-4",
  "dry-dirt",
  "dirt-1",
  "dirt-2",
  "dirt-3",
  "dirt-4",
  "dirt-5",
  "dirt-6",
  "dirt-7",
  "sand-1",
  "sand-2",
  "sand-3",
  "red-desert-0",
  "red-desert-1",
  "red-desert-2",
  "red-desert-3",
];

const LAND_ENV = { x: 12.5, y: -37.25, elevation: 3.2, aux: 0.42, moisture: 0.31 };

describe("makeTileCatalog", () => {
  it("has exactly 21 tiles with the expected names, in spec order", () => {
    const catalog = makeTileCatalog(123456);
    expect(catalog).toHaveLength(21);
    expect(catalog.map((t) => t.name)).toEqual(EXPECTED_NAMES);
  });

  it("deepwater and water have no noise layer and reduce to waterBase", () => {
    const catalog = makeTileCatalog(123456);
    const deepwater = catalog.find((t) => t.name === "deepwater")!;
    const water = catalog.find((t) => t.name === "water")!;

    // water_base(-2, 200): 0 at the boundary elevation=-2, 200 well below it.
    expect(deepwater.probability({ x: 0, y: 0, elevation: -2, aux: 0, moisture: 0 })).toBe(
      waterBase(-2, -2, 200),
    );
    expect(deepwater.probability({ x: 0, y: 0, elevation: -3, aux: 0, moisture: 0 })).toBe(
      waterBase(-3, -2, 200),
    );
    // Same (x,y) must not matter for water tiles - no noise_layer_noise term.
    expect(deepwater.probability({ x: 999, y: -999, elevation: -3, aux: 0, moisture: 0 })).toBe(
      waterBase(-3, -2, 200),
    );

    // water_base(0, 100).
    expect(water.probability({ x: 0, y: 0, elevation: 0, aux: 0, moisture: 0 })).toBe(
      waterBase(0, 0, 100),
    );
    expect(water.probability({ x: 0, y: 0, elevation: -0.5, aux: 0, moisture: 0 })).toBe(
      waterBase(-0.5, 0, 100),
    );
    expect(water.probability({ x: 555, y: -444, elevation: -0.5, aux: 0, moisture: 0 })).toBe(
      waterBase(-0.5, 0, 100),
    );
  });

  it("spot-checks map_color against the spec table", () => {
    const catalog = makeTileCatalog(123456);
    const byName = new Map(catalog.map((t) => [t.name, t]));

    expect(byName.get("deepwater")!.color).toEqual([38, 64, 73, 255]);
    expect(byName.get("water")!.color).toEqual([51, 83, 95, 255]);
    expect(byName.get("grass-1")!.color).toEqual([55, 53, 11, 255]);
    expect(byName.get("sand-1")!.color).toEqual([138, 103, 58, 255]);
    expect(byName.get("red-desert-3")!.color).toEqual([128, 93, 52, 255]);
    // Spec's table lists sand-2 and red-desert-3 with the identical map_color
    // (128,93,52) - transcribed verbatim, not a typo we should "fix".
    expect(byName.get("sand-2")!.color).toEqual([128, 93, 52, 255]);
  });

  it("every tile's probability() evaluates without throwing for a land env", () => {
    // Water tiles are deliberately excluded above their maxElevation (waterBase
    // returns -Infinity - "never selected by the resolver's argmax", per
    // src/noise/tiles/helpers.ts), so LAND_ENV's elevation=3.2 correctly makes
    // deepwater/water non-finite here; that is the intended exclusion, not a bug.
    const catalog = makeTileCatalog(123456);
    for (const tile of catalog) {
      let value: number = NaN;
      expect(() => {
        value = tile.probability(LAND_ENV);
      }, `${tile.name} should not throw`).not.toThrow();
      expect(Number.isNaN(value), `${tile.name} probability should not be NaN`).toBe(false);
    }
  });

  it("the 19 land tiles' probability() is finite for a land env", () => {
    const catalog = makeTileCatalog(123456);
    for (const tile of catalog) {
      if (tile.name === "deepwater" || tile.name === "water") continue;
      const value = tile.probability(LAND_ENV);
      expect(Number.isFinite(value), `${tile.name} probability should be finite`).toBe(true);
    }
  });

  it("every tile's color is a 4-tuple of 0-255 ints with alpha 255", () => {
    const catalog = makeTileCatalog(123456);
    for (const tile of catalog) {
      expect(tile.color, `${tile.name} color length`).toHaveLength(4);
      const [r, g, b, a] = tile.color;
      for (const c of [r, g, b]) {
        expect(Number.isInteger(c), `${tile.name} color component integer`).toBe(true);
        expect(c, `${tile.name} color component range`).toBeGreaterThanOrEqual(0);
        expect(c, `${tile.name} color component range`).toBeLessThanOrEqual(255);
      }
      expect(a, `${tile.name} alpha`).toBe(255);
    }
  });

  it("land tiles vary with (x,y) via their noise_layer_noise term", () => {
    const catalog = makeTileCatalog(123456);
    const grass1 = catalog.find((t) => t.name === "grass-1")!;
    const a = grass1.probability({ x: 0, y: 0, elevation: 3, aux: 0.42, moisture: 0.31 });
    const b = grass1.probability({ x: 4000, y: -2500, elevation: 3, aux: 0.42, moisture: 0.31 });
    expect(a).not.toBe(b);
  });

  it("distinct land tiles use distinct noise_layer_noise seeds (independent closures)", () => {
    const catalog = makeTileCatalog(123456);
    const grass1 = catalog.find((t) => t.name === "grass-1")!;
    const grass2 = catalog.find((t) => t.name === "grass-2")!;
    // Same (x,y), but different climate boxes AND different layer seeds - just
    // assert they are not forced to be identical (would indicate a shared/bugged
    // layer closure).
    const envA = { x: 17, y: -31, elevation: 3, aux: 0.6, moisture: 0.6 };
    expect(grass1.probability(envA)).not.toBe(grass2.probability(envA));
  });
});

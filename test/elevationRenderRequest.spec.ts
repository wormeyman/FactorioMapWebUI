import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";
import { renderElevation, LAND_RGBA, WATER_RGBA } from "../src/noise/preview/renderElevation";
import { renderTerrain } from "../src/noise/preview/renderTerrain";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";

const REQ: ElevationRenderRequest = {
  id: 7,
  seed0: 123456,
  width: 8,
  height: 6,
  originX: -16,
  originY: -16,
  tilesPerPixel: 4,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
};

describe("runRenderRequest", () => {
  it("echoes id/width/height and returns an RGBA buffer of the right size", () => {
    const r = runRenderRequest(REQ);
    expect(r.id).toBe(7);
    expect(r.width).toBe(8);
    expect(r.height).toBe(6);
    expect(r.buffer.byteLength).toBe(8 * 6 * 4);
  });

  it("produces bytes identical to a direct renderElevation call", () => {
    const direct = renderElevation({
      seed0: REQ.seed0,
      width: REQ.width,
      height: REQ.height,
      originX: REQ.originX,
      originY: REQ.originY,
      tilesPerPixel: REQ.tilesPerPixel,
      ctx: {
        waterLevel: REQ.waterLevel,
        segmentationMultiplier: REQ.segmentationMultiplier,
        startingPositions: REQ.startingPositions,
      },
    });
    const got = new Uint8ClampedArray(runRenderRequest(REQ).buffer);
    expect(Array.from(got)).toEqual(Array.from(direct.data));
  });

  it("dispatches mapType 'nauvis' to renderElevation's nauvis factory", () => {
    const nauvisReq: ElevationRenderRequest = { ...REQ, mapType: "nauvis" };
    const direct = renderElevation({
      seed0: REQ.seed0,
      width: REQ.width,
      height: REQ.height,
      originX: REQ.originX,
      originY: REQ.originY,
      tilesPerPixel: REQ.tilesPerPixel,
      mapType: "nauvis",
      ctx: {
        waterLevel: REQ.waterLevel,
        segmentationMultiplier: REQ.segmentationMultiplier,
        startingPositions: REQ.startingPositions,
      },
    });
    const got = new Uint8ClampedArray(runRenderRequest(nauvisReq).buffer);
    expect(Array.from(got)).toEqual(Array.from(direct.data));
  });

  it("forwards mapType through to the render, flipping the pixel at a discriminating point", () => {
    // World point (-1200, -1162), seed 123456: makeElevationNauvis = +2.34 (LAND),
    // makeElevationLakes = -6.81 (WATER). If runRenderRequest dropped/reversed the
    // mapType forwarding, both requests would render the same color here.
    const base: ElevationRenderRequest = {
      id: 1,
      seed0: 123456,
      width: 1,
      height: 1,
      originX: -1200,
      originY: -1162,
      tilesPerPixel: 1,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
    };

    const nauvisBuf = new Uint8ClampedArray(
      runRenderRequest({ ...base, mapType: "nauvis" }).buffer,
    );
    expect(Array.from(nauvisBuf.slice(0, 4))).toEqual(LAND_RGBA);

    const lakesBuf = new Uint8ClampedArray(runRenderRequest({ ...base, mapType: "lakes" }).buffer);
    expect(Array.from(lakesBuf.slice(0, 4))).toEqual(WATER_RGBA);
  });

  it("view 'terrain' dispatches to renderTerrain, producing terrain-tile colors", () => {
    // World point (2742, 8459), seed 123456: a known deep-water point from
    // renderTerrain.spec.ts (deepwater color [38, 64, 73, 255]) - distinct from
    // renderElevation's flat WATER_RGBA, so this proves the terrain renderer ran.
    const req: ElevationRenderRequest = {
      id: 9,
      seed0: 123456,
      width: 1,
      height: 1,
      originX: 2742,
      originY: 8459,
      tilesPerPixel: 1,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
      view: "terrain",
    };
    const direct = renderTerrain({
      seed0: req.seed0,
      width: req.width,
      height: req.height,
      originX: req.originX,
      originY: req.originY,
      tilesPerPixel: req.tilesPerPixel,
      ctx: { segmentationMultiplier: req.segmentationMultiplier },
    });
    const got = new Uint8ClampedArray(runRenderRequest(req).buffer);
    expect(Array.from(got)).toEqual(Array.from(direct.data));
    expect(Array.from(got)).toEqual([38, 64, 73, 255]);
  });

  it("view 'terrain' forwards climate fields, changing some pixel under a shifted aux bias", () => {
    // A 20x20 land-ward grid (aux/moisture drive most of the catalog's
    // expression_in_range boxes, so a +0.5 aux bias reliably flips some
    // pixel's argmax winner somewhere in a grid this size) - proving
    // runRenderRequest forwards moistureFrequency/moistureBias/auxFrequency/
    // auxBias/startingAreaMoistureSize/startingAreaMoistureFrequency through
    // to renderTerrain's ctx rather than dropping them.
    const req: ElevationRenderRequest = {
      id: 10,
      seed0: 123456,
      width: 20,
      height: 20,
      originX: -2000,
      originY: -2000,
      tilesPerPixel: 200,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
      view: "terrain",
      auxBias: 0.5,
    };
    const direct = renderTerrain({
      seed0: req.seed0,
      width: req.width,
      height: req.height,
      originX: req.originX,
      originY: req.originY,
      tilesPerPixel: req.tilesPerPixel,
      ctx: { segmentationMultiplier: req.segmentationMultiplier, auxBias: 0.5 },
    });
    const got = new Uint8ClampedArray(runRenderRequest(req).buffer);
    expect(Array.from(got)).toEqual(Array.from(direct.data));

    const baseline = new Uint8ClampedArray(runRenderRequest({ ...req, auxBias: undefined }).buffer);
    expect(Array.from(got)).not.toEqual(Array.from(baseline));
  });

  it("view 'resources' overlays ore on the terrain (differs from terrain only where ore is)", () => {
    // 32x32 px at 16 tiles/px over world [512, 1024) - a region with patches.
    const terrainReq: ElevationRenderRequest = {
      id: 11,
      seed0: 123456,
      width: 32,
      height: 32,
      originX: 512,
      originY: 512,
      tilesPerPixel: 16,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
      view: "terrain",
    };
    const terrain = new Uint8ClampedArray(runRenderRequest(terrainReq).buffer);
    const withOre = new Uint8ClampedArray(
      runRenderRequest({ ...terrainReq, view: "resources" }).buffer,
    );

    const catalogColors = new Set(RESOURCE_CATALOG.map((r) => r.mapColor.join(",")));
    let differing = 0;
    for (let i = 0; i < terrain.length; i += 4) {
      const same =
        terrain[i] === withOre[i] &&
        terrain[i + 1] === withOre[i + 1] &&
        terrain[i + 2] === withOre[i + 2] &&
        terrain[i + 3] === withOre[i + 3];
      if (same) continue;
      differing++;
      // A differing pixel must be an opaque catalog color (the overlay).
      expect(withOre[i + 3]).toBe(255);
      expect(catalogColors.has(`${withOre[i]},${withOre[i + 1]},${withOre[i + 2]}`)).toBe(true);
    }
    expect(differing).toBeGreaterThan(0); // ore appears
    expect(differing).toBeLessThan(32 * 32); // but not everywhere
  });

  it("view 'resources' never paints ore over water (terrain water pixels are preserved)", () => {
    // A large view that includes open water; every pixel the terrain drew as
    // deepwater/water must be byte-identical in the resources render (ore excluded).
    const terrainReq: ElevationRenderRequest = {
      id: 13,
      seed0: 2883961880,
      width: 128,
      height: 128,
      originX: -512,
      originY: -512,
      tilesPerPixel: 8,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
      view: "terrain",
    };
    const terrain = new Uint8ClampedArray(runRenderRequest(terrainReq).buffer);
    const withOre = new Uint8ClampedArray(
      runRenderRequest({ ...terrainReq, view: "resources" }).buffer,
    );
    const water = new Set([
      [38, 64, 73].join(","), // deepwater
      [51, 83, 95].join(","), // water
    ]);
    let waterPixels = 0;
    for (let i = 0; i < terrain.length; i += 4) {
      if (!water.has(`${terrain[i]},${terrain[i + 1]},${terrain[i + 2]}`)) continue;
      waterPixels++;
      // unchanged: same bytes as the terrain render
      expect([withOre[i], withOre[i + 1], withOre[i + 2], withOre[i + 3]]).toEqual([
        terrain[i],
        terrain[i + 1],
        terrain[i + 2],
        terrain[i + 3],
      ]);
    }
    expect(waterPixels).toBeGreaterThan(0); // the view really does contain water
  });

  it("view 'resources' forwards resourceControls (iron size 0 removes iron pixels)", () => {
    const base: ElevationRenderRequest = {
      id: 12,
      seed0: 123456,
      width: 32,
      height: 32,
      originX: 512,
      originY: 512,
      tilesPerPixel: 16,
      waterLevel: 0,
      segmentationMultiplier: 1,
      startingPositions: [{ x: 0, y: 0 }],
      view: "resources",
    };
    const iron = RESOURCE_CATALOG.find((r) => r.name === "iron-ore")!;
    const ironColor = iron.mapColor.join(",");
    const countIron = (buf: Uint8ClampedArray): number => {
      let n = 0;
      for (let i = 0; i < buf.length; i += 4) {
        if (`${buf[i]},${buf[i + 1]},${buf[i + 2]}` === ironColor && buf[i + 3] === 255) n++;
      }
      return n;
    };
    const withIron = new Uint8ClampedArray(runRenderRequest(base).buffer);
    const noIron = new Uint8ClampedArray(
      runRenderRequest({
        ...base,
        resourceControls: { "iron-ore": { frequency: 1, size: 0, richness: 1 } },
      }).buffer,
    );
    expect(countIron(withIron)).toBeGreaterThan(0);
    expect(countIron(noIron)).toBe(0);
  });

  it("view 'elevation' (explicit or default/omitted) keeps the water/land mask", () => {
    const explicit = new Uint8ClampedArray(runRenderRequest({ ...REQ, view: "elevation" }).buffer);
    const omitted = new Uint8ClampedArray(runRenderRequest(REQ).buffer);
    expect(Array.from(explicit)).toEqual(Array.from(omitted));
    // Every pixel of the flat elevation mask is exactly LAND_RGBA or WATER_RGBA
    // - neither matches the terrain deepwater color proven above, so this locks
    // in that omitting/explicitly requesting "elevation" never routes through
    // renderTerrain.
    const landOrWater = [LAND_RGBA, WATER_RGBA].map((c) => JSON.stringify(c));
    for (let i = 0; i < explicit.length; i += 4) {
      const px = JSON.stringify(Array.from(explicit.slice(i, i + 4)));
      expect(landOrWater).toContain(px);
    }
  });
});

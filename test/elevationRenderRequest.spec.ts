import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";
import { renderElevation, LAND_RGBA, WATER_RGBA } from "../src/noise/preview/renderElevation";
import { renderTerrain } from "../src/noise/preview/renderTerrain";

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

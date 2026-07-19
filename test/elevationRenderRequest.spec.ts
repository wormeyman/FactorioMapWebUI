import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";
import { renderElevation } from "../src/noise/preview/renderElevation";

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
});

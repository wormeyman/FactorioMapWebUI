import { describe, it, expect } from "vite-plus/test";
import { elevationCtxFromPreset } from "../src/model/elevationPreviewCtx";
import { getBuiltinPreset } from "../src/model/builtins";
import { writeMapType } from "../src/model/mapType";
import type { Preset } from "../src/model/types";

function lakesPreset(): Preset {
  const p = getBuiltinPreset("Default");
  writeMapType(p.propertyExpressionNames, "lakes");
  return p;
}

describe("elevationCtxFromPreset", () => {
  it("marks a Lakes preset supported with its label", () => {
    const r = elevationCtxFromPreset(lakesPreset());
    expect(r.supported).toBe(true);
    expect(r.mapTypeLabel).toBe("Lakes elevation");
    expect(r.mapType).toBe("lakes");
  });

  it("marks the default (Nauvis) preset supported with its label and map type", () => {
    const r = elevationCtxFromPreset(getBuiltinPreset("Default"));
    expect(r.supported).toBe(true);
    expect(r.mapTypeLabel).toBe("Nauvis elevation");
    expect(r.mapType).toBe("nauvis");
  });

  it("marks an Island preset unsupported", () => {
    const p = getBuiltinPreset("Default");
    writeMapType(p.propertyExpressionNames, "island");
    const r = elevationCtxFromPreset(p);
    expect(r.supported).toBe(false);
    expect(r.mapTypeLabel).toBe("Island elevation");
  });

  it("derives waterLevel = 10*log2(size) and segmentation = frequency", () => {
    const p = lakesPreset();
    p.autoplaceControls.water = { frequency: 0.5, size: 4, richness: 1 };
    const r = elevationCtxFromPreset(p);
    expect(r.ctx.waterLevel).toBeCloseTo(20, 10); // 10*log2(4)
    expect(r.ctx.segmentationMultiplier).toBe(0.5);
  });

  it("falls back to renderer defaults when water is absent", () => {
    const p = lakesPreset();
    delete p.autoplaceControls.water;
    const r = elevationCtxFromPreset(p);
    expect(r.ctx.waterLevel).toBe(0); // 10*log2(1)
    expect(r.ctx.segmentationMultiplier).toBe(1);
  });

  it("guards a disabled (size 0) water control against -Infinity", () => {
    const p = lakesPreset();
    p.autoplaceControls.water = { frequency: 1, size: 0, richness: 1 };
    expect(elevationCtxFromPreset(p).ctx.waterLevel).toBe(0);
  });

  it("maps starting points, defaulting to a single origin spawn when empty", () => {
    const p = lakesPreset();
    p.startingPoints = [{ x: 12, y: -8 }];
    expect(elevationCtxFromPreset(p).ctx.startingPositions).toEqual([{ x: 12, y: -8 }]);
    p.startingPoints = [];
    expect(elevationCtxFromPreset(p).ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
  });
});

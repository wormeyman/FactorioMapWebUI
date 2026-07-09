import { describe, expect, it } from "vite-plus/test";
import { BUILTIN_NAMES, getBuiltinPreset, getBuiltinPresets } from "../src/model/builtins";
import fixtures from "./fixtures/builtin-presets.json";

describe("builtin presets", () => {
  it("exposes all 9 fixtures as presets, in fixture order", () => {
    expect(BUILTIN_NAMES).toEqual(Object.keys(fixtures.presets));
    expect(getBuiltinPresets().map((p) => p.name)).toEqual(BUILTIN_NAMES);
    for (const preset of getBuiltinPresets()) {
      expect(preset.builtin).toBe(true);
      expect(preset.formatVersion).toEqual([2, 1, 9, 3]);
      expect(Object.keys(preset.autoplaceControls)).toHaveLength(28);
      expect(typeof preset.width).toBe("number");
      expect(typeof preset.height).toBe("number");
      expect(typeof preset.seed).toBe("number");
      expect(typeof preset.startingArea).toBe("number");
      expect(typeof preset.defaultEnableAllAutoplaceControls).toBe("boolean");
      expect(preset.areaToGenerateAtStart.leftTop).toEqual({ x: -224, y: -224 });
      expect(preset.areaToGenerateAtStart.rightBottom).toEqual({ x: 224, y: 224 });
      expect(preset.startingPoints).toEqual([{ x: 0, y: 0 }]);
      expect(preset.opaqueTailB64.length).toBeGreaterThan(0);
    }
  });

  it("Default preset has all controls at 1.0 frequency/size/richness", () => {
    const preset = getBuiltinPreset("Default");
    for (const value of Object.values(preset.autoplaceControls)) {
      expect(value.frequency).toBe(1);
      expect(value.size).toBe(1);
    }
  });

  it("Rich Resources preset carries richness 2 on nauvis coal", () => {
    expect(getBuiltinPreset("Rich Resources").autoplaceControls["coal"]?.richness).toBe(2);
  });

  it("getBuiltinPreset returns an independent deep clone", () => {
    const a = getBuiltinPreset("Default");
    const coal = a.autoplaceControls["coal"];
    if (coal) coal.frequency = 99;
    expect(getBuiltinPreset("Default").autoplaceControls["coal"]?.frequency).toBe(1);
  });

  it("throws on an unknown builtin name", () => {
    expect(() => getBuiltinPreset("Nope")).toThrow(/unknown builtin/i);
  });
});

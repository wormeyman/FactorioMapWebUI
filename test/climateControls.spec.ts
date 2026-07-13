import { describe, expect, it } from "vite-plus/test";
import {
  MOISTURE,
  TERRAIN_TYPE,
  readBias,
  readScale,
  writeBias,
  writeScale,
} from "../src/model/climateControls";
import { PERCENT_STEPS } from "../src/model/controlScale";

describe("readScale / writeScale", () => {
  it("defaults to multiplier 1 when the freq key is absent", () => {
    expect(readScale({}, MOISTURE)).toBe(1);
  });

  it("inverts the stored frequency into a scale multiplier", () => {
    expect(readScale({ "control:moisture:frequency": "0.666667" }, MOISTURE)).toBeCloseTo(1.5, 4);
    expect(readScale({ "control:moisture:frequency": "6.000000" }, MOISTURE)).toBeCloseTo(1 / 6, 4);
  });

  it("writes 150% as the inverse frequency string", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, MOISTURE, Math.fround(3 / 2));
    expect(pen["control:moisture:frequency"]).toBe("0.666667");
  });

  it("writes 600% as 0.166667", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, MOISTURE, Math.fround(6));
    expect(pen["control:moisture:frequency"]).toBe("0.166667");
  });

  it("deletes the freq key when writing the default 100% notch", () => {
    const pen: Record<string, string> = { "control:moisture:frequency": "0.500000" };
    writeScale(pen, MOISTURE, 1);
    expect("control:moisture:frequency" in pen).toBe(false);
  });

  const SCALE_NOTCH_TABLE: Array<{ percent: number; wire: string | undefined }> = [
    { percent: 17, wire: "6.000000" },
    { percent: 25, wire: "4.000000" },
    { percent: 33, wire: "3.000000" },
    { percent: 50, wire: "2.000000" },
    { percent: 75, wire: "1.333333" },
    { percent: 100, wire: undefined },
    { percent: 133, wire: "0.750000" },
    { percent: 150, wire: "0.666667" },
    { percent: 200, wire: "0.500000" },
    { percent: 300, wire: "0.333333" },
    { percent: 400, wire: "0.250000" },
    { percent: 600, wire: "0.166667" },
  ];

  it.each(SCALE_NOTCH_TABLE)(
    "writes the $percent% notch as $wire on the wire",
    ({ percent, wire }) => {
      const step = PERCENT_STEPS.find((s) => s.percent === percent);
      expect(step, `no PERCENT_STEPS entry for ${percent}%`).toBeDefined();
      const pen: Record<string, string> = {};
      writeScale(pen, MOISTURE, step!.value);
      if (wire === undefined) {
        expect("control:moisture:frequency" in pen).toBe(false);
      } else {
        expect(pen["control:moisture:frequency"]).toBe(wire);
      }
    },
  );

  it("uses the aux keys for terrain type", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, TERRAIN_TYPE, Math.fround(6));
    expect(pen["control:aux:frequency"]).toBe("0.166667");
  });

  it("reads an off-notch imported frequency without rewriting it (non-mutating)", () => {
    const pen: Record<string, string> = { "control:moisture:frequency": "5" };
    expect(readScale(pen, MOISTURE)).toBeCloseTo(0.2, 6);
    expect(pen["control:moisture:frequency"]).toBe("5");
  });
});

describe("readBias / writeBias", () => {
  it("defaults to 0 when the bias key is absent", () => {
    expect(readBias({}, MOISTURE)).toBe(0);
  });

  it("reads the stored bias directly", () => {
    expect(readBias({ "control:moisture:bias": "0.500000" }, MOISTURE)).toBe(0.5);
    expect(readBias({ "control:moisture:bias": "-0.500000" }, MOISTURE)).toBe(-0.5);
  });

  it("writes a bias notch as a fixed-6 string", () => {
    const pen: Record<string, string> = {};
    writeBias(pen, MOISTURE, 0.05);
    expect(pen["control:moisture:bias"]).toBe("0.050000");
  });

  it("writes +0.50 and -0.50 on the aux key", () => {
    const pen: Record<string, string> = {};
    writeBias(pen, TERRAIN_TYPE, 0.5);
    expect(pen["control:aux:bias"]).toBe("0.500000");
    writeBias(pen, TERRAIN_TYPE, -0.5);
    expect(pen["control:aux:bias"]).toBe("-0.500000");
  });

  it("deletes the bias key when writing the default 0 notch", () => {
    const pen: Record<string, string> = { "control:moisture:bias": "0.500000" };
    writeBias(pen, MOISTURE, 0);
    expect("control:moisture:bias" in pen).toBe(false);
  });
});

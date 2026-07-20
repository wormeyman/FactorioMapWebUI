import { describe, expect, it } from "vite-plus/test";
import { readClimateControls } from "../src/model/climateReads";

describe("readClimateControls", () => {
  it("returns game defaults when the pen is empty", () => {
    const result = readClimateControls({});
    expect(result).toEqual({
      temperature: { frequency: 1, bias: 0 },
      moisture: { frequency: 1, bias: 0 },
      aux: { frequency: 1, bias: 0 },
      startingAreaMoisture: { size: 1, frequency: 1 },
      waterFrequency: 1,
    });
  });

  it("reads raw wire frequency values directly (NOT 1/scale)", () => {
    const pen: Record<string, string> = {
      "control:temperature:frequency": "2.000000",
      "control:moisture:frequency": "0.500000",
      "control:aux:frequency": "4.000000",
      "control:starting_area_moisture:frequency": "3.000000",
      "control:water:frequency": "0.250000",
    };
    const result = readClimateControls(pen);
    expect(result.temperature.frequency).toBe(2);
    expect(result.moisture.frequency).toBe(0.5);
    expect(result.aux.frequency).toBe(4);
    expect(result.startingAreaMoisture.frequency).toBe(3);
    expect(result.waterFrequency).toBe(0.25);
  });

  it("reads bias values for temperature, aux, and moisture when present", () => {
    const pen: Record<string, string> = {
      "control:temperature:bias": "0.150000",
      "control:aux:bias": "-0.300000",
      "control:moisture:bias": "0.450000",
    };
    const result = readClimateControls(pen);
    expect(result.temperature.bias).toBeCloseTo(0.15, 6);
    expect(result.aux.bias).toBeCloseTo(-0.3, 6);
    expect(result.moisture.bias).toBeCloseTo(0.45, 6);
  });

  it("reads starting_area_moisture size when present", () => {
    const result = readClimateControls({ "control:starting_area_moisture:size": "2.000000" });
    expect(result.startingAreaMoisture.size).toBe(2);
  });
});

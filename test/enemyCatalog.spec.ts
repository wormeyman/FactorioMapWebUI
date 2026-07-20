import { describe, expect, it } from "vite-plus/test";
import {
  enemyDensity,
  enemyFrequency,
  enemyIntensity,
  enemySpotQuantity,
  enemySpotRadius,
} from "../src/noise/enemies/enemyCatalog";

const c = { frequency: 1, size: 1 };

describe("enemy catalog math (default controls)", () => {
  // intensity = clamp(d,0,2400)/325 : 0 at d=0, 1000/325=3.0769 at d=1000, 2400/325=7.3846 saturated
  it("intensity", () => {
    expect(enemyIntensity(0)).toBeCloseTo(0, 6);
    expect(enemyIntensity(1000)).toBeCloseTo(1000 / 325, 6);
    expect(enemyIntensity(3000)).toBeCloseTo(2400 / 325, 6); // clamped at 2400
  });
  // radius = sqrt(1)*(15 + 4*intensity): 15 at d=0; 15 + 4*3.0769 = 27.3077 at d=1000
  it("spot radius", () => {
    expect(enemySpotRadius(0, c)).toBeCloseTo(15, 6);
    expect(enemySpotRadius(1000, c)).toBeCloseTo(15 + 4 * (1000 / 325), 6);
  });
  // quantity = pi/90 * radius^3 : pi/90 * 15^3 at d=0
  it("spot quantity", () => {
    expect(enemySpotQuantity(0, c)).toBeCloseTo((Math.PI / 90) * 15 ** 3, 6);
  });
  // frequency = (1e-5 + 3e-6*intensity)*1 : 1e-5 at d=0
  it("frequency", () => {
    expect(enemyFrequency(0, c)).toBeCloseTo(1e-5, 12);
    expect(enemyFrequency(1000, c)).toBeCloseTo(1e-5 + 3e-6 * (1000 / 325), 12);
  });
  // density = quantity * max(0, frequency)
  it("density", () => {
    expect(enemyDensity(0, c)).toBeCloseTo((Math.PI / 90) * 15 ** 3 * 1e-5, 9);
  });
  // size 0 -> radius 0 -> quantity 0 -> density 0 (disabled enemies)
  it("size 0 collapses the field", () => {
    expect(enemySpotRadius(500, { frequency: 1, size: 0 })).toBe(0);
    expect(enemyDensity(500, { frequency: 1, size: 0 })).toBe(0);
  });
});

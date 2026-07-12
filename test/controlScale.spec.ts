import { describe, it, expect } from "vite-plus/test";
import { PERCENT_STEPS, stepValue, nearestStepIndex, formatPercent } from "../src/model/controlScale";

describe("PERCENT_STEPS", () => {
  it("has the twelve Factorio percentages in order", () => {
    expect(PERCENT_STEPS.map((s) => s.percent)).toEqual([
      17, 25, 33, 50, 75, 100, 133, 150, 200, 300, 400, 600,
    ]);
  });

  it("stores exact float32 step values", () => {
    expect(PERCENT_STEPS[2].value).toBe(Math.fround(1 / 3)); // 0.3333333432674408
    expect(PERCENT_STEPS[6].value).toBe(Math.fround(4 / 3)); // 1.3333333730697632
    expect(PERCENT_STEPS[5].value).toBe(1);
    expect(PERCENT_STEPS[11].value).toBe(6);
  });
});

describe("stepValue / nearestStepIndex", () => {
  it("round-trips every on-scale value", () => {
    for (const s of PERCENT_STEPS) {
      expect(stepValue(nearestStepIndex(s.value))).toBe(s.value);
    }
  });

  it("clamps the index in stepValue", () => {
    expect(stepValue(-3)).toBe(PERCENT_STEPS[0].value);
    expect(stepValue(99)).toBe(PERCENT_STEPS[11].value);
  });

  it("uses log-ratio distance for off-scale values", () => {
    expect(nearestStepIndex(5)).toBe(11); // 500%: closer to 600% than 400% in log space
    expect(nearestStepIndex(0.6)).toBe(3); // 60%: closer to 50% than 75%
    expect(nearestStepIndex(1000)).toBe(11);
    expect(nearestStepIndex(0)).toBe(0);
    expect(nearestStepIndex(-5)).toBe(0);
  });

  it("breaks ties toward the higher step", () => {
    const tie = Math.sqrt(stepValue(5) * stepValue(6)); // geo mean of 100% and 133%
    expect(nearestStepIndex(tie)).toBe(6);
  });
});

describe("formatPercent", () => {
  it("formats the true percentage of any value", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(Math.fround(1 / 6))).toBe("17%");
    expect(formatPercent(5)).toBe("500%");
  });
});

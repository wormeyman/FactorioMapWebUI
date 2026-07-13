import { describe, it, expect } from "vite-plus/test";
import { mount } from "@vue/test-utils";
import FPercentSlider from "../src/ui/FPercentSlider.vue";
import { BIAS_SCALE } from "../src/model/controlScale";

describe("FPercentSlider", () => {
  it("positions the thumb and label for an on-scale value", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("5"); // 100% is index 5
    expect(input.attributes("aria-valuetext")).toBe("100%");
    expect(w.text()).toContain("100%");
  });

  it("emits the exact step float on input", async () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "8"; // 200%
    await input.trigger("input");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([2]);
  });

  it("shows an off-scale value's true percent at the nearest notch", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 5 } });
    const input = w.find("input");
    expect(w.text()).toContain("500%");
    expect((input.element as HTMLInputElement).value).toBe("11");
  });

  it("respects disabled", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1, disabled: true } });
    expect((w.find("input").element as HTMLInputElement).disabled).toBe(true);
  });
});

describe("FPercentSlider with a custom scale", () => {
  it("renders bias notches, label, and aria-label", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 0.05, scale: BIAS_SCALE } });
    const input = w.find("input");
    expect(input.attributes("max")).toBe("20"); // 21 notches
    expect((input.element as HTMLInputElement).value).toBe("11"); // +0.05 is index 11
    expect(input.attributes("aria-valuetext")).toBe("+0.05");
    expect(input.attributes("aria-label")).toBe("Bias");
    expect(w.text()).toContain("+0.05");
  });

  it("emits the bias notch value on input", async () => {
    const w = mount(FPercentSlider, { props: { modelValue: 0, scale: BIAS_SCALE } });
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "0"; // -0.50
    await input.trigger("input");
    expect(w.emitted("update:modelValue")?.[0]?.[0]).toBeCloseTo(-0.5, 10);
  });

  it("keeps the percentage aria-label by default", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    expect(w.find("input").attributes("aria-label")).toBe("Percentage");
  });
});

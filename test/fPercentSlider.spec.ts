import { describe, it, expect } from "vite-plus/test";
import { mount } from "@vue/test-utils";
import FPercentSlider from "../src/ui/FPercentSlider.vue";

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

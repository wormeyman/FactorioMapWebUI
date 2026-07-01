import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vite-plus/test";
import FButton from "../src/ui/FButton.vue";
import FCheckbox from "../src/ui/FCheckbox.vue";
import FDropdown from "../src/ui/FDropdown.vue";
import FNumberInput from "../src/ui/FNumberInput.vue";
import FSlider from "../src/ui/FSlider.vue";
import FTabs from "../src/ui/FTabs.vue";

describe("Factorio UI kit", () => {
  it("FSlider emits numeric update:modelValue", async () => {
    const w = mount(FSlider, { props: { modelValue: 1 } });
    await w.find("input").setValue("2.5");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([2.5]);
  });

  it("FNumberInput emits numbers and ignores non-numeric input", async () => {
    const w = mount(FNumberInput, { props: { modelValue: 1 } });
    await w.find("input").setValue("4");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([4]);
    await w.find("input").setValue("");
    expect(w.emitted("update:modelValue")).toHaveLength(1);
  });

  it("FCheckbox toggles", async () => {
    const w = mount(FCheckbox, { props: { modelValue: false, label: "Auto-refresh" } });
    expect(w.text()).toContain("Auto-refresh");
    await w.find("input").setValue(true);
    expect(w.emitted("update:modelValue")?.[0]).toEqual([true]);
  });

  it("FDropdown renders options and emits selection", async () => {
    const w = mount(FDropdown, {
      props: {
        modelValue: "nauvis",
        options: [
          { value: "nauvis", label: "Nauvis" },
          { value: "gleba", label: "Gleba" },
        ],
      },
    });
    await w.find("select").setValue("gleba");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["gleba"]);
  });

  it("FTabs marks the active tab and emits on click", async () => {
    const w = mount(FTabs, {
      props: { modelValue: "Resources", tabs: ["Resources", "Terrain"] },
    });
    const buttons = w.findAll("button");
    expect(buttons[0]?.classes()).toContain("active");
    await buttons[1]?.trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["Terrain"]);
  });

  it("FButton emits click, honors disabled", async () => {
    const w = mount(FButton, { props: { variant: "danger" }, slots: { default: "Delete" } });
    await w.find("button").trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
    const d = mount(FButton, { props: { disabled: true } });
    await d.find("button").trigger("click");
    expect(d.emitted("click")).toBeUndefined();
  });
});

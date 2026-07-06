import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import PresetBar from "../src/components/PresetBar.vue";
import { usePresetsStore } from "../src/store/presets";

describe("PresetBar seed reroll", () => {
  afterEach(() => vi.restoreAllMocks());

  it("assigns a fresh concrete seed and turns off random-each-map on click", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    // Deterministic reroll: Math.random -> 0.5.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const wrapper = mount(PresetBar);

    await wrapper.find('[data-test="seed-reroll"]').trigger("click");

    // 1 + floor(0.5 * 0xffffffff)
    expect(store.activePreset?.seed).toBe(2147483648);
    expect(store.activePreset?.randomEachMap).toBe(false);
    // The seed input is now editable (not disabled) and shows the value.
    const input = wrapper.find('[data-test="seed-input"]').element as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("2147483648");
  });

  it("produces a u32-range integer seed", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(PresetBar);

    await wrapper.find('[data-test="seed-reroll"]').trigger("click");

    const seed = store.activePreset?.seed as number;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(1);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});

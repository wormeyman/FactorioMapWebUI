import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import AdvancedTab from "../src/components/AdvancedTab.vue";
import { usePresetsStore } from "../src/store/presets";

describe("AdvancedTab", () => {
  it("shows the active preset's map width and height", () => {
    setActivePinia(createPinia());
    const wrapper = mount(AdvancedTab);
    expect((wrapper.find('[data-test="map-width"]').element as HTMLInputElement).value).toBe(
      "2000000",
    );
    expect((wrapper.find('[data-test="map-height"]').element as HTMLInputElement).value).toBe(
      "2000000",
    );
  });

  it("writes an edited height back to the active preset", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="map-height"]');
    (input.element as HTMLInputElement).value = "128";
    await input.trigger("change");
    expect(store.activePreset?.height).toBe(128);
  });

  it("shows and edits the active preset's starting area", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="starting-area"]');
    expect((input.element as HTMLInputElement).value).toBe("1");
    (input.element as HTMLInputElement).value = "2";
    await input.trigger("change");
    expect(store.activePreset?.startingArea).toBe(2);
  });

  it("shows peaceful_mode unchecked for the Default preset and writes it back on toggle", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="peaceful-mode"] input');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("change");
    expect(store.activePreset?.peacefulMode).toBe(true);
  });

  it("shows no_enemies_mode unchecked for the Default preset and writes it back on toggle", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="no-enemies-mode"] input');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("change");
    expect(store.activePreset?.noEnemiesMode).toBe(true);
  });
});

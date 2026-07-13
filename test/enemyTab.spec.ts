import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import AdvancedTab from "../src/components/AdvancedTab.vue";
import EnemyTab from "../src/components/EnemyTab.vue";
import { usePresetsStore } from "../src/store/presets";

function mountTab() {
  setActivePinia(createPinia());
  return mount(EnemyTab);
}

describe("EnemyTab enemy-mode checkboxes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the No enemies and Peaceful mode checkboxes on the Enemy tab", () => {
    const wrapper = mountTab();
    expect(wrapper.find('[data-test="peaceful-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="no-enemies-mode"]').exists()).toBe(true);
  });

  it("no longer shows them on the Advanced tab", () => {
    setActivePinia(createPinia());
    const wrapper = mount(AdvancedTab);
    expect(wrapper.find('[data-test="peaceful-mode"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="no-enemies-mode"]').exists()).toBe(false);
  });

  // Relocated from advancedTab.spec.ts: the toggle-writes-back behavior now
  // lives on the Enemy tab.
  it("writes peaceful_mode back to the active preset on toggle", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const input = wrapper.find('[data-test="peaceful-mode"] input');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("change");
    expect(store.activePreset?.peacefulMode).toBe(true);
  });

  it("writes no_enemies_mode back to the active preset on toggle", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const input = wrapper.find('[data-test="no-enemies-mode"] input');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    (input.element as HTMLInputElement).checked = true;
    await input.trigger("change");
    expect(store.activePreset?.noEnemiesMode).toBe(true);
  });
});

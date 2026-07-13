import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import AdvancedTab from "../src/components/AdvancedTab.vue";
import EnemyTab from "../src/components/EnemyTab.vue";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
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

describe("EnemyTab Evolution section", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the Evolution enable checkbox and its three factor rows", () => {
    const wrapper = mountTab();
    const section = wrapper.find('[data-test="enemy-evolution"]');
    expect(section.exists()).toBe(true);
    expect(section.find('[data-test="enemy-evolution-enable"]').exists()).toBe(true);
    for (const row of ["enemy-evo-time", "enemy-evo-destroy", "enemy-evo-pollution"]) {
      expect(section.find(`[data-test="${row}"]`).exists(), row).toBe(true);
    }
  });

  it("disables the factor inputs when Evolution is unchecked", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    store.activePreset!.mapSettings.enemyEvolution.enabled = true;
    const wrapper = mount(EnemyTab);
    const cb = wrapper.find('[data-test="enemy-evolution-enable"] input[type="checkbox"]');
    await cb.setValue(false);
    const number = wrapper.find('[data-test="enemy-evo-time"] input[type="number"]');
    expect((number.element as HTMLInputElement).disabled).toBe(true);
  });

  it("flows an edited Time factor into the exchange string", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const number = wrapper.find('[data-test="enemy-evo-time"] input[type="number"]');
    await number.setValue("0.25");
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyEvolution.timeFactor"]).toBeCloseTo(0.25, 12);
  });
});

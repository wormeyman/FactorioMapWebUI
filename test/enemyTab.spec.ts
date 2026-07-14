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

  it("shows the default evolution factors in the game's scaled display units", () => {
    const wrapper = mountTab();
    const val = (t: string) =>
      (wrapper.find(`[data-test="${t}"] input[type="number"]`).element as HTMLInputElement).value;
    // Defaults time 0.000004 / destroy 0.002 / pollution 0.0000009 -> 40 / 200 / 9.
    expect(val("enemy-evo-time")).toBe("40");
    expect(val("enemy-evo-destroy")).toBe("200");
    expect(val("enemy-evo-pollution")).toBe("9");
  });

  it("converts a displayed Time factor (x1e7) back to its wire value", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const number = wrapper.find('[data-test="enemy-evo-time"] input[type="number"]');
    await number.setValue("80"); // 80 / 1e7 = 8e-6
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyEvolution.timeFactor"]).toBeCloseTo(8e-6, 12);
  });

  it("converts a displayed Destroy factor (x1e5) back to its wire value", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const number = wrapper.find('[data-test="enemy-evo-destroy"] input[type="number"]');
    await number.setValue("400"); // 400 / 1e5 = 0.004
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyEvolution.destroyFactor"]).toBeCloseTo(0.004, 12);
  });

  it("keeps an edited factor value in the exchange string after Evolution is disabled", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const number = wrapper.find('[data-test="enemy-evo-time"] input[type="number"]');
    await number.setValue("120"); // 120 / 1e7 = 1.2e-5
    await number.trigger("change");
    const cb = wrapper.find('[data-test="enemy-evolution-enable"] input[type="checkbox"]');
    await cb.setValue(false);
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyEvolution.timeFactor"]).toBeCloseTo(1.2e-5, 12);
    expect(tail["enemyEvolution.enabled"]).toBe(false);
  });
});

describe("EnemyTab Enemy expansion section", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the expansion enable checkbox and its five rows", () => {
    const wrapper = mountTab();
    const section = wrapper.find('[data-test="enemy-expansion"]');
    expect(section.exists()).toBe(true);
    expect(section.find('[data-test="enemy-expansion-enable"]').exists()).toBe(true);
    for (const row of [
      "enemy-exp-min-dist",
      "enemy-exp-max-dist",
      "enemy-exp-group-size",
      "enemy-exp-min-cooldown",
      "enemy-exp-max-cooldown",
    ]) {
      expect(section.find(`[data-test="${row}"]`).exists(), row).toBe(true);
    }
  });

  it("raising the minimum distance above the maximum pushes the maximum to min+1", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    // Defaults are min 3 / max 5; raise the minimum well past the maximum.
    const min = wrapper.find('[data-test="enemy-exp-min-dist"] input[type="number"]');
    await min.setValue("10");
    await min.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.minExpansionDistance"]).toBe(10);
    expect(tail["enemyExpansion.maxExpansionDistance"]).toBe(11);
  });

  it("lowering the maximum distance below the minimum pulls the minimum to max-1", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const max = wrapper.find('[data-test="enemy-exp-max-dist"] input[type="number"]');
    await max.setValue("2");
    await max.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.maxExpansionDistance"]).toBe(2);
    expect(tail["enemyExpansion.minExpansionDistance"]).toBe(1);
  });

  it("clamps the minimum distance to 19 so the maximum can still exceed it at the 20 cap", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const min = wrapper.find('[data-test="enemy-exp-min-dist"] input[type="number"]');
    await min.setValue("20");
    await min.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.minExpansionDistance"]).toBe(19);
    expect(tail["enemyExpansion.maxExpansionDistance"]).toBe(20);
  });

  it("flows an edited Maximum expansion distance into the exchange string", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const number = wrapper.find('[data-test="enemy-exp-max-dist"] input[type="number"]');
    await number.setValue("11");
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.maxExpansionDistance"]).toBe(11);
  });

  it("converts a cooldown entered in minutes to ticks in the exchange string", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    // 5 minutes -> 5 * 3600 = 18000 ticks
    const number = wrapper.find('[data-test="enemy-exp-min-cooldown"] input[type="number"]');
    await number.setValue("5");
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.minExpansionCooldown"]).toBe(18000);
  });

  it("shows the default minimum cooldown as 10 minutes", () => {
    const wrapper = mountTab();
    const number = wrapper.find('[data-test="enemy-exp-min-cooldown"] input[type="number"]');
    // Default minExpansionCooldown decodes to 36000 ticks = 10 minutes.
    expect((number.element as HTMLInputElement).value).toBe("10");
  });

  it("converts a maximum cooldown entered in minutes to ticks in the exchange string", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    // 30 minutes -> 30 * 3600 = 108000 ticks
    const number = wrapper.find('[data-test="enemy-exp-max-cooldown"] input[type="number"]');
    await number.setValue("30");
    await number.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["enemyExpansion.maxExpansionCooldown"]).toBe(108000);
  });

  it("shows the default maximum cooldown as 60 minutes", () => {
    const wrapper = mountTab();
    const number = wrapper.find('[data-test="enemy-exp-max-cooldown"] input[type="number"]');
    // Default maxExpansionCooldown decodes to 216000 ticks = 60 minutes.
    expect((number.element as HTMLInputElement).value).toBe("60");
  });
});

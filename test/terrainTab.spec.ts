import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import TerrainTab from "../src/components/TerrainTab.vue";
import { usePresetsStore } from "../src/store/presets";
import { decodeExchangeString } from "../src/codec/mapExchangeString";

function mountTab() {
  setActivePinia(createPinia());
  return mount(TerrainTab);
}

function headers(wrapper: ReturnType<typeof mount>, tableTest: string): string[] {
  return wrapper
    .find(`[data-test="${tableTest}"]`)
    .findAll("th")
    .map((th) => th.text());
}

describe("TerrainTab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the coverage table with Scale/Coverage columns and no Richness", () => {
    const wrapper = mountTab();
    const cols = headers(wrapper, "terrain-coverage-table");
    expect(cols).toContain("Scale");
    expect(cols).toContain("Coverage");
    expect(cols).not.toContain("Richness");
  });

  it("shows non-cliff terrain in the coverage table but not cliffs", () => {
    const wrapper = mountTab();
    const coverage = wrapper.find('[data-test="terrain-coverage-table"]');
    expect(coverage.find('[data-test="control-row-water"]').exists()).toBe(true);
    expect(coverage.find('[data-test="control-row-nauvis_cliff"]').exists()).toBe(false);
  });

  it("renders the cliff table with Frequency/Continuity columns", () => {
    const wrapper = mountTab();
    const cols = headers(wrapper, "terrain-cliff-table");
    expect(cols).toContain("Frequency");
    expect(cols).toContain("Continuity");
    expect(cols).not.toContain("Richness");
  });

  it("shows all three cliff controls in the cliff table", () => {
    const wrapper = mountTab();
    const cliff = wrapper.find('[data-test="terrain-cliff-table"]');
    for (const name of ["nauvis_cliff", "gleba_cliff", "fulgora_cliff"]) {
      expect(cliff.find(`[data-test="control-row-${name}"]`).exists()).toBe(true);
    }
  });

  it("renders a disabled Map type dropdown defaulting to Nauvis elevation", () => {
    const wrapper = mountTab();
    const select = wrapper.find('[data-test="map-type"]');
    expect(select.exists()).toBe(true);
    expect((select.element as HTMLSelectElement).disabled).toBe(true);
    expect(select.text()).toContain("Nauvis elevation");
  });

  it("renders live Moisture and Terrain type rows with enabled Scale and Bias sliders", () => {
    const wrapper = mountTab();
    for (const row of ["terrain-noise-moisture", "terrain-noise-terrain-type"]) {
      const el = wrapper.find(`[data-test="${row}"]`);
      expect(el.exists(), row).toBe(true);
      const sliders = el.findAll('input[type="range"]');
      expect(sliders.length, row).toBe(2);
      expect(
        sliders.every((s) => !(s.element as HTMLInputElement).disabled),
        row,
      ).toBe(true);
    }
  });

  it('gives each climate row an "Appears on" Nauvis icon', () => {
    const wrapper = mountTab();
    const cols = headers(wrapper, "terrain-noise-table");
    expect(cols).toContain("Appears on");
    for (const row of ["terrain-noise-moisture", "terrain-noise-terrain-type"]) {
      const icon = wrapper.find(`[data-test="${row}"] img[data-test="appears-on"]`);
      expect(icon.exists(), row).toBe(true);
      expect(icon.attributes("alt"), row).toBe("Nauvis");
    }
  });

  it("drives Moisture Scale 150% + Bias +0.05 into the exchange string byte-exact", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const row = wrapper.find('[data-test="terrain-noise-moisture"]');
    const sliders = row.findAll('input[type="range"]');
    await sliders[0]?.setValue("7"); // Scale notch 7 = 150%
    await sliders[1]?.setValue("11"); // Bias notch 11 = +0.05

    const pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect(pen["control:moisture:frequency"]).toBe("0.666667");
    expect(pen["control:moisture:bias"]).toBe("0.050000");
  });

  it("removes the moisture keys from the exchange string when reset to default notches", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const row = wrapper.find('[data-test="terrain-noise-moisture"]');
    const sliders = row.findAll('input[type="range"]');

    // First move both off default so the keys are present...
    await sliders[0]?.setValue("7"); // Scale 150%
    await sliders[1]?.setValue("11"); // Bias +0.05
    let pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect(pen["control:moisture:frequency"]).toBe("0.666667");
    expect(pen["control:moisture:bias"]).toBe("0.050000");

    // ...then reset both to their default notch (Scale 100% = index 5, Bias 0 = index 10).
    await sliders[0]?.setValue("5");
    await sliders[1]?.setValue("10");
    pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect("control:moisture:frequency" in pen).toBe(false);
    expect("control:moisture:bias" in pen).toBe(false);
  });

  it("shows an enable checkbox on disable-able coverage rows but not always-on ones", () => {
    const wrapper = mountTab();
    const water = wrapper.find('[data-test="control-row-water"]');
    const volcanism = wrapper.find('[data-test="control-row-vulcanus_volcanism"]');
    expect(water.find('input[type="checkbox"]').exists()).toBe(true);
    expect(volcanism.find('input[type="checkbox"]').exists()).toBe(false);
    expect(volcanism.find(".control-enable").exists()).toBe(true);
  });

  it("unchecking Cliffs drives nauvis_cliff.size to 0 in the exchange string, re-checking restores it", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const cb = wrapper.find(
      '[data-test="control-row-nauvis_cliff"] input[type="checkbox"][data-test="control-enable"]',
    );
    expect(cb.exists()).toBe(true);

    await cb.setValue(false);
    let decoded = decodeExchangeString(store.activeExchangeString as string);
    expect(decoded.autoplaceControls["nauvis_cliff"]?.size).toBe(0);

    await cb.setValue(true);
    decoded = decodeExchangeString(store.activeExchangeString as string);
    expect(decoded.autoplaceControls["nauvis_cliff"]?.size).toBe(1);
  });
});

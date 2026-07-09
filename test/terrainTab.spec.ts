import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import TerrainTab from "../src/components/TerrainTab.vue";

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

  it("renders inert Moisture and Terrain type noise rows with disabled sliders", () => {
    const wrapper = mountTab();
    for (const row of ["terrain-noise-moisture", "terrain-noise-terrain-type"]) {
      const el = wrapper.find(`[data-test="${row}"]`);
      expect(el.exists(), row).toBe(true);
      expect(el.find("input[disabled]").exists(), row).toBe(true);
    }
  });
});

import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import App from "../src/App.vue";
import fixtures from "./fixtures/builtin-presets.json";

const presetStrings = fixtures.presets as Record<string, string>;

function mountApp() {
  return mount(App, { global: { plugins: [createPinia()] } });
}

describe("App shell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the title bar, tabs, and preset bar", () => {
    const w = mountApp();
    expect(w.text()).toContain("Map generator");
    for (const tab of ["Resources", "Terrain", "Enemy", "Advanced"]) {
      expect(w.text()).toContain(tab);
    }
    expect(w.text()).toContain("New preset");
  });

  it("creates a preset from the builtin dropdown via the Create button", async () => {
    const w = mountApp();
    await w.find('input[data-test="new-preset-name"]').setValue("speedrun");
    await w.find('select[data-test="builtin-select"]').setValue("Rail world");
    await w.find('button[data-test="create-preset"]').trigger("click");
    const editSelect = w.find('select[data-test="edit-preset-select"]');
    expect((editSelect.element as HTMLSelectElement).value).toBe("speedrun");
  });

  it('disables the seed input when "Random each new map" is checked', async () => {
    const w = mountApp();
    const seed = w.find('input[data-test="seed-input"]');
    expect((seed.element as HTMLInputElement).disabled).toBe(true);
    await w.find('[data-test="random-each-map"] input').setValue(false);
    expect((seed.element as HTMLInputElement).disabled).toBe(false);
  });

  it("shows nauvis resource rows by default", () => {
    const w = mountApp();
    for (const label of ["Coal", "Iron ore", "Copper ore", "Uranium ore"]) {
      expect(w.text()).toContain(label);
    }
    expect(w.text()).not.toContain("Tungsten ore");
  });

  it("switching the preview planet dropdown switches the visible controls", async () => {
    const w = mountApp();
    await w.find('select[data-test="planet-select"]').setValue("vulcanus");
    expect(w.text()).toContain("Tungsten ore");
    expect(w.text()).not.toContain("Iron ore");
  });

  it("editing a frequency number input updates the store", async () => {
    const w = mountApp();
    const coalRow = w.find('[data-test="control-row-coal"]');
    await coalRow.find('input[type="number"]').setValue("3");
    const stored = JSON.parse(JSON.stringify(w.vm.$pinia.state.value)) as {
      presets: { userPresets: { autoplaceControls: Record<string, { frequency: number }> }[] };
    };
    expect(stored.presets.userPresets[0]?.autoplaceControls["coal"]?.frequency).toBe(3);
  });

  it("duplicate and save buttons work end to end", async () => {
    const w = mountApp();
    await w.find('button[data-test="duplicate"]').trigger("click");
    expect(w.text()).toContain("My preset (copy)");
    await w.find('button[data-test="save"]').trigger("click");
    expect(localStorage.getItem("factorio-map-webui.presets.v1")).toContain("My preset (copy)");
  });

  it("imports an exchange string through the import panel", async () => {
    const w = mountApp();
    await w.find('button[data-test="open-import"]').trigger("click");
    await w.find('[data-test="import-name"]').setValue("from-game");
    await w.find('[data-test="import-string"]').setValue(presetStrings["Marathon"] as string);
    await w.find('button[data-test="import-confirm"]').trigger("click");
    const editSelect = w.find('select[data-test="edit-preset-select"]');
    expect((editSelect.element as HTMLSelectElement).value).toBe("from-game");
  });

  it("shows an error for an invalid import string without crashing", async () => {
    const w = mountApp();
    await w.find('button[data-test="open-import"]').trigger("click");
    await w.find('[data-test="import-name"]').setValue("bad");
    await w.find('[data-test="import-string"]').setValue("not a string");
    await w.find('button[data-test="import-confirm"]').trigger("click");
    expect(w.find('[data-test="import-error"]').text()).toContain("envelope");
  });
});

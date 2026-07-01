import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import App from "../src/App.vue";

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
});

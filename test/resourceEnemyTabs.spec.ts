import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import EnemyTab from "../src/components/EnemyTab.vue";
import ResourcesTab from "../src/components/ResourcesTab.vue";

function headers(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll("th").map((th) => th.text());
}

describe("ResourcesTab", () => {
  it("keeps the Frequency/Size/Richness columns", () => {
    setActivePinia(createPinia());
    const cols = headers(mount(ResourcesTab));
    expect(cols).toContain("Frequency");
    expect(cols).toContain("Size");
    expect(cols).toContain("Richness");
  });
});

describe("EnemyTab", () => {
  it("shows Frequency and Size but not Richness", () => {
    setActivePinia(createPinia());
    const cols = headers(mount(EnemyTab));
    expect(cols).toContain("Frequency");
    expect(cols).toContain("Size");
    expect(cols).not.toContain("Richness");
  });
});

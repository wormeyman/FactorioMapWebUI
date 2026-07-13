import { describe, expect, it } from "vite-plus/test";
import { CONTROL_CATALOG, controlsForCategory } from "../src/model/controlCatalog";
import { RESOURCE_ICONS } from "../src/model/resourceIcons";

describe("resource icons", () => {
  it("maps every resource control to an icon asset URL", () => {
    for (const name of controlsForCategory("resource")) {
      expect(RESOURCE_ICONS[name], name).toBeTruthy();
    }
  });

  it("maps only resource controls (no stray keys)", () => {
    for (const name of Object.keys(RESOURCE_ICONS)) {
      expect(CONTROL_CATALOG[name]?.category, name).toBe("resource");
    }
  });
});

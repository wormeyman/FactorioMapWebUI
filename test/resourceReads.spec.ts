import { describe, expect, it } from "vite-plus/test";
import { readResourceControls } from "../src/model/resourceReads";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";

describe("readResourceControls", () => {
  it("reads each catalog resource's control, defaulting absent ones to 1/1/1", () => {
    const controls = readResourceControls({
      autoplaceControls: {
        "iron-ore": { frequency: 2, size: 1.5, richness: 3 },
        // coal, copper, stone, crude-oil, uranium-ore absent
      },
    });
    expect(controls["iron-ore"]).toEqual({ frequency: 2, size: 1.5, richness: 3 });
    expect(controls.coal).toEqual({ frequency: 1, size: 1, richness: 1 });
    // one entry per catalog resource
    expect(Object.keys(controls).sort()).toEqual(
      RESOURCE_CATALOG.map((r) => r.controlName).sort(),
    );
  });
});

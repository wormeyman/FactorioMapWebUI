import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { CONTROL_CATALOG, controlsFor } from "../src/model/controlCatalog";
import { PLANETS } from "../src/model/planets";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

describe("control catalog", () => {
  it("covers exactly the 28 controls present in the Default fixture", () => {
    const fixtureKeys = Object.keys(
      decodeExchangeString(presets["Default"] as string).autoplaceControls,
    ).sort();
    expect(Object.keys(CONTROL_CATALOG).sort()).toEqual(fixtureKeys);
  });

  it("assigns every control to a known planet", () => {
    for (const entry of Object.values(CONTROL_CATALOG)) {
      expect(PLANETS).toContain(entry.planet);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("groups nauvis resources correctly", () => {
    expect(controlsFor("nauvis", "resource").sort()).toEqual([
      "coal",
      "copper-ore",
      "crude-oil",
      "iron-ore",
      "stone",
      "uranium-ore",
    ]);
  });

  it("every planet has at least one resource control", () => {
    for (const planet of PLANETS) {
      expect(controlsFor(planet, "resource").length).toBeGreaterThan(0);
    }
  });

  it("resources have richness; terrain and enemy controls do not", () => {
    for (const [name, entry] of Object.entries(CONTROL_CATALOG)) {
      expect(entry.hasRichness, name).toBe(entry.category === "resource");
    }
  });
});

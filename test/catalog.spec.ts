import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import {
  CONTROL_CATALOG,
  controlsFor,
  controlsForCategory,
  controlsForTerrainGroup,
} from "../src/model/controlCatalog";
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

  it("lists every planet's resource controls together, grouped in planet order", () => {
    const names = controlsForCategory("resource");
    // Union across all planets, no duplicates or omissions.
    expect([...names].sort()).toEqual(
      Object.entries(CONTROL_CATALOG)
        .filter(([, e]) => e.category === "resource")
        .map(([n]) => n)
        .sort(),
    );
    // Ordered by planet: each control's planet index is non-decreasing.
    const planetIndex = names.map((n) => PLANETS.indexOf(CONTROL_CATALOG[n]!.planet));
    expect(planetIndex).toEqual([...planetIndex].sort((a, b) => a - b));
    // Nauvis resources come first, and Vulcanus's tungsten appears after them.
    expect(names.indexOf("iron-ore")).toBeLessThan(names.indexOf("tungsten_ore"));
  });

  it("controlsForCategory concatenates the per-planet lists", () => {
    for (const category of ["resource", "terrain", "enemy"] as const) {
      const combined = controlsForCategory(category);
      const perPlanet = PLANETS.flatMap((p) => controlsFor(p, category));
      expect(combined).toEqual(perPlanet);
    }
  });

  it("resources have richness; terrain and enemy controls do not", () => {
    for (const [name, entry] of Object.entries(CONTROL_CATALOG)) {
      expect(entry.hasRichness, name).toBe(entry.category === "resource");
    }
  });
});

describe("terrain groups", () => {
  it("tags every terrain control with a group and leaves non-terrain untagged", () => {
    for (const [name, entry] of Object.entries(CONTROL_CATALOG)) {
      if (entry.category === "terrain") {
        expect(["coverage", "cliff"], name).toContain(entry.terrainGroup);
      } else {
        expect(entry.terrainGroup, name).toBeUndefined();
      }
    }
  });

  it("classes exactly the three cliff controls as the cliff group", () => {
    expect(controlsForTerrainGroup("cliff").sort()).toEqual([
      "fulgora_cliff",
      "gleba_cliff",
      "nauvis_cliff",
    ]);
  });

  it("puts the remaining terrain controls in the coverage group, including water and excluding cliffs", () => {
    const coverage = controlsForTerrainGroup("coverage");
    expect(coverage).toContain("water");
    expect(coverage).not.toContain("nauvis_cliff");
    // Coverage plus cliffs partition the full terrain category.
    expect([...coverage, ...controlsForTerrainGroup("cliff")].sort()).toEqual(
      [...controlsForCategory("terrain")].sort(),
    );
  });

  it("lists a terrain group's controls in planet order", () => {
    const names = controlsForTerrainGroup("coverage");
    const planetIndex = names.map((n) => PLANETS.indexOf(CONTROL_CATALOG[n]!.planet));
    expect(planetIndex).toEqual([...planetIndex].sort((a, b) => a - b));
  });
});

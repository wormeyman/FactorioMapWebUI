import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { presetFromDecoded } from "../src/model/convert";
import { toMapGenSettingsJson, toMapSettingsJson } from "../src/io/jsonExport";
import fixtures from "./fixtures/builtin-presets.json";
import mapSettingsDefaults from "./fixtures/map-settings.example.json";

const presets = fixtures.presets as Record<string, string>;

function preset(name: string) {
  return presetFromDecoded(name, decodeExchangeString(presets[name] as string), true);
}

function presetFromFile(path: string) {
  return presetFromDecoded(path, decodeExchangeString(readFileSync(path, "utf8").trim()));
}

describe("toMapGenSettingsJson", () => {
  it("emits snake_case autoplace_controls, seed, width, height, cliff_settings", () => {
    const j = toMapGenSettingsJson(preset("Default")) as Record<string, unknown>;
    expect(j["seed"]).toBe(34658944);
    expect(j["width"]).toBe(2000000);
    expect((j["autoplace_controls"] as Record<string, unknown>)["coal"]).toBeDefined();
    expect(
      (j["cliff_settings"] as Record<string, unknown>)["cliff_elevation_interval"],
    ).toBeCloseTo(40, 4);
  });

  it("emits default_enable_all_autoplace_controls true for the Default preset", () => {
    const j = toMapGenSettingsJson(preset("Default")) as Record<string, unknown>;
    expect(j["default_enable_all_autoplace_controls"]).toBe(true);
  });

  it("emits peaceful_mode and no_enemies_mode false for the Default preset", () => {
    const j = toMapGenSettingsJson(preset("Default")) as Record<string, unknown>;
    expect(j["peaceful_mode"]).toBe(false);
    expect(j["no_enemies_mode"]).toBe(false);
  });

  it("emits the decoded peaceful_mode true for the peaceful fixture", () => {
    const j = toMapGenSettingsJson(
      presetFromFile("test/fixtures/defaultgenwithpeaceful.txt"),
    ) as Record<string, unknown>;
    expect(j["peaceful_mode"]).toBe(true);
    expect(j["no_enemies_mode"]).toBe(false);
  });

  it("emits the decoded no_enemies_mode true for the no-enemies fixture", () => {
    const j = toMapGenSettingsJson(
      presetFromFile("test/fixtures/defaultmodenoenemiespeacefulunchecked.txt"),
    ) as Record<string, unknown>;
    expect(j["no_enemies_mode"]).toBe(true);
    expect(j["peaceful_mode"]).toBe(false);
  });
});

describe("toMapSettingsJson", () => {
  it("Default map-settings matches the example.json defaults for key fields", () => {
    const j = toMapSettingsJson(preset("Default")) as Record<string, Record<string, unknown>>;
    expect(j["pollution"]["diffusion_ratio"]).toBeCloseTo(
      (mapSettingsDefaults as unknown as Record<string, Record<string, number>>)["pollution"][
        "diffusion_ratio"
      ],
      9,
    );
    expect(j["enemy_evolution"]["time_factor"]).toBeCloseTo(0.000004, 12);
    expect(j["difficulty_settings"]["technology_price_multiplier"]).toBeCloseTo(1, 6);
  });

  it("Marathon map-settings has technology_price_multiplier 4", () => {
    const j = toMapSettingsJson(preset("Marathon")) as Record<string, Record<string, unknown>>;
    expect(j["difficulty_settings"]["technology_price_multiplier"]).toBeCloseTo(4, 6);
  });

  it("emits a complete steering section (JSON-only; not carried by the exchange string)", () => {
    const j = toMapSettingsJson(preset("Default")) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(j["steering"]["default"]).toEqual({
      radius: 1.2,
      separation_force: 0.005,
      separation_factor: 1.2,
      force_unit_fuzzy_goto_behavior: false,
    });
    expect(j["steering"]["moving"]).toEqual({
      radius: 3,
      separation_force: 0.01,
      separation_factor: 3,
      force_unit_fuzzy_goto_behavior: false,
    });
  });
});

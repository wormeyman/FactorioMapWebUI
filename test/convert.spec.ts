import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodeExchangeString } from "../src/codec/mapExchangeString";
import { presetFromDecoded, presetToEncodable } from "../src/model/convert";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

function roundTrip(preset: ReturnType<typeof presetFromDecoded>): string {
  return encodeExchangeString(presetToEncodable(preset));
}

describe("presetToEncodable enemy overlay", () => {
  it("re-encodes an unedited Default byte-identically (overlay is a no-op)", () => {
    const original = presets["Default"] as string;
    const preset = presetFromDecoded("x", decodeExchangeString(original));
    expect(roundTrip(preset)).toBe(original);
  });

  it("flows an edited evolution timeFactor into the re-encoded string", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.enemyEvolution.timeFactor = 0.5;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["enemyEvolution.timeFactor"]).toBeCloseTo(0.5, 12);
  });

  it("persists a section enabled toggled to false (falsy-edit guard)", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.enemyExpansion.enabled = false;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["enemyExpansion.enabled"]).toBe(false);
  });

  it("persists a numeric enemy field set to 0 (falsy-edit guard)", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.enemyExpansion.maxExpansionDistance = 0;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["enemyExpansion.maxExpansionDistance"]).toBe(0);
  });
});

describe("presetToEncodable map-settings overlay", () => {
  it("round-trips an untouched Default preset byte-exact", () => {
    const original = presets["Default"] as string;
    const preset = presetFromDecoded("x", decodeExchangeString(original));
    expect(roundTrip(preset)).toBe(original);
  });

  it("persists pollution.enabled toggled to false as present-false", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.pollution.enabled = false;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["pollution.enabled"]).toBe(false);
  });

  it("persists a numeric pollution field set to 0", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.pollution.minPollutionToDamageTrees = 0;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["pollution.minPollutionToDamageTrees"]).toBe(0);
  });

  it("round-trips edited technology price multiplier, spoiling, spawning, diffusion", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.difficulty.technologyPriceMultiplier = 4;
    preset.mapSettings.difficulty.spoilTimeModifier = 2;
    preset.mapSettings.asteroids.spawningRate = 2;
    preset.mapSettings.pollution.diffusionRatio = 0.09;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["difficulty.technologyPriceMultiplier"]).toBeCloseTo(4, 12);
    expect(tail["difficulty.spoilTimeModifier"]).toBeCloseTo(2, 12);
    expect(tail["asteroids.spawningRate"]).toBeCloseTo(2, 12);
    expect(tail["pollution.diffusionRatio"]).toBeCloseTo(0.09, 12);
  });

  it("re-setting diffusionRatio to its decoded value re-encodes byte-exact", () => {
    const original = presets["Default"] as string;
    const preset = presetFromDecoded("x", decodeExchangeString(original));
    // No-op edit at the decoded value must not perturb bytes. Route through a
    // temp so it is not a literal self-assignment (oxlint no-self-assign).
    const decoded = preset.mapSettings.pollution.diffusionRatio;
    preset.mapSettings.pollution.diffusionRatio = decoded;
    expect(roundTrip(preset)).toBe(original);
  });
});

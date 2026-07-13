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

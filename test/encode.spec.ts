import { describe, expect, it } from "vite-plus/test";
import { bytesToBase64 } from "../src/codec/base64";
import { deflateLevel9 } from "../src/codec/deflate";
import {
  decodeExchangeString,
  encodeExchangeString,
  encodePayload,
} from "../src/codec/mapExchangeString";
import { presetFromDecoded, presetToEncodable } from "../src/model/convert";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;
const NAMES = Object.keys(presets);

describe("encodePayload", () => {
  it.each(NAMES)("rebuilds the %s payload byte-for-byte (primary round-trip)", (name) => {
    const decoded = decodeExchangeString(presets[name] as string);
    expect(encodePayload(decoded)).toEqual(decoded.payload);
  });

  it("emits autoplace keys in code-point order regardless of insertion order", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    // Reinsert the controls in reverse order; the encoder must still sort them.
    const shuffled = Object.fromEntries(Object.entries(decoded.autoplaceControls).reverse());
    const scrambled = { ...decoded, autoplaceControls: shuffled };
    expect(encodePayload(scrambled)).toEqual(decoded.payload);
  });

  it("round-trips the empty and the populated property_expression_names dict", () => {
    for (const name of ["Default", "Lakes", "Ribbon world"]) {
      const decoded = decodeExchangeString(presets[name] as string);
      expect(encodePayload(decoded)).toEqual(decoded.payload);
    }
  });

  it("round-trips an edited map height through the schema", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const edited = { ...decoded, mid: { ...decoded.mid, height: 128 } };
    const reDecoded = decodeExchangeString(
      `>>>${bytesToBase64(deflateLevel9(encodePayload(edited)))}<<<`,
    );
    expect(reDecoded.mid.height).toBe(128);
    expect(reDecoded.mid.width).toBe(2000000);
  });
});

describe("encodeExchangeString", () => {
  it.each(NAMES)("re-emits the exact %s string (secondary round-trip)", (name) => {
    const original = presets[name] as string;
    const decoded = decodeExchangeString(original);
    expect(encodeExchangeString(decoded)).toBe(original);
  });

  it("produces a single-line >>> ... <<< envelope with no interior whitespace", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const out = encodeExchangeString(decoded);
    expect(out.startsWith(">>>")).toBe(true);
    expect(out.endsWith("<<<")).toBe(true);
    expect(/\s/.test(out.slice(3, -3))).toBe(false);
  });
});

describe("presetToEncodable", () => {
  it.each(NAMES)("round-trips %s through the full Preset model path", (name) => {
    const original = presets[name] as string;
    const decoded = decodeExchangeString(original);
    const preset = presetFromDecoded(name, decoded);
    expect(encodeExchangeString(presetToEncodable(preset))).toBe(original);
  });

  it("rounds a non-float32-representable richness on encode (documented, not a bug)", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const preset = presetFromDecoded("edited", decoded);
    (preset.autoplaceControls["coal"] as { richness: number }).richness = 1.3;
    const reDecoded = decodeExchangeString(encodeExchangeString(presetToEncodable(preset)));
    // 1.3 is not exactly representable as float32; it round-trips to fround(1.3).
    expect(reDecoded.autoplaceControls["coal"]?.richness).toBe(Math.fround(1.3));
    expect(reDecoded.autoplaceControls["coal"]?.richness).not.toBe(1.3);
  });
});

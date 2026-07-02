import { describe, expect, it } from "vite-plus/test";
import {
  decodeExchangeString,
  encodeExchangeString,
  encodePayload,
} from "../src/codec/mapExchangeString";
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

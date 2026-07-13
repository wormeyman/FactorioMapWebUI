import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodeExchangeString } from "../src/codec/mapExchangeString";

const DIR = "docs/mapexchangestrings";

// [file, expected property_expression_names] — the 8 confirmed captures
// (seed 123456, Default Nauvis preset), one or two sliders changed each.
const CAPTURES: [file: string, pen: Record<string, string>][] = [
  ["climate-moisture-scale600.txt", { "control:moisture:frequency": "0.166667" }],
  ["climate-moisture-scale150.txt", { "control:moisture:frequency": "0.666667" }],
  ["climate-moisture-scale17.txt", { "control:moisture:frequency": "6.000000" }],
  ["climate-moisture-bias+0.50.txt", { "control:moisture:bias": "0.500000" }],
  ["climate-moisture-bias-0.50.txt", { "control:moisture:bias": "-0.500000" }],
  ["climate-moisture-bias+0.05.txt", { "control:moisture:bias": "0.050000" }],
  [
    "climate-moisture-scale600-bias+0.50.txt",
    { "control:moisture:bias": "0.500000", "control:moisture:frequency": "0.166667" },
  ],
  [
    "climate-terrain-scale600-bias+0.50.txt",
    { "control:aux:bias": "0.500000", "control:aux:frequency": "0.166667" },
  ],
];

describe("climate control captures", () => {
  it.each(CAPTURES)("re-emits %s byte-for-byte", (file) => {
    const original = readFileSync(`${DIR}/${file}`, "utf8").trim();
    expect(encodeExchangeString(decodeExchangeString(original))).toBe(original);
  });

  it.each(CAPTURES)("decodes the documented property_expression_names in %s", (file, expected) => {
    const original = readFileSync(`${DIR}/${file}`, "utf8").trim();
    const pen = decodeExchangeString(original).propertyExpressionNames;
    for (const [k, v] of Object.entries(expected)) {
      expect(pen[k]).toBe(v);
    }
  });
});

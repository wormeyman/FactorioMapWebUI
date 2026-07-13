import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodeExchangeString } from "../src/codec/mapExchangeString";

const BASELINE = readFileSync("docs/mapexchangestrings/cliffs-baseline-default.txt", "utf8").trim();
const CLIFFS_OFF = readFileSync("docs/mapexchangestrings/cliffs-nauvis-off.txt", "utf8").trim();

describe("cliff disable captures", () => {
  it.each([
    ["baseline (cliffs on)", BASELINE],
    ["nauvis cliffs off", CLIFFS_OFF],
  ])("round-trips the %s capture byte-for-byte", (_label, s) => {
    expect(encodeExchangeString(decodeExchangeString(s))).toBe(s);
  });

  it("differs only in nauvis_cliff.size (1 -> 0); every other control is identical", () => {
    const on = decodeExchangeString(BASELINE).autoplaceControls;
    const off = decodeExchangeString(CLIFFS_OFF).autoplaceControls;

    expect(Object.keys(off).sort()).toEqual(Object.keys(on).sort());
    expect(on["nauvis_cliff"]).toEqual({ frequency: 1, size: 1, richness: 1 });
    expect(off["nauvis_cliff"]).toEqual({ frequency: 1, size: 0, richness: 1 });

    for (const name of Object.keys(on)) {
      if (name === "nauvis_cliff") continue;
      expect(off[name], name).toEqual(on[name]);
    }
  });
});

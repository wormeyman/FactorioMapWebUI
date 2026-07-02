import { describe, expect, it } from "vite-plus/test";
import { base64ToBytes } from "../src/codec/base64";
import { deflateLevel9, inflate } from "../src/codec/deflate";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;
const NAMES = Object.keys(presets);

function compressedBytesOf(exchangeString: string): Uint8Array {
  const compact = exchangeString.replaceAll(/\s+/g, "");
  return base64ToBytes(compact.slice(3, -3));
}

describe("deflate", () => {
  it("round-trips bytes through deflateLevel9 + inflate with a 78 da header", () => {
    const payload = new TextEncoder().encode("factorio ".repeat(50));
    const compressed = deflateLevel9(payload);
    expect(compressed[0]).toBe(0x78);
    expect(compressed[1]).toBe(0xda);
    expect(inflate(compressed)).toEqual(payload);
  });

  it.each(NAMES)("inflates the %s fixture to the recorded size", (name) => {
    const status = (fixtures._decodeStatus as Record<string, string>)[name] as string;
    const expectedSize = Number(/\((\d+) bytes/.exec(status)?.[1]);
    expect(inflate(compressedBytesOf(presets[name] as string)).length).toBe(expectedSize);
  });

  // COMPRESSOR-FIDELITY GATE (spec Sections 6 and 10): deflateLevel9 must
  // reproduce the game's zlib@9 stream byte-for-byte, or byte-identical STRING
  // export is off the table. pako and fflate diverge; zlib-asm matches. If this
  // regresses, the compressor changed - do not weaken it, fix the compressor.
  it.each(NAMES)("level 9 reproduces the compressed bytes of %s", (name) => {
    const compressed = compressedBytesOf(presets[name] as string);
    expect(deflateLevel9(inflate(compressed))).toEqual(compressed);
  });
});

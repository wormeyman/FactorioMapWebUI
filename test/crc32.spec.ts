import { describe, expect, it } from "vite-plus/test";
import { crc32 } from "../src/codec/crc32";

describe("crc32", () => {
  it('matches the standard check value for "123456789"', () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("is unsigned even when the top bit is set", () => {
    const bytes = new TextEncoder().encode("a");
    expect(crc32(bytes)).toBe(0xe8b7be43);
    expect(crc32(bytes)).toBeGreaterThan(0);
  });
});

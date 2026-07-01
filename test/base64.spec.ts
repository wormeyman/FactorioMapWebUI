import { describe, expect, it } from "vite-plus/test";
import { base64ToBytes, bytesToBase64 } from "../src/codec/base64";

describe("base64", () => {
  it("round-trips arbitrary bytes including 0x00 and 0xff", () => {
    const bytes = new Uint8Array([0, 1, 2, 0x78, 0xda, 0xff, 254, 127]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("decodes a known vector", () => {
    expect(base64ToBytes("eNo=")).toEqual(new Uint8Array([0x78, 0xda]));
  });

  it("throws on invalid base64", () => {
    expect(() => base64ToBytes("!!!not base64!!!")).toThrow();
  });
});

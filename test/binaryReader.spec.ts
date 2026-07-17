import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";

const utf8 = new TextEncoder();

describe("BinaryReader", () => {
  it("reads little-endian primitives in sequence", () => {
    // u8=0x2a, u16=0x0102, u32=0x01020304, f32=1.5, f64=2.5
    const r = new BinaryReader(
      new Uint8Array([
        0x2a, 0x02, 0x01, 0x04, 0x03, 0x02, 0x01, 0x00, 0x00, 0xc0, 0x3f, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x04, 0x40,
      ]),
    );
    expect(r.readUint8()).toBe(0x2a);
    expect(r.readUint16()).toBe(0x0102);
    expect(r.readUint32()).toBe(0x01020304);
    expect(r.readFloat32()).toBe(1.5);
    expect(r.readFloat64()).toBe(2.5);
    expect(r.position).toBe(19);
    expect(r.remaining()).toEqual(new Uint8Array(0));
  });

  it("reads signed little-endian int32, including negative values", () => {
    // 0x0001C200 = 115200 (450*256); 0xFFFE3E00 = -115200
    const r = new BinaryReader(new Uint8Array([0x00, 0xc2, 0x01, 0x00, 0x00, 0x3e, 0xfe, 0xff]));
    expect(r.readInt32()).toBe(115200);
    expect(r.readInt32()).toBe(-115200);
  });

  it("reads a short string from its bare uint8 length prefix", () => {
    const r = new BinaryReader(new Uint8Array([4, 0x63, 0x6f, 0x61, 0x6c, 0xff]));
    expect(r.readString()).toBe("coal");
    expect(r.remaining()).toEqual(new Uint8Array([0xff]));
  });

  // Factorio's space-optimized uint: lengths 0-254 are a bare u8; 255 and above
  // escape to 0xff + a u32. Boundary captured from the game itself - see
  // docs/mapexchangestrings/string-length-prefix-NOTES.md.
  it("reads a 254-byte string from a bare uint8 length prefix (the last unescaped length)", () => {
    const value = "v".repeat(254);
    const r = new BinaryReader(new Uint8Array([0xfe, ...utf8.encode(value)]));
    expect(r.readString()).toBe(value);
  });

  it("reads a 255-byte string from a 0xff-escaped uint32 length prefix", () => {
    const value = "v".repeat(255);
    const r = new BinaryReader(
      new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, ...utf8.encode(value)]),
    );
    expect(r.readString()).toBe(value);
  });

  it("reads a 300-byte string using the exact prefix bytes the game emitted", () => {
    // Captured from Factorio 2.1.11: property_expression_names["elevation"] set
    // to a 300-char value serialized as ff 2c 01 00 00 followed by the bytes.
    const value = `elevation_${"x".repeat(290)}`;
    const r = new BinaryReader(
      new Uint8Array([0xff, 0x2c, 0x01, 0x00, 0x00, ...utf8.encode(value), 0x7f]),
    );
    expect(r.readString()).toBe(value);
    expect(r.remaining()).toEqual(new Uint8Array([0x7f]));
  });

  it("works on a subarray view with a non-zero byteOffset", () => {
    const backing = new Uint8Array([9, 9, 9, 0x01, 0x00]);
    const r = new BinaryReader(backing.subarray(3));
    expect(r.readUint16()).toBe(1);
  });

  it("throws RangeError when reading past the end", () => {
    const r = new BinaryReader(new Uint8Array([1]));
    r.readUint8();
    expect(() => r.readUint8()).toThrow(RangeError);
    expect(() => new BinaryReader(new Uint8Array([2, 0x61])).readString()).toThrow(RangeError);
  });
});

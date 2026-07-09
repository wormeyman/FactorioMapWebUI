import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";

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

  it("reads a uint8-length-prefixed UTF-8 string", () => {
    const r = new BinaryReader(new Uint8Array([4, 0x63, 0x6f, 0x61, 0x6c, 0xff]));
    expect(r.readString()).toBe("coal");
    expect(r.remaining()).toEqual(new Uint8Array([0xff]));
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

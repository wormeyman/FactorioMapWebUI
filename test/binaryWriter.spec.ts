import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";
import { BinaryWriter } from "../src/codec/binaryWriter";

describe("BinaryWriter", () => {
  it("writes little-endian primitives that BinaryReader reads back", () => {
    const w = new BinaryWriter();
    w.writeUint8(0xab);
    w.writeUint16(0x1234);
    w.writeUint32(0xdeadbeef);
    w.writeFloat32(1.5);
    w.writeFloat64(2.25);
    const r = new BinaryReader(w.toBytes());
    expect(r.readUint8()).toBe(0xab);
    expect(r.readUint16()).toBe(0x1234);
    expect(r.readUint32()).toBe(0xdeadbeef);
    expect(r.readFloat32()).toBe(1.5);
    expect(r.readFloat64()).toBe(2.25);
  });

  it("writes signed int32 in little-endian, round-tripping negatives through the reader", () => {
    const w = new BinaryWriter();
    w.writeInt32(115200);
    w.writeInt32(-115200);
    expect([...w.toBytes()]).toEqual([0x00, 0xc2, 0x01, 0x00, 0x00, 0x3e, 0xfe, 0xff]);
    const r = new BinaryReader(w.toBytes());
    expect(r.readInt32()).toBe(115200);
    expect(r.readInt32()).toBe(-115200);
  });

  it("writes uint16 in little-endian byte order", () => {
    const w = new BinaryWriter();
    w.writeUint16(0x1234);
    expect([...w.toBytes()]).toEqual([0x34, 0x12]);
  });

  it("writes a short string with a bare uint8 length prefix, including the empty string", () => {
    const w = new BinaryWriter();
    w.writeString("coal");
    w.writeString("");
    expect([...w.toBytes()]).toEqual([4, 0x63, 0x6f, 0x61, 0x6c, 0]);
    const r = new BinaryReader(w.toBytes());
    expect(r.readString()).toBe("coal");
    expect(r.readString()).toBe("");
  });

  it("writes a 254-byte string with a bare uint8 length prefix", () => {
    const w = new BinaryWriter();
    w.writeString("v".repeat(254));
    expect(w.toBytes()[0]).toBe(0xfe);
    expect(w.length).toBe(255);
  });

  it("escapes to 0xff + uint32 for a 255-byte string", () => {
    const w = new BinaryWriter();
    w.writeString("v".repeat(255));
    expect([...w.toBytes().subarray(0, 5)]).toEqual([0xff, 0xff, 0x00, 0x00, 0x00]);
    expect(w.length).toBe(260);
  });

  it("reproduces the game's own prefix bytes for a 300-byte string", () => {
    // Ground truth from Factorio 2.1.11 - see
    // docs/mapexchangestrings/string-length-prefix-NOTES.md.
    const w = new BinaryWriter();
    w.writeString(`elevation_${"x".repeat(290)}`);
    expect([...w.toBytes().subarray(0, 5)]).toEqual([0xff, 0x2c, 0x01, 0x00, 0x00]);
  });

  it("round-trips a long string through the reader", () => {
    const value = "e".repeat(1000);
    const w = new BinaryWriter();
    w.writeString(value);
    expect(new BinaryReader(w.toBytes()).readString()).toBe(value);
  });

  it("appends raw bytes verbatim and tracks length", () => {
    const w = new BinaryWriter();
    w.writeUint8(1);
    w.writeBytes(new Uint8Array([9, 8, 7]));
    expect(w.length).toBe(4);
    expect([...w.toBytes()]).toEqual([1, 9, 8, 7]);
  });
});

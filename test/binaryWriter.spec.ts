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

  it("writes uint16 in little-endian byte order", () => {
    const w = new BinaryWriter();
    w.writeUint16(0x1234);
    expect([...w.toBytes()]).toEqual([0x34, 0x12]);
  });

  it("writes a uint8-length-prefixed UTF-8 string, including the empty string", () => {
    const w = new BinaryWriter();
    w.writeString("coal");
    w.writeString("");
    expect([...w.toBytes()]).toEqual([4, 0x63, 0x6f, 0x61, 0x6c, 0]);
    const r = new BinaryReader(w.toBytes());
    expect(r.readString()).toBe("coal");
    expect(r.readString()).toBe("");
  });

  it("appends raw bytes verbatim and tracks length", () => {
    const w = new BinaryWriter();
    w.writeUint8(1);
    w.writeBytes(new Uint8Array([9, 8, 7]));
    expect(w.length).toBe(4);
    expect([...w.toBytes()]).toEqual([1, 9, 8, 7]);
  });
});

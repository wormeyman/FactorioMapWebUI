import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";
import { BinaryWriter } from "../src/codec/binaryWriter";
import { readFields, writeFields, type Schema } from "../src/codec/fieldSchema";

const SCHEMA: Schema = [
  { name: "head", type: { opaque: 2 } },
  { name: "count", type: "u32" },
  { name: "ratio", type: "f32" },
  { name: "tail", type: { opaque: 1 } },
];

describe("readFields", () => {
  it("decodes each descriptor in order, little-endian", () => {
    // head=[0xAA,0xBB], count=2000000 (80 84 1e 00), ratio=1.0 (00 00 80 3f), tail=[0xFF]
    const bytes = new Uint8Array([
      0xaa, 0xbb, 0x80, 0x84, 0x1e, 0x00, 0x00, 0x00, 0x80, 0x3f, 0xff,
    ]);
    const out = readFields(new BinaryReader(bytes), SCHEMA);
    expect(out["head"]).toEqual(new Uint8Array([0xaa, 0xbb]));
    expect(out["count"]).toBe(2000000);
    expect(out["ratio"]).toBe(1);
    expect(out["tail"]).toEqual(new Uint8Array([0xff]));
  });

  it("decodes u8, u16, f64, and string descriptors", () => {
    // u8=7, u16=513 (01 02), f64=1.5 (00 00 00 00 00 00 f8 3f), string len 2 "hi"
    const bytes = new Uint8Array([
      0x07, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f, 0x02, 0x68, 0x69,
    ]);
    const schema: Schema = [
      { name: "a", type: "u8" },
      { name: "b", type: "u16" },
      { name: "c", type: "f64" },
      { name: "d", type: "string" },
    ];
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["a"]).toBe(7);
    expect(out["b"]).toBe(513);
    expect(out["c"]).toBe(1.5);
    expect(out["d"]).toBe("hi");
  });
});

describe("writeFields", () => {
  it("re-emits bytes read by readFields, byte-for-byte (round-trip)", () => {
    const schema: Schema = [
      { name: "a", type: "u8" },
      { name: "b", type: "u16" },
      { name: "c", type: "u32" },
      { name: "d", type: "f32" },
      { name: "e", type: "f64" },
      { name: "f", type: "string" },
      { name: "g", type: { opaque: 3 } },
    ];
    const bytes = new Uint8Array([
      0x07, // a = 7
      0x01,
      0x02, // b = 513
      0x80,
      0x84,
      0x1e,
      0x00, // c = 2000000
      0x00,
      0x00,
      0x80,
      0x3f, // d = 1.0
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0xf8,
      0x3f, // e = 1.5
      0x02,
      0x68,
      0x69, // f = "hi"
      0xde,
      0xad,
      0xbe, // g = opaque(3)
    ]);
    const values = readFields(new BinaryReader(bytes), schema);
    const w = new BinaryWriter();
    writeFields(w, schema, values);
    expect(w.toBytes()).toEqual(bytes);
  });
});

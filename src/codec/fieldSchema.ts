import type { BinaryReader } from "./binaryReader";

export type FieldType = "u8" | "u16" | "u32" | "f32" | "f64" | "string" | { opaque: number };

export interface Field {
  name: string;
  type: FieldType;
}

export type Schema = readonly Field[];

export type FieldValue = number | string | Uint8Array;

function readOne(reader: BinaryReader, type: FieldType): FieldValue {
  if (typeof type === "object") return reader.readBytes(type.opaque);
  switch (type) {
    case "u8":
      return reader.readUint8();
    case "u16":
      return reader.readUint16();
    case "u32":
      return reader.readUint32();
    case "f32":
      return reader.readFloat32();
    case "f64":
      return reader.readFloat64();
    case "string":
      return reader.readString();
  }
}

/** Walk `schema` in order, decoding each descriptor from `reader` into a keyed object. */
export function readFields(reader: BinaryReader, schema: Schema): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of schema) {
    out[field.name] = readOne(reader, field.type);
  }
  return out;
}

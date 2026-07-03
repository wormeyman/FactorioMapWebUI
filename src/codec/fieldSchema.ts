import type { BinaryReader } from "./binaryReader";
import type { BinaryWriter } from "./binaryWriter";

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

function writeOne(writer: BinaryWriter, type: FieldType, value: FieldValue): void {
  if (typeof type === "object") {
    writer.writeBytes(value as Uint8Array);
    return;
  }
  switch (type) {
    case "u8":
      writer.writeUint8(value as number);
      return;
    case "u16":
      writer.writeUint16(value as number);
      return;
    case "u32":
      writer.writeUint32(value as number);
      return;
    case "f32":
      writer.writeFloat32(value as number);
      return;
    case "f64":
      writer.writeFloat64(value as number);
      return;
    case "string":
      writer.writeString(value as string);
      return;
  }
}

/** Walk `schema` in order, encoding `values[field.name]` into `writer`. The exact inverse of readFields. */
export function writeFields(
  writer: BinaryWriter,
  schema: Schema,
  values: Record<string, FieldValue>,
): void {
  for (const field of schema) {
    writeOne(writer, field.type, values[field.name] as FieldValue);
  }
}

import { base64ToBytes, bytesToBase64 } from "./base64";
import { BinaryReader } from "./binaryReader";
import { BinaryWriter } from "./binaryWriter";
import { crc32 } from "./crc32";
import { deflateLevel9, inflate } from "./deflate";
import { readFields, writeFields, type FieldValue, type Schema } from "./fieldSchema";

export interface AutoplaceSetting {
  frequency: number;
  size: number;
  richness: number;
}

export type FormatVersion = [number, number, number, number];

export interface MidBlock {
  /** 2 opaque bytes before seed (00 01 in every fixture). */
  opaqueHead: Uint8Array;
  /** Map generation seed (u32 LE at mid offset 2). */
  seed: number;
  /** Map width in tiles (u32 LE at mid offset 6). */
  width: number;
  /** Map height in tiles (u32 LE at mid offset 10). */
  height: number;
  /** 24 opaque bytes between height and starting_area (autoplace_settings flags, starting_points; unmapped). */
  opaqueRestA: Uint8Array;
  /** Starting-area size scale (f32 LE at mid offset 38). */
  startingArea: number;
  /** 13 opaque bytes after starting_area (peaceful/no_enemies bools; unmapped). */
  opaqueRestB: Uint8Array;
}

export interface DecodedExchange {
  version: FormatVersion;
  flagByte: number;
  autoplaceControls: Record<string, AutoplaceSetting>;
  /** The 55-byte MapGenSettings block between autoplace and property_expression_names, with width/height typed and the rest opaque (typed further in Phase 1c). */
  mid: MidBlock;
  propertyExpressionNames: Record<string, string>;
  /** Payload bytes after property_expression_names, excluding the trailing CRC. Cliff name/control are typed; the rest is opaque until later Phase 1c tasks. */
  tail: TailBlock;
  crc: number;
  /** The full inflated payload (including CRC), for round-trip tests. */
  payload: Uint8Array;
}

export class ExchangeStringError extends Error {}

// version (8) + flag (1) + count (1) + mid block (55) + count (1) + CRC (4)
const MIN_PAYLOAD_LENGTH = 70;

// Schema for the 55-byte MapGenSettings block between autoplace and
// property_expression_names (terrain / water / starting area; varies per preset).
// Empirical for format 2.1.9.3, verified on all 9 fixtures.
// One ordered schema shared by decode and encode; fixed widths MUST sum to 55: 2 + 4 + 4 + 4 + 24 + 4 + 13.
export const MID_BLOCK_SCHEMA: Schema = [
  { name: "opaqueHead", type: { opaque: 2 } },
  { name: "seed", type: "u32" },
  { name: "width", type: "u32" },
  { name: "height", type: "u32" },
  { name: "opaqueRestA", type: { opaque: 24 } },
  { name: "startingArea", type: "f32" },
  { name: "opaqueRestB", type: { opaque: 13 } },
];

// The only format this decoder understands; MID_BLOCK_SCHEMA is empirical for it.
const SUPPORTED_VERSION: FormatVersion = [2, 1, 9, 3];

export interface TailBlock {
  [key: string]: string | number | boolean | Uint8Array | null | (string | number | boolean)[];
}

// The tail, walked as one flat schema (dotted names encode section membership).
// Grows across Phase 1c; ALWAYS ends with an opaque span that absorbs the rest,
// so round-trip is byte-exact at every stage of typing.
export const TAIL_SCHEMA: Schema = [
  { name: "cliff.name", type: "string" },
  { name: "cliff.control", type: "string" },
  { name: "cliff.cliffElevation0", type: "f32" },
  { name: "cliff.cliffElevationInterval", type: "f32" },
  { name: "cliff.cliffSmoothing", type: "f32" },
  { name: "cliff.richness", type: "f32" },
  // Two unmapped bytes between the cliff floats and the pollution section
  // (Default-tail offset 23-24); round-trip-only, values unknown.
  { name: "cliff.trailing", type: { opaque: 2 } },
  { name: "pollution.enabled", type: "bool" },
  { name: "pollution.diffusionRatio", type: { optional: "f64" } },
  { name: "pollution.minToDiffuse", type: { optional: "f64" } },
  { name: "pollution.ageing", type: { optional: "f64" } },
  { name: "pollution.expectedMaxPerChunk", type: { optional: "f64" } },
  { name: "pollution.minToShowPerChunk", type: { optional: "f64" } },
  { name: "pollution.minPollutionToDamageTrees", type: { optional: "f64" } },
  { name: "pollution.pollutionWithMaxForestDamage", type: { optional: "f64" } },
  { name: "pollution.pollutionPerTreeDamage", type: { optional: "f64" } },
  { name: "pollution.pollutionRestoredPerTreeDamage", type: { optional: "f64" } },
  { name: "pollution.maxPollutionToRestoreTrees", type: { optional: "f64" } },
  { name: "pollution.enemyAttackPollutionConsumptionModifier", type: { optional: "f64" } },
  { name: "opaqueTail", type: { opaque: 0 } }, // width set dynamically below
];

// Fields of TAIL_SCHEMA excluding the trailing dynamic "opaqueTail".
const TAIL_FIXED_SCHEMA: Schema = TAIL_SCHEMA.filter((f) => f.name !== "opaqueTail");

function readTail(reader: BinaryReader): TailBlock {
  const out = readFields(reader, TAIL_FIXED_SCHEMA) as TailBlock;
  out["opaqueTail"] = reader.remaining();
  return out;
}

function writeTail(writer: BinaryWriter, tail: TailBlock): void {
  writeFields(writer, TAIL_FIXED_SCHEMA, tail as Record<string, FieldValue>);
  writer.writeBytes(tail["opaqueTail"] as Uint8Array);
}

/** Bytes for the full tail (fixed prefix + opaque remainder), for the Preset-model interim bridge. */
export function tailToBytes(tail: TailBlock): Uint8Array {
  const writer = new BinaryWriter();
  writeTail(writer, tail);
  return writer.toBytes();
}

/** The inverse of tailToBytes, for the Preset-model interim bridge. */
export function bytesToTail(bytes: Uint8Array): TailBlock {
  return readTail(new BinaryReader(bytes));
}

export function decodeExchangeString(input: string): DecodedExchange {
  const compact = input.replaceAll(/\s+/g, "");
  if (!compact.startsWith(">>>") || !compact.endsWith("<<<") || compact.length < 7) {
    throw new ExchangeStringError("not a map exchange string (missing >>> <<< envelope)");
  }

  let compressed: Uint8Array;
  try {
    compressed = base64ToBytes(compact.slice(3, -3));
  } catch {
    throw new ExchangeStringError("envelope body is not valid base64");
  }

  let payload: Uint8Array;
  try {
    payload = inflate(compressed);
  } catch {
    throw new ExchangeStringError("body is not a valid zlib stream");
  }
  if (payload.length < MIN_PAYLOAD_LENGTH) {
    throw new ExchangeStringError(`payload too short (${payload.length} bytes)`);
  }

  const crcOffset = payload.length - 4;
  const storedCrc = new DataView(payload.buffer, payload.byteOffset + crcOffset, 4).getUint32(
    0,
    true,
  );
  const computedCrc = crc32(payload.subarray(0, crcOffset));
  if (storedCrc !== computedCrc) {
    throw new ExchangeStringError(
      `CRC mismatch: stored ${storedCrc.toString(16)}, computed ${computedCrc.toString(16)}`,
    );
  }

  try {
    const reader = new BinaryReader(payload.subarray(0, crcOffset));
    const version: FormatVersion = [
      reader.readUint16(),
      reader.readUint16(),
      reader.readUint16(),
      reader.readUint16(),
    ];
    if (!version.every((v, i) => v === SUPPORTED_VERSION[i])) {
      throw new ExchangeStringError(
        `unsupported exchange format ${version.join(".")} (supported: ${SUPPORTED_VERSION.join(".")})`,
      );
    }
    const flagByte = reader.readUint8();

    const autoplaceControls: Record<string, AutoplaceSetting> = {};
    const autoplaceCount = reader.readUint8();
    for (let i = 0; i < autoplaceCount; i++) {
      const name = reader.readString();
      autoplaceControls[name] = {
        frequency: reader.readFloat32(),
        size: reader.readFloat32(),
        richness: reader.readFloat32(),
      };
    }

    const mid = readFields(reader, MID_BLOCK_SCHEMA) as unknown as MidBlock;

    const propertyExpressionNames: Record<string, string> = {};
    const propertyCount = reader.readUint8();
    for (let i = 0; i < propertyCount; i++) {
      const key = reader.readString();
      propertyExpressionNames[key] = reader.readString();
    }

    const tail = readTail(reader);

    return {
      version,
      flagByte,
      autoplaceControls,
      mid,
      propertyExpressionNames,
      tail,
      crc: storedCrc,
      payload,
    };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ExchangeStringError(`payload truncated: ${error.message}`);
    }
    throw error;
  }
}

export interface EncodableExchange {
  version: FormatVersion;
  flagByte: number;
  autoplaceControls: Record<string, AutoplaceSetting>;
  mid: MidBlock;
  propertyExpressionNames: Record<string, string>;
  tail: TailBlock;
}

/**
 * Assemble the uncompressed payload (through the trailing CRC) as the exact
 * inverse of decodeExchangeString. Autoplace keys AND property_expression_names
 * keys are both emitted in code-point (ordinal) sort order (spec Sections 4 and
 * 5) so edited presets stay canonical; the mid-block and tail are re-emitted
 * verbatim. `.sort()` compares UTF-16 code units, which equals code-point order
 * for the ASCII prototype names Factorio uses.
 */
export function encodePayload(input: EncodableExchange): Uint8Array {
  const w = new BinaryWriter();
  for (const part of input.version) {
    w.writeUint16(part);
  }
  w.writeUint8(input.flagByte);

  const controlNames = Object.keys(input.autoplaceControls).sort();
  w.writeUint8(controlNames.length);
  for (const name of controlNames) {
    const control = input.autoplaceControls[name] as AutoplaceSetting;
    w.writeString(name);
    w.writeFloat32(control.frequency);
    w.writeFloat32(control.size);
    w.writeFloat32(control.richness);
  }

  writeFields(w, MID_BLOCK_SCHEMA, input.mid as unknown as Record<string, FieldValue>);

  const propertyKeys = Object.keys(input.propertyExpressionNames).sort();
  w.writeUint8(propertyKeys.length);
  for (const key of propertyKeys) {
    w.writeString(key);
    w.writeString(input.propertyExpressionNames[key] as string);
  }

  writeTail(w, input.tail);

  const body = w.toBytes();
  const payload = new Uint8Array(body.length + 4);
  payload.set(body, 0);
  new DataView(payload.buffer).setUint32(body.length, crc32(body), true);
  return payload;
}

/**
 * Encode a full map-exchange string: payload -> zlib deflate@9 -> base64,
 * wrapped in the >>> <<< envelope on a single line (the game ignores interior
 * whitespace on import, and the captured fixtures carry none).
 */
export function encodeExchangeString(input: EncodableExchange): string {
  const compressed = deflateLevel9(encodePayload(input));
  return `>>>${bytesToBase64(compressed)}<<<`;
}

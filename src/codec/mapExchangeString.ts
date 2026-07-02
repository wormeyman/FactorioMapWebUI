import { base64ToBytes } from "./base64";
import { BinaryReader } from "./binaryReader";
import { BinaryWriter } from "./binaryWriter";
import { crc32 } from "./crc32";
import { inflate } from "./deflate";

export interface AutoplaceSetting {
  frequency: number;
  size: number;
  richness: number;
}

export type FormatVersion = [number, number, number, number];

export interface DecodedExchange {
  version: FormatVersion;
  flagByte: number;
  autoplaceControls: Record<string, AutoplaceSetting>;
  /** The 55-byte undecoded MapGenSettings block between autoplace and property_expression_names (terrain / water / starting area; varies per preset; mapped in Phase 1). */
  midBlock: Uint8Array;
  propertyExpressionNames: Record<string, string>;
  /** Payload bytes after property_expression_names, excluding the trailing CRC. Undecoded until Phase 1. */
  tail: Uint8Array;
  crc: number;
  /** The full inflated payload (including CRC), for round-trip tests. */
  payload: Uint8Array;
}

export class ExchangeStringError extends Error {}

// version (8) + flag (1) + count (1) + mid block (55) + count (1) + CRC (4)
const MIN_PAYLOAD_LENGTH = 70;

// Undecoded MapGenSettings block between autoplace and property_expression_names.
// Empirical for format 2.1.9.3, verified on all 9 fixtures (Phase 1 maps its fields).
const MID_BLOCK_LENGTH = 55;

// The only format this decoder understands; MID_BLOCK_LENGTH is empirical for it.
const SUPPORTED_VERSION: FormatVersion = [2, 1, 9, 3];

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

    const midBlock = reader.readBytes(MID_BLOCK_LENGTH);

    const propertyExpressionNames: Record<string, string> = {};
    const propertyCount = reader.readUint8();
    for (let i = 0; i < propertyCount; i++) {
      const key = reader.readString();
      propertyExpressionNames[key] = reader.readString();
    }

    return {
      version,
      flagByte,
      autoplaceControls,
      midBlock,
      propertyExpressionNames,
      tail: reader.remaining(),
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
  midBlock: Uint8Array;
  propertyExpressionNames: Record<string, string>;
  tail: Uint8Array;
}

/**
 * Assemble the uncompressed payload (through the trailing CRC) as the exact
 * inverse of decodeExchangeString. Autoplace keys are emitted in code-point
 * order (spec Sections 4 and 5); the mid-block and tail are re-emitted verbatim.
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

  w.writeBytes(input.midBlock);

  const propertyKeys = Object.keys(input.propertyExpressionNames);
  w.writeUint8(propertyKeys.length);
  for (const key of propertyKeys) {
    w.writeString(key);
    w.writeString(input.propertyExpressionNames[key] as string);
  }

  w.writeBytes(input.tail);

  const body = w.toBytes();
  const payload = new Uint8Array(body.length + 4);
  payload.set(body, 0);
  new DataView(payload.buffer).setUint32(body.length, crc32(body), true);
  return payload;
}

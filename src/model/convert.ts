import { base64ToBytes, bytesToBase64 } from "../codec/base64";
import { BinaryReader } from "../codec/binaryReader";
import { BinaryWriter } from "../codec/binaryWriter";
import { readFields, writeFields, type FieldValue } from "../codec/fieldSchema";
import {
  MID_BLOCK_SCHEMA,
  type DecodedExchange,
  type EncodableExchange,
  type MidBlock,
} from "../codec/mapExchangeString";
import type { Preset } from "./types";

export function presetFromDecoded(name: string, decoded: DecodedExchange, builtin = false): Preset {
  const w = new BinaryWriter();
  writeFields(w, MID_BLOCK_SCHEMA, decoded.mid as unknown as Record<string, FieldValue>);
  return {
    name,
    builtin,
    seed: null,
    randomEachMap: true,
    autoplaceControls: structuredClone(decoded.autoplaceControls),
    opaqueMidB64: bytesToBase64(w.toBytes()),
    propertyExpressionNames: structuredClone(decoded.propertyExpressionNames),
    opaqueTailB64: bytesToBase64(decoded.tail),
    formatVersion: [...decoded.version],
  };
}

/**
 * Bridge a Preset back to the encoder's input. The flag byte is a constant 0
 * (never observed otherwise); the mid-block is decoded from its opaque base64
 * carrier back into a MidBlock via the shared schema, and the tail is
 * re-emitted verbatim.
 */
export function presetToEncodable(preset: Preset): EncodableExchange {
  const mid = readFields(
    new BinaryReader(base64ToBytes(preset.opaqueMidB64)),
    MID_BLOCK_SCHEMA,
  ) as unknown as MidBlock;
  return {
    version: preset.formatVersion,
    flagByte: 0,
    autoplaceControls: preset.autoplaceControls,
    mid,
    propertyExpressionNames: preset.propertyExpressionNames,
    tail: base64ToBytes(preset.opaqueTailB64),
  };
}

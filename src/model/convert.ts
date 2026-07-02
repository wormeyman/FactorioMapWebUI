import { base64ToBytes, bytesToBase64 } from "../codec/base64";
import type { DecodedExchange, EncodableExchange } from "../codec/mapExchangeString";
import type { Preset } from "./types";

export function presetFromDecoded(name: string, decoded: DecodedExchange, builtin = false): Preset {
  return {
    name,
    builtin,
    seed: null,
    randomEachMap: true,
    autoplaceControls: structuredClone(decoded.autoplaceControls),
    opaqueMidB64: bytesToBase64(decoded.midBlock),
    propertyExpressionNames: structuredClone(decoded.propertyExpressionNames),
    opaqueTailB64: bytesToBase64(decoded.tail),
    formatVersion: [...decoded.version],
  };
}

/**
 * Bridge a Preset back to the encoder's input. The flag byte is a constant 0
 * (never observed otherwise); the mid-block and tail are decoded from their
 * opaque base64 carriers and re-emitted verbatim.
 */
export function presetToEncodable(preset: Preset): EncodableExchange {
  return {
    version: preset.formatVersion,
    flagByte: 0,
    autoplaceControls: preset.autoplaceControls,
    midBlock: base64ToBytes(preset.opaqueMidB64),
    propertyExpressionNames: preset.propertyExpressionNames,
    tail: base64ToBytes(preset.opaqueTailB64),
  };
}

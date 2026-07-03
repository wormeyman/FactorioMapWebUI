import { base64ToBytes, bytesToBase64 } from "../codec/base64";
import type { DecodedExchange, EncodableExchange } from "../codec/mapExchangeString";
import type { Preset } from "./types";

export function presetFromDecoded(name: string, decoded: DecodedExchange, builtin = false): Preset {
  return {
    name,
    builtin,
    seed: decoded.mid.seed,
    randomEachMap: true,
    autoplaceControls: structuredClone(decoded.autoplaceControls),
    width: decoded.mid.width,
    height: decoded.mid.height,
    startingArea: decoded.mid.startingArea,
    opaqueMidHeadB64: bytesToBase64(decoded.mid.opaqueHead),
    opaqueMidRestAB64: bytesToBase64(decoded.mid.opaqueRestA),
    opaqueMidRestBB64: bytesToBase64(decoded.mid.opaqueRestB),
    propertyExpressionNames: structuredClone(decoded.propertyExpressionNames),
    opaqueTailB64: bytesToBase64(decoded.tail),
    formatVersion: [...decoded.version],
  };
}

/**
 * Bridge a Preset back to the encoder's input. The flag byte is a constant 0
 * (never observed otherwise); width/height/seed/startingArea are typed fields, the remaining
 * mid-block bytes are carried opaquely, and the tail is re-emitted verbatim.
 */
export function presetToEncodable(preset: Preset): EncodableExchange {
  return {
    version: preset.formatVersion,
    flagByte: 0,
    autoplaceControls: preset.autoplaceControls,
    mid: {
      opaqueHead: base64ToBytes(preset.opaqueMidHeadB64),
      seed: preset.seed ?? 0,
      width: preset.width,
      height: preset.height,
      opaqueRestA: base64ToBytes(preset.opaqueMidRestAB64),
      startingArea: preset.startingArea,
      opaqueRestB: base64ToBytes(preset.opaqueMidRestBB64),
    },
    propertyExpressionNames: preset.propertyExpressionNames,
    tail: base64ToBytes(preset.opaqueTailB64),
  };
}

import { base64ToBytes, bytesToBase64 } from "../codec/base64";
import {
  bytesToTail,
  tailToBytes,
  type DecodedExchange,
  type EncodableExchange,
} from "../codec/mapExchangeString";
import { tailToNested } from "./mapSettings";
import type { Preset } from "./types";

export function presetFromDecoded(name: string, decoded: DecodedExchange, builtin = false): Preset {
  const { cliff, mapSettings } = tailToNested(decoded.tail);
  return {
    name,
    builtin,
    // Wire 0 is Factorio's "random" sentinel; surface it as null so the
    // "random each new map" state is a single source of truth.
    seed: decoded.mid.seed === 0 ? null : decoded.mid.seed,
    autoplaceControls: structuredClone(decoded.autoplaceControls),
    width: decoded.mid.width,
    height: decoded.mid.height,
    startingArea: decoded.mid.startingArea,
    peacefulMode: decoded.mid.peacefulMode,
    noEnemiesMode: decoded.mid.noEnemiesMode,
    defaultEnableAllAutoplaceControls: decoded.mid.defaultEnableAllAutoplaceControls,
    opaqueMidRestAB64: bytesToBase64(decoded.mid.opaqueRestA),
    startingPoints: structuredClone(decoded.mid.startingPoints),
    propertyExpressionNames: structuredClone(decoded.propertyExpressionNames),
    opaqueTailB64: bytesToBase64(tailToBytes(decoded.tail)),
    cliffSettings: cliff,
    mapSettings,
    formatVersion: [...decoded.version],
  };
}

/**
 * Bridge a Preset back to the encoder's input. The flag byte is a constant 0
 * (never observed otherwise); width/height/seed/startingArea/enable flags and
 * startingPoints are typed fields, opaqueRestA is carried opaquely, and the
 * tail is re-emitted verbatim. autoplaceSettingsCount is always 0 (decode
 * rejects anything else), so it is re-emitted as 0.
 */
export function presetToEncodable(preset: Preset): EncodableExchange {
  return {
    version: preset.formatVersion,
    flagByte: 0,
    autoplaceControls: preset.autoplaceControls,
    mid: {
      autoplaceSettingsCount: 0,
      defaultEnableAllAutoplaceControls: preset.defaultEnableAllAutoplaceControls,
      seed: preset.seed ?? 0,
      width: preset.width,
      height: preset.height,
      opaqueRestA: base64ToBytes(preset.opaqueMidRestAB64),
      startingArea: preset.startingArea,
      peacefulMode: preset.peacefulMode,
      noEnemiesMode: preset.noEnemiesMode,
      startingPoints: preset.startingPoints.map((p) => ({ x: p.x, y: p.y })),
    },
    propertyExpressionNames: preset.propertyExpressionNames,
    tail: bytesToTail(base64ToBytes(preset.opaqueTailB64)),
  };
}

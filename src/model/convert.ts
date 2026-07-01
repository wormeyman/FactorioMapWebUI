import { bytesToBase64 } from "../codec/base64";
import type { DecodedExchange } from "../codec/mapExchangeString";
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

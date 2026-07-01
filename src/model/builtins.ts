import { decodeExchangeString } from "../codec/mapExchangeString";
import fixtures from "../../test/fixtures/builtin-presets.json";
import { presetFromDecoded } from "./convert";
import type { Preset } from "./types";

const exchangeStrings = fixtures.presets as Record<string, string>;

export const BUILTIN_NAMES: string[] = Object.keys(exchangeStrings);

let cache: Preset[] | undefined;

/** All 9 built-in presets, decoded once from the committed fixtures. Do not mutate. */
export function getBuiltinPresets(): Preset[] {
  cache ??= Object.entries(exchangeStrings).map(([name, s]) =>
    presetFromDecoded(name, decodeExchangeString(s), true),
  );
  return cache;
}

/** A deep clone of one built-in preset, safe to mutate (the app's `defaults` source). */
export function getBuiltinPreset(name: string): Preset {
  const preset = getBuiltinPresets().find((p) => p.name === name);
  if (!preset) {
    throw new Error(`unknown builtin preset: ${name}`);
  }
  return structuredClone(preset);
}

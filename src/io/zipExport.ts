import JSZip from "jszip";
import { encodeExchangeString } from "../codec/mapExchangeString";
import { presetToEncodable } from "../model/convert";
import type { Preset } from "../model/types";
import { toMapGenSettingsJson, toMapSettingsJson } from "./jsonExport";

/**
 * Bundle a preset's two Factorio JSON documents plus its map-exchange string
 * into a single downloadable ZIP `Blob`.
 */
export async function buildZip(preset: Preset): Promise<Blob> {
  const zip = new JSZip();
  zip.file("map-gen-settings.json", JSON.stringify(toMapGenSettingsJson(preset), null, 2));
  zip.file("map-settings.json", JSON.stringify(toMapSettingsJson(preset), null, 2));
  zip.file(`${preset.name}.txt`, encodeExchangeString(presetToEncodable(preset)));
  return zip.generateAsync({ type: "blob" });
}

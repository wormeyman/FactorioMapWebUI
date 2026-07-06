import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { presetFromDecoded } from "../src/model/convert";
import { buildZip } from "../src/io/zipExport";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

describe("buildZip", () => {
  it("bundles the two JSON files and the exchange string", async () => {
    const preset = presetFromDecoded(
      "Default",
      decodeExchangeString(presets["Default"] as string),
      true,
    );
    const blob = await buildZip(preset);
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file("map-gen-settings.json")).not.toBeNull();
    expect(zip.file("map-settings.json")).not.toBeNull();
    const txt = await zip.file("Default.txt")?.async("string");
    expect(txt?.startsWith(">>>")).toBe(true);
  });
});

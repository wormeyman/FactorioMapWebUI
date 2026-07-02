import { describe, expect, it } from "vite-plus/test";
import { bytesToBase64 } from "../src/codec/base64";
import { crc32 } from "../src/codec/crc32";
import { deflateLevel9 } from "../src/codec/deflate";
import { decodeExchangeString, ExchangeStringError } from "../src/codec/mapExchangeString";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;
const NAMES = Object.keys(presets);

describe("decodeExchangeString", () => {
  it.each(NAMES)("decodes %s as format 2.1.9.3 with a valid CRC", (name) => {
    const decoded = decodeExchangeString(presets[name] as string);
    expect(decoded.version).toEqual([2, 1, 9, 3]);
    expect(decoded.flagByte).toBe(0);
  });

  it.each(NAMES)("payload size of %s matches the recorded _decodeStatus", (name) => {
    const status = (fixtures._decodeStatus as Record<string, string>)[name] as string;
    const expectedSize = Number(/\((\d+) bytes/.exec(status)?.[1]);
    expect(decodeExchangeString(presets[name] as string).payload.length).toBe(expectedSize);
  });

  it("ignores whitespace/newlines inside the base64 body", () => {
    const wrapped = presets["Default"] as string;
    const compact = wrapped.replaceAll(/\s+/g, "");
    const rewrapped = `>>>\n${compact.slice(3, -3).replaceAll(/(.{57})/g, "$1\n")}\n<<<`;
    expect(decodeExchangeString(rewrapped).payload).toEqual(decodeExchangeString(wrapped).payload);
  });

  it("reads 28 autoplace controls from Default, in ordinal key order", () => {
    const controls = decodeExchangeString(presets["Default"] as string).autoplaceControls;
    const keys = Object.keys(controls);
    expect(keys).toHaveLength(28);
    // Wire order is ordinal (code-point) sorted; JS default sort is code-unit
    // order, identical for these ASCII names ('-' 0x2d sorts before '_' 0x5f).
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain("coal");
    expect(keys).toContain("vulcanus_coal");
    expect(keys).toContain("aquilo_crude_oil");
    expect(controls["coal"]).toEqual({ frequency: 1, size: 1, richness: 1 });
  });

  it("Rich Resources differs from Default exactly by richness 2.0 on the six nauvis resources", () => {
    const def = decodeExchangeString(presets["Default"] as string).autoplaceControls;
    const rich = decodeExchangeString(presets["Rich Resources"] as string).autoplaceControls;
    expect(Object.keys(rich)).toEqual(Object.keys(def));
    const changed: string[] = [];
    for (const [name, value] of Object.entries(rich)) {
      const base = def[name] as (typeof rich)[string];
      if (
        value.frequency !== base.frequency ||
        value.size !== base.size ||
        value.richness !== base.richness
      ) {
        changed.push(name);
        expect(value.frequency).toBe(base.frequency);
        expect(value.size).toBe(base.size);
        expect(value.richness).toBe(2);
      }
    }
    expect(changed.sort()).toEqual([
      "coal",
      "copper-ore",
      "crude-oil",
      "iron-ore",
      "stone",
      "uranium-ore",
    ]);
  });

  it.each(NAMES)("mid block of %s is exactly 55 bytes", (name) => {
    expect(decodeExchangeString(presets[name] as string).midBlock.length).toBe(55);
  });

  it("property_expression_names is empty in Default and pinned in Lakes, Island, Ribbon world", () => {
    expect(decodeExchangeString(presets["Default"] as string).propertyExpressionNames).toEqual({});
    const lakesKeys = [
      "aux",
      "cliff_elevation",
      "cliffiness",
      "elevation",
      "moisture",
      "trees_forest_path_cutout",
    ];
    expect(
      Object.keys(decodeExchangeString(presets["Lakes"] as string).propertyExpressionNames),
    ).toEqual(lakesKeys);
    expect(
      Object.keys(decodeExchangeString(presets["Island"] as string).propertyExpressionNames),
    ).toEqual(lakesKeys);
    expect(
      Object.keys(decodeExchangeString(presets["Ribbon world"] as string).propertyExpressionNames),
    ).toEqual(["elevation", "trees_forest_path_cutout"]);
  });

  it.each(NAMES)("tail of %s is non-empty (terrain/cliff/map settings live there)", (name) => {
    expect(decodeExchangeString(presets[name] as string).tail.length).toBeGreaterThan(0);
  });

  it("rejects a missing envelope", () => {
    expect(() => decodeExchangeString("eNqLjgUAARUAuQ==")).toThrow(ExchangeStringError);
    expect(() => decodeExchangeString(">>>eNqLjgUAARUAuQ==")).toThrow(ExchangeStringError);
  });

  it("rejects invalid base64 and invalid zlib streams", () => {
    expect(() => decodeExchangeString(">>>!!!!<<<")).toThrow(ExchangeStringError);
    expect(() => decodeExchangeString(">>>AAAAAAAA<<<")).toThrow(ExchangeStringError);
  });

  it("rejects a payload whose CRC does not match", () => {
    const good = decodeExchangeString(presets["Default"] as string);
    const corrupted = good.payload.slice();
    corrupted[20] = (corrupted[20] as number) ^ 0xff;
    const tampered = `>>>${bytesToBase64(deflateLevel9(corrupted))}<<<`;
    expect(() => decodeExchangeString(tampered)).toThrow(/CRC/);
  });

  it("rejects a payload with an unsupported format version", () => {
    const good = decodeExchangeString(presets["Default"] as string);
    const body = good.payload.slice(0, -4);
    body[0] = 3; // version major 2 -> 3 (uint16 LE low byte)
    const crc = crc32(body);
    const tampered = new Uint8Array(body.length + 4);
    tampered.set(body, 0);
    new DataView(tampered.buffer).setUint32(body.length, crc, true);
    const restrung = `>>>${bytesToBase64(deflateLevel9(tampered))}<<<`;
    expect(() => decodeExchangeString(restrung)).toThrow(/unsupported exchange format 3\.1\.9\.3/);
  });
});

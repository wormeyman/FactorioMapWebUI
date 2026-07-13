import { describe, expect, it } from "vite-plus/test";
import {
  ELEVATION_KEY,
  MAP_TYPES,
  matchMapType,
  readMapType,
  writeMapType,
} from "../src/model/mapType";

describe("MAP_TYPES", () => {
  it("lists Nauvis, Lakes, Island in GUI order with the captured values", () => {
    expect(MAP_TYPES.map((m) => m.id)).toEqual(["nauvis", "lakes", "island"]);
    expect(MAP_TYPES.map((m) => m.label)).toEqual([
      "Nauvis elevation",
      "Lakes elevation",
      "Island elevation",
    ]);
    expect(MAP_TYPES.map((m) => m.writeValue)).toEqual([
      null,
      "elevation_lakes",
      "elevation_island",
    ]);
  });

  it("has exactly one default option (writeValue === null)", () => {
    expect(MAP_TYPES.filter((m) => m.writeValue === null)).toHaveLength(1);
  });
});

describe("matchMapType", () => {
  it("resolves an absent value to the default (Nauvis) option", () => {
    expect(matchMapType(undefined).id).toBe("nauvis");
  });

  it("resolves a known writeValue to its option", () => {
    expect(matchMapType("elevation_lakes").id).toBe("lakes");
    expect(matchMapType("elevation_island").id).toBe("island");
  });

  it("resolves an explicit technical-default alias to Nauvis", () => {
    expect(matchMapType("elevation").id).toBe("nauvis");
  });

  it("resolves a readAlias against a synthetic list", () => {
    const types = [
      { id: "d", label: "D", writeValue: null, readAliases: ["base_x"] },
      { id: "o", label: "O", writeValue: "other" },
    ];
    expect(matchMapType("base_x", types).id).toBe("d");
  });

  it("preserves an unknown value as a transient option carrying it verbatim", () => {
    const t = matchMapType("elevation_modded_x");
    expect(t).toEqual({
      id: "elevation_modded_x",
      label: "elevation_modded_x",
      writeValue: "elevation_modded_x",
    });
  });
});

describe("readMapType", () => {
  it("reads the option from pen[ELEVATION_KEY]", () => {
    expect(readMapType({}).id).toBe("nauvis");
    expect(readMapType({ [ELEVATION_KEY]: "elevation_island" }).id).toBe("island");
  });

  it("never mutates the pen dict", () => {
    const pen = { [ELEVATION_KEY]: "elevation_lakes", other: "x" };
    const snapshot = JSON.stringify(pen);
    readMapType(pen);
    readMapType({});
    expect(JSON.stringify(pen)).toBe(snapshot);
  });
});

describe("writeMapType", () => {
  it("selecting the default (Nauvis) option deletes the key", () => {
    const pen: Record<string, string> = { [ELEVATION_KEY]: "elevation_island" };
    writeMapType(pen, "nauvis");
    expect(ELEVATION_KEY in pen).toBe(false);
  });

  it("selecting a known option sets its writeValue", () => {
    const pen: Record<string, string> = {};
    writeMapType(pen, "island");
    expect(pen[ELEVATION_KEY]).toBe("elevation_island");
    writeMapType(pen, "lakes");
    expect(pen[ELEVATION_KEY]).toBe("elevation_lakes");
  });

  it("an unknown id (the transient option) writes itself, idempotently", () => {
    const pen: Record<string, string> = { [ELEVATION_KEY]: "elevation_modded_x" };
    writeMapType(pen, "elevation_modded_x");
    expect(pen[ELEVATION_KEY]).toBe("elevation_modded_x");
  });
});

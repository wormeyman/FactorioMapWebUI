import { describe, expect, it } from "vite-plus/test";
import { crc32 } from "../src/codec/crc32";
import { TREE_SMALL_NOISE_SEED1, TREE_SPECIES } from "../src/noise/trees/treeCatalog";

const crcOf = (s: string): number => crc32(new TextEncoder().encode(s));

describe("TREE_SPECIES catalog", () => {
  it("has all 15 Nauvis tree species", () => {
    expect(TREE_SPECIES).toHaveLength(15);
  });

  it("names every species exactly once", () => {
    expect(new Set(TREE_SPECIES.map((s) => s.name)).size).toBe(15);
    expect(new Set(TREE_SPECIES.map((s) => s.seed1Name)).size).toBe(15);
  });

  // Factorio hashes a STRING seed1 with crc32 - see nauvisShared.ts:9. The
  // hardcoded numbers exist so src/noise never imports the codec at runtime;
  // this test is what keeps them honest.
  it("hardcodes seed1 as crc32 of the species' seed1 string", () => {
    for (const s of TREE_SPECIES) {
      expect(s.seed1, s.seed1Name).toBe(crcOf(s.seed1Name));
    }
    expect(TREE_SMALL_NOISE_SEED1).toBe(crcOf("tree-small"));
  });

  it("derives the expression name from the seed1 string", () => {
    // "tree-02-red" -> "tree_02_red": the Lua names differ only in separator.
    for (const s of TREE_SPECIES) {
      expect(s.name).toBe(s.seed1Name.replace(/-/g, "_"));
    }
  });

  it("keeps every parameter in the range trees.lua uses", () => {
    for (const s of TREE_SPECIES) {
      expect(s.cap, s.name).toBeGreaterThan(0);
      expect(s.cap, s.name).toBeLessThanOrEqual(0.45);
      expect(s.outputScale, s.name).toBeGreaterThanOrEqual(0.5);
      expect(s.outputScale, s.name).toBeLessThanOrEqual(0.8);
      expect(s.inputScaleDiv, s.name).toBeGreaterThanOrEqual(22);
      expect(s.inputScaleDiv, s.name).toBeLessThanOrEqual(40);
    }
  });

  it("orders ramps so the tops sit between the bottoms", () => {
    for (const s of TREE_SPECIES) {
      for (const [fb, ft, tt, tb] of [s.tempRamp, s.moistRamp]) {
        expect(fb, s.name).toBeLessThan(ft);
        expect(ft, s.name).toBeLessThanOrEqual(tt);
        expect(tt, s.name).toBeLessThan(tb);
      }
    }
  });

  it("sorts by descending cap so the early-out raises `best` fastest", () => {
    const caps = TREE_SPECIES.map((s) => s.cap);
    expect(caps).toEqual([...caps].sort((a, b) => b - a));
  });
});

import { describe, it, expect } from "vite-plus/test";
import { planTiles, stitchTiles } from "../src/noise/preview/tiling";

const full = { originX: -512, originY: -512, width: 1024, height: 1024, tilesPerPixel: 1 };

describe("planTiles", () => {
  it("covers the image exactly once, with no overlap", () => {
    const tiles = planTiles(full, 128);
    expect(tiles).toHaveLength(64);
    const seen = new Uint8Array(full.width * full.height);
    for (const t of tiles) {
      for (let y = 0; y < t.height; y++) {
        for (let x = 0; x < t.width; x++) {
          seen[(t.dy + y) * full.width + (t.dx + x)]++;
        }
      }
    }
    expect(seen.every((c) => c === 1)).toBe(true);
  });

  it("maps each tile's pixel offset to its world origin through tilesPerPixel", () => {
    const tiles = planTiles({ ...full, tilesPerPixel: 2 }, 128);
    const t = tiles.find((q) => q.dx === 128 && q.dy === 256)!;
    expect(t.originX).toBe(-512 + 128 * 2);
    expect(t.originY).toBe(-512 + 256 * 2);
    expect(t.tilesPerPixel).toBe(2);
  });

  it("handles a ragged trailing row and column", () => {
    const tiles = planTiles({ ...full, width: 100, height: 70 }, 32);
    // 4 columns (32, 32, 32, 4) x 3 rows (32, 32, 6)
    expect(tiles).toHaveLength(12);
    expect(tiles.filter((t) => t.width === 4)).toHaveLength(3);
    expect(tiles.filter((t) => t.height === 6)).toHaveLength(4);
    const area = tiles.reduce((n, t) => n + t.width * t.height, 0);
    expect(area).toBe(100 * 70);
  });

  it("returns a single tile when the tile size exceeds the image", () => {
    const tiles = planTiles({ ...full, width: 10, height: 10 }, 4096);
    expect(tiles).toEqual([
      { originX: -512, originY: -512, width: 10, height: 10, tilesPerPixel: 1, dx: 0, dy: 0 },
    ]);
  });

  it("rejects a non-positive tile size", () => {
    expect(() => planTiles(full, 0)).toThrow(/tileSize/);
  });
});

describe("stitchTiles", () => {
  it("writes each tile's rows into the right place in the full buffer", () => {
    const target = { width: 4, height: 2 };
    const left = new Uint8ClampedArray(2 * 2 * 4).fill(1);
    const right = new Uint8ClampedArray(2 * 2 * 4).fill(2);
    const out = stitchTiles(target, [
      { dx: 0, dy: 0, width: 2, height: 2, data: left },
      { dx: 2, dy: 0, width: 2, height: 2, data: right },
    ]);
    // Row 0: two pixels of 1, then two pixels of 2.
    expect([...out.subarray(0, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...out.subarray(8, 16)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    // Row 1 repeats the pattern.
    expect([...out.subarray(16, 24)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...out.subarray(24, 32)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import stream from "../docs/noise/spot-candidate-stream.seed123456.json";
import gameFixture from "./fixtures/spot-candidates.game.json";
import { spotCandidatePoints, spotSeedWord } from "../src/noise/spotCandidates";

describe("spotCandidates", () => {
  it("reproduces the recovered 20-candidate draw stream (seed0=123456, seed1=0) bit-exactly", () => {
    // The stream fixture records the raw 32-bit draws, recovered from the game
    // by CRT across region sizes 2048/2050/2058/2066. Reproducing them checks
    // the full u32 output, not just a mod-region_size shadow.
    const word = spotSeedWord({ seed0: 123456, seed1: 0, regionX: 0, regionY: 0 });
    // Re-derive draws through the public API at a power-of-two region size,
    // then also compare the raw values via a 2^32-sized "region".
    const pts = spotCandidatePoints(
      { seed0: 123456, seed1: 0, regionX: 0, regionY: 0 },
      2 ** 32,
      20,
    );
    expect(word).toBe(0x3e5c6c);
    for (const [i, vx, vy] of stream.candidate_index_to_Vx_Vy) {
      expect(pts[i].x + 2 ** 31).toBe(vx);
      expect(pts[i].y + 2 ** 31).toBe(vy);
    }
  });

  it("matches candidate sets captured from the game across seeds, regions and region sizes", () => {
    for (const c of gameFixture.cases) {
      const got = spotCandidatePoints(
        { seed0: c.seed0, seed1: c.seed1, regionX: c.regionX, regionY: c.regionY },
        c.regionSize,
        6,
      )
        .map((p) => [p.x, p.y])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(got).toEqual(c.candidates);
    }
  });

  it("clamps degenerate seed words to 0x155, after the seed0 XOR", () => {
    // Both of these drive the pre-clamp word to a tiny value; the game (and we)
    // land on the same clamped state, so their candidates are identical.
    const a = spotCandidatePoints({ seed0: 0, seed1: 678351820, regionX: 0, regionY: 0 }, 2048, 6);
    const b = spotCandidatePoints({ seed0: 4177452, seed1: 0, regionX: 0, regionY: 0 }, 2048, 6);
    expect(a).toEqual(b);
    expect(spotSeedWord({ seed0: 0, seed1: 678351820, regionX: 0, regionY: 0 })).toBe(0x155);
    // A large word arrived at via seed0 XOR must NOT be clamped.
    expect(spotSeedWord({ seed0: 0x80000000, seed1: 678351820, regionX: 0, regionY: 0 })).toBe(
      0x80000000,
    );
  });

  it("ignores bit 0 of seed0 (dead bit in all three taus88 words)", () => {
    const a = spotCandidatePoints({ seed0: 123456, seed1: 0, regionX: 0, regionY: 0 }, 1024, 8);
    const b = spotCandidatePoints({ seed0: 123457, seed1: 0, regionX: 0, regionY: 0 }, 1024, 8);
    expect(a).toEqual(b);
  });

  it("keeps every candidate inside its centred region", () => {
    for (const rs of [512, 1000, 1024, 2048]) {
      for (const [rx, ry] of [
        [0, 0],
        [-3, 7],
        [100, -100],
      ]) {
        for (const p of spotCandidatePoints(
          { seed0: 42, seed1: 7, regionX: rx, regionY: ry },
          rs,
          32,
        )) {
          expect(p.x).toBeGreaterThanOrEqual(rx * rs - rs / 2);
          expect(p.x).toBeLessThan(rx * rs + rs / 2);
          expect(p.y).toBeGreaterThanOrEqual(ry * rs - rs / 2);
          expect(p.y).toBeLessThan(ry * rs + rs / 2);
        }
      }
    }
  });
});

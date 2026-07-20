import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-random-penalty.seed123456.json";
import { randomPenaltyBatch, randomPenaltyWord } from "../src/noise/randomPenalty";

// Ground truth captured from Factorio 2.1.11 (RandomPenalty::run, RE'd from the
// non-stripped binary). See docs/noise/random-penalty-NOTES.md. random_penalty is
// a BATCH op: seeded from positions[0], streamed last->first, source<=0 skips a
// draw. Each fixture case is one ordered batch.

/** Reconstruct source[i] from the fixture's sourceKind (kept out of the fixture). */
function sourceValues(kind: string, positions: readonly { x: number; y: number }[]): number[] {
  switch (kind) {
    case "const1":
      return positions.map(() => 1);
    case "x":
      return positions.map((p) => p.x);
    default:
      throw new Error(`unknown sourceKind ${kind}`);
  }
}

describe("randomPenalty", () => {
  it("reproduces the game's own values across seeds, amplitudes and the source<=0 guard", () => {
    let worst = 0;
    for (const c of fixture.cases) {
      const source = sourceValues(c.sourceKind, fixture.positions);
      const got = randomPenaltyBatch(fixture.positions, source, {
        seed: c.rpSeed,
        amplitude: c.amplitude,
      });
      for (let i = 0; i < got.length; i++) {
        // The game stores the result as f32 (fcvt s5, d5); the arithmetic is
        // otherwise exact (integer taus88), so fround(got) should match bit-for-bit.
        worst = Math.max(worst, Math.abs(Math.fround(got[i]) - c.values[i]));
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("passes source<=0 through unchanged (the 'source must be > 0' guard)", () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    const out = randomPenaltyBatch(positions, [-2, 3], { seed: 1, amplitude: 1 });
    expect(out[0]).toBe(-2); // untouched, no draw consumed
    expect(out[1]).toBeLessThan(3); // penalized
    expect(out[1]).toBeGreaterThanOrEqual(2); // amplitude 1 => U in [0,1)
  });

  it("skips no draw for a source<=0 tile: the survivor gets the FIRST draw", () => {
    // With the leading tile suppressed (source<=0), the next tile must get draw 0,
    // i.e. the same value a lone [that tile] batch (seeded identically) would get.
    const positions = [
      { x: 2, y: 3 },
      { x: 2, y: 3 },
    ];
    const both = randomPenaltyBatch(positions, [0, 1], { seed: 1, amplitude: 1 });
    const lone = randomPenaltyBatch([positions[1]], [1], { seed: 1, amplitude: 1 });
    // seed is from positions[0] in both (same coords), and the survivor takes draw 0.
    expect(both[1]).toBe(lone[0]);
    expect(both[0]).toBe(0);
  });

  it("computes the seed word as max(341, 0x3FBE2C + 7919*trunc(x0) + 7907*trunc(y0+seed))", () => {
    // (0,0) seed=1 -> 0x3FBE2C + 7907 = 4201743.
    expect(randomPenaltyWord(0, 0, 1)).toBe(0x3fbe2c + 7907);
    // seed folds into y before truncation; fractional coords truncate toward zero.
    expect(randomPenaltyWord(0.9, 0.9, 0)).toBe(0x3fbe2c); // trunc(0.9)=0 both axes
    expect(randomPenaltyWord(-1.5, 0, 0)).toBe((0x3fbe2c + Math.imul(-1, 7919)) >>> 0);
  });

  it("is order/batch dependent: the same tile gets a different U per batch", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 5, y: 7 };
    const forward = randomPenaltyBatch([a, b], [1, 1], { seed: 1, amplitude: 1 });
    const reversed = randomPenaltyBatch([b, a], [1, 1], { seed: 1, amplitude: 1 });
    // a's value differs because the seed comes from positions[0] (a vs b).
    expect(forward[0]).not.toBe(reversed[1]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(randomPenaltyBatch([], [], { seed: 1, amplitude: 1 })).toEqual([]);
  });
});

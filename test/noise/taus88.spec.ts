import { describe, expect, it } from "vite-plus/test";
import { seededState, taus88Next } from "../../src/noise/taus88";

describe("taus88", () => {
  it("seededState sets all three words equal", () => {
    expect(seededState(0x155)).toEqual({ s1: 0x155, s2: 0x155, s3: 0x155 });
  });

  it("produces the canonical stream for a known seed", () => {
    // Captured from the canonical taus88 (word = 123456), first 3 draws.
    const st = seededState(123456);
    expect([taus88Next(st), taus88Next(st), taus88Next(st)]).toEqual([
      3669631575, 1109836763, 3071959505,
    ]);
  });
});

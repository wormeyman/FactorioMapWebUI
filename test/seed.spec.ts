import { describe, it, expect } from "vite-plus/test";
import { randomU32 } from "../src/util/seed";

describe("randomU32", () => {
  it("returns a non-negative 32-bit integer", () => {
    for (let i = 0; i < 100; i++) {
      const n = randomU32();
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

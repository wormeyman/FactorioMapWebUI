import { describe, expect, it } from "vite-plus/test";
import { isEnabled, setEnabled } from "../src/model/autoplaceEnabled";
import type { AutoplaceSetting } from "../src/model/types";

function make(size: number): AutoplaceSetting {
  return { frequency: 2, size, richness: 3 };
}

describe("autoplaceEnabled", () => {
  it("isEnabled is false only when size is 0", () => {
    expect(isEnabled(make(0))).toBe(false);
    expect(isEnabled(make(1))).toBe(true);
    expect(isEnabled(make(0.1667))).toBe(true);
  });

  it("setEnabled(false) sets size to 0 and leaves frequency/richness", () => {
    const c = make(1);
    setEnabled(c, false);
    expect(c.size).toBe(0);
    expect(c.frequency).toBe(2);
    expect(c.richness).toBe(3);
  });

  it("setEnabled(true) restores size to 1 with no remembered value", () => {
    const c = make(0);
    setEnabled(c, true);
    expect(c.size).toBe(1);
    expect(c.frequency).toBe(2);
    expect(c.richness).toBe(3);
  });
});

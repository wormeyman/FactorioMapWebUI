import { describe, expect, it } from "vite-plus/test";
import fixtures from "./fixtures/builtin-presets.json";

describe("builtin-presets fixture file", () => {
  it("contains all 9 built-in presets wrapped in >>> <<<", () => {
    const presets = fixtures.presets as Record<string, string>;
    expect(Object.keys(presets)).toEqual([
      "Default",
      "Rich Resources",
      "Marathon",
      "Death world",
      "Death world marathon",
      "Rail world",
      "Ribbon world",
      "Lakes",
      "Island",
    ]);
    for (const s of Object.values(presets)) {
      expect(s.startsWith(">>>")).toBe(true);
      expect(s.endsWith("<<<")).toBe(true);
    }
  });
});

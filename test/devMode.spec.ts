import { describe, it, expect } from "vite-plus/test";
import { DEV_MODE_STORAGE_KEY, resolveDevMode } from "../src/model/devMode";

describe("resolveDevMode", () => {
  it("is off with no query parameter and nothing stored", () => {
    expect(resolveDevMode("", null)).toBe(false);
    expect(resolveDevMode("?seed=5", null)).toBe(false);
  });

  it("reads the stored value when the URL says nothing", () => {
    expect(resolveDevMode("", "1")).toBe(true);
    expect(resolveDevMode("", "0")).toBe(false);
    expect(resolveDevMode("?seed=5", "1")).toBe(true);
  });

  it("lets an explicit ?dev= override the stored value in both directions", () => {
    expect(resolveDevMode("?dev=1", "0")).toBe(true);
    expect(resolveDevMode("?dev=0", "1")).toBe(false);
  });

  it("treats a bare ?dev as on", () => {
    expect(resolveDevMode("?dev", null)).toBe(true);
    expect(resolveDevMode("?dev=", null)).toBe(true);
  });

  it("exposes a storage key that cannot collide with the preset store's", () => {
    expect(DEV_MODE_STORAGE_KEY).toBe("fmw.devMode");
  });
});

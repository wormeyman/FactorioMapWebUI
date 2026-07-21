import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { DEV_MODE_STORAGE_KEY } from "../src/model/devMode";
import { useUiStore } from "../src/store/ui";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  setActivePinia(createPinia());
});

describe("useUiStore devMode", () => {
  it("defaults to off with clean storage and a bare URL", () => {
    expect(useUiStore().devMode).toBe(false);
  });

  it("starts on when storage says so", () => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });

  it("lets ?dev=1 in the URL win over stored off", () => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    history.replaceState(null, "", "/?dev=1");
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });

  it("persists both directions through setDevMode", () => {
    const ui = useUiStore();
    ui.setDevMode(true);
    expect(ui.devMode).toBe(true);
    expect(localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe("1");

    ui.setDevMode(false);
    expect(ui.devMode).toBe(false);
    expect(localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe("0");
  });

  it("restores a stored flag in a fresh store instance", () => {
    useUiStore().setDevMode(true);
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });
});

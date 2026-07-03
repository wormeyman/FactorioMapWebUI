import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, ExchangeStringError } from "../src/codec/mapExchangeString";
import { STORAGE_KEY, usePresetsStore } from "../src/store/presets";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

describe("presets store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('seeds a "My preset" clone of Default on first launch', () => {
    const store = usePresetsStore();
    expect(store.userPresets.map((p) => p.name)).toEqual(["My preset"]);
    expect(store.activePreset?.autoplaceControls["coal"]?.frequency).toBe(1);
    expect(store.activePreset?.builtin).toBe(false);
  });

  it("creates a preset from a builtin and makes it active", () => {
    const store = usePresetsStore();
    store.createFromBuiltin("Rich Resources", "richer");
    expect(store.activeName).toBe("richer");
    expect(store.activePreset?.autoplaceControls["coal"]?.richness).toBe(2);
  });

  it("deduplicates preset names", () => {
    const store = usePresetsStore();
    store.createFromBuiltin("Default", "My preset");
    expect(store.activeName).toBe("My preset (2)");
  });

  it("persists on save and restores across a fresh pinia", () => {
    const store = usePresetsStore();
    const coal = store.activePreset?.autoplaceControls["coal"];
    if (coal) coal.frequency = 3;
    store.saveToStorage();

    setActivePinia(createPinia());
    const reloaded = usePresetsStore();
    expect(reloaded.activePreset?.autoplaceControls["coal"]?.frequency).toBe(3);
  });

  it("imports a valid exchange string as a new preset", () => {
    const store = usePresetsStore();
    store.importExchangeString("imported", presets["Marathon"] as string);
    expect(store.activeName).toBe("imported");
    expect(store.activePreset?.formatVersion).toEqual([2, 1, 9, 3]);
  });

  it("propagates ExchangeStringError on invalid import and leaves state unchanged", () => {
    const store = usePresetsStore();
    expect(() => store.importExchangeString("bad", "garbage")).toThrow(ExchangeStringError);
    expect(store.userPresets).toHaveLength(1);
  });

  it("duplicate and delete work and persist", () => {
    const store = usePresetsStore();
    store.duplicateActive();
    expect(store.activeName).toBe("My preset (copy)");
    store.deleteActive();
    expect(store.activeName).toBe("My preset");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).userPresets).toHaveLength(1);
  });

  it("survives corrupted localStorage by reseeding", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const store = usePresetsStore();
    expect(store.userPresets).toHaveLength(1);
  });

  it("exposes an activeExchangeString that decodes back to the active preset", () => {
    const store = usePresetsStore();
    const active = store.activePreset;
    expect(active).toBeDefined();
    const encoded = store.activeExchangeString;
    expect(encoded).not.toBeNull();
    const decoded = decodeExchangeString(encoded as string);
    expect(Object.keys(decoded.autoplaceControls)).toEqual(
      Object.keys((active as NonNullable<typeof active>).autoplaceControls).sort(),
    );
    expect(decoded.version).toEqual([2, 1, 9, 3]);

    // Values (not just keys) must survive the store's presetToEncodable ->
    // encode -> decode bridge; this is the only test that exercises that path
    // for autoplace scalars. Wire scalars are float32, so compare via fround.
    const coal = (active as NonNullable<typeof active>).autoplaceControls["coal"];
    expect(coal).toBeDefined();
    expect(decoded.autoplaceControls["coal"]).toEqual({
      frequency: Math.fround(coal.frequency),
      size: Math.fround(coal.size),
      richness: Math.fround(coal.richness),
    });
  });

  it("exposes typed map width/height on the active preset and persists edits", () => {
    const store = usePresetsStore();
    expect(store.activePreset?.width).toBe(2000000);
    expect(store.activePreset?.height).toBe(2000000);

    const active = store.activePreset;
    if (active) active.height = 128;
    store.saveToStorage();

    setActivePinia(createPinia());
    const reloaded = usePresetsStore();
    expect(reloaded.activePreset?.height).toBe(128);

    // The edited height must survive the encode bridge, not just localStorage.
    const encoded = reloaded.activeExchangeString as string;
    expect(decodeExchangeString(encoded).mid.height).toBe(128);
  });
});

import { defineStore } from "pinia";
import { decodeExchangeString } from "../codec/mapExchangeString";
import { getBuiltinPreset } from "../model/builtins";
import { presetFromDecoded } from "../model/convert";
import type { Preset } from "../model/types";

export const STORAGE_KEY = "factorio-map-webui.presets.v1";

interface PersistedState {
  version: 1;
  userPresets: Preset[];
  activeName: string | null;
}

function loadPersisted(): PersistedState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.userPresets)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function seedState(): { userPresets: Preset[]; activeName: string | null } {
  const first = getBuiltinPreset("Default");
  first.name = "My preset";
  first.builtin = false;
  return { userPresets: [first], activeName: first.name };
}

export const usePresetsStore = defineStore("presets", {
  state: () => {
    const persisted = loadPersisted();
    if (persisted) {
      return { userPresets: persisted.userPresets, activeName: persisted.activeName };
    }
    return seedState();
  },

  getters: {
    activePreset(state): Preset | undefined {
      return state.userPresets.find((p) => p.name === state.activeName);
    },
  },

  actions: {
    uniqueName(base: string): string {
      const trimmed = base.trim() || "Preset";
      if (!this.userPresets.some((p) => p.name === trimmed)) return trimmed;
      let i = 2;
      while (this.userPresets.some((p) => p.name === `${trimmed} (${i})`)) i++;
      return `${trimmed} (${i})`;
    },

    selectPreset(name: string) {
      if (this.userPresets.some((p) => p.name === name)) {
        this.activeName = name;
      }
    },

    createFromBuiltin(builtinName: string, newName: string) {
      const preset = getBuiltinPreset(builtinName);
      preset.name = this.uniqueName(newName);
      preset.builtin = false;
      this.userPresets.push(preset);
      this.activeName = preset.name;
      this.saveToStorage();
    },

    importExchangeString(name: string, exchangeString: string) {
      const decoded = decodeExchangeString(exchangeString);
      const preset = presetFromDecoded(this.uniqueName(name), decoded);
      this.userPresets.push(preset);
      this.activeName = preset.name;
      this.saveToStorage();
    },

    duplicateActive() {
      const active = this.activePreset;
      if (!active) return;
      const copy = structuredClone(toRawPreset(active));
      copy.name = this.uniqueName(`${active.name} (copy)`);
      this.userPresets.push(copy);
      this.activeName = copy.name;
      this.saveToStorage();
    },

    deleteActive() {
      const index = this.userPresets.findIndex((p) => p.name === this.activeName);
      if (index === -1) return;
      this.userPresets.splice(index, 1);
      this.activeName = this.userPresets[0]?.name ?? null;
      this.saveToStorage();
    },

    saveToStorage() {
      const persisted: PersistedState = {
        version: 1,
        userPresets: this.userPresets,
        activeName: this.activeName,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    },
  },
});

/** structuredClone cannot clone Vue reactive proxies; strip via JSON. Presets are JSON-safe by design. */
function toRawPreset(preset: Preset): Preset {
  return JSON.parse(JSON.stringify(preset)) as Preset;
}

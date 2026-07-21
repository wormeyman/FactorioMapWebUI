import { defineStore } from "pinia";
import { DEV_MODE_STORAGE_KEY, resolveDevMode } from "../model/devMode";

/** `window.location.search`, or "" where there is no DOM. */
function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(DEV_MODE_STORAGE_KEY);
  } catch {
    // Storage can throw in private-browsing modes; the flag still works in-session.
    return null;
  }
}

/**
 * UI-only preferences, kept out of the preset store: this is panel chrome, not
 * map data, so it persists on every set instead of waiting for a Save.
 *
 * The URL and storage are read once, when the store is constructed. Toggling the
 * flag deliberately does NOT rewrite the URL, so a bookmarked `?dev=1` still
 * comes back in dev mode after a reload.
 */
export const useUiStore = defineStore("ui", {
  state: () => ({
    devMode: resolveDevMode(currentSearch(), readStored()),
  }),
  actions: {
    setDevMode(value: boolean) {
      this.devMode = value;
      try {
        localStorage.setItem(DEV_MODE_STORAGE_KEY, value ? "1" : "0");
      } catch {
        // Storage unavailable - keep the in-session flag and move on.
      }
    },
  },
});

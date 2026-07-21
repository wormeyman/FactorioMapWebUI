/**
 * The developer-mode flag: it reveals the preview panel's view toggles and the
 * render-timing readout. Deliberately separate from the preset store's
 * localStorage key - this is UI chrome, not map data, so it persists
 * immediately rather than waiting for a Save (see store/presets.ts).
 */
export const DEV_MODE_STORAGE_KEY = "fmw.devMode";

/**
 * Resolve the flag from its two sources. An explicit `?dev=` in the URL wins in
 * both directions, so a bookmarked `?dev=1` turns it on and `?dev=0` forces it
 * off regardless of what was stored; with no parameter the stored value decides.
 */
export function resolveDevMode(search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get("dev");
  if (param !== null) return param !== "0";
  return stored === "1";
}

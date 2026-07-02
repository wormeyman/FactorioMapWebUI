import { Window } from "happy-dom";

// Node 26 ships a native experimental `globalThis.localStorage` that resolves to
// `undefined` unless the process is started with `--localstorage-file`. Under
// vitest's happy-dom environment that native binding wins: happy-dom exposes
// `localStorage` as a Window *prototype* accessor rather than an own property,
// so vitest never copies it onto the merged global, leaving Node's stub in
// place. Install a real happy-dom Storage on the global (and thereby on
// `window`, which is the same object) so DOM-backed tests see working storage.
if (typeof globalThis.localStorage === "undefined") {
  const win = new Window({ url: "https://localhost/" });
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, {
      value: win[key],
      configurable: true,
      writable: true,
    });
  }
}

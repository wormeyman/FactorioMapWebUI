import { Window } from "happy-dom";

// Node 26 ships a native experimental `globalThis.localStorage` that resolves to
// `undefined` unless the process is started with `--localstorage-file`. Under
// vitest's happy-dom environment that native binding wins: happy-dom exposes
// `localStorage` as a Window *prototype* accessor rather than an own property,
// so vitest never copies it onto the merged global, leaving Node's stub in
// place. Install a real happy-dom Storage on the global (and thereby on
// `window`, which is the same object) so DOM-backed tests see working storage.
// Install unconditionally. Probing with `typeof globalThis.localStorage` would
// *invoke* Node's native getter, and that access is what emits
// "ExperimentalWarning: localStorage is not available because
// --localstorage-file was not provided" - once per test file (101 lines a run,
// which lands in the deploy log now that `verify` gates deploys). Defining the
// property without reading it first is silent, and happy-dom's Storage is what
// we want in every case anyway.
const win = new Window({ url: "https://localhost/" });
for (const key of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, key, {
    value: win[key],
    configurable: true,
    writable: true,
  });
}

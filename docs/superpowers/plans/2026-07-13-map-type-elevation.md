# Map type (elevation) Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the disabled "Map type" dropdown on the Terrain tab live so the user can select the base-game elevation presets (Nauvis / Lakes / Island), byte-exact with Factorio 2.1.x.

**Architecture:** Model + UI only - no codec changes. The map type lives entirely in one `property_expression_names` (PEN) key, `elevation`, which the codec already round-trips opaquely. A new `src/model/mapType.ts` mirrors the non-mutating + default-omission discipline of `src/model/climateControls.ts`; `TerrainTab.vue` binds the existing `FDropdown` to it through the same Pinia reactive path the moisture/aux sliders use.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, TypeScript, Vite+ test runner (`vite-plus/test`), `@vue/test-utils`.

## Global Constraints

- Codec byte-exactness is a hard invariant: re-encoding a decoded string must reproduce the original bytes. This feature touches **no** codec code and **no** `test/fixtures/*` ground truth. (`CLAUDE.md`)
- Run the test runner through pnpm: `pnpm vp test` (full) or `pnpm vp test test/<file>.spec.ts` (single). Lint/format: `pnpm vp check --fix`. A bare `vp` fails with `EBADDEVENGINES`.
- Test imports come from `"vite-plus/test"` (e.g. `import { describe, it, expect } from "vite-plus/test";`).
- Control edits mutate reactive state but are **not** persisted to localStorage until an action calls `saveToStorage()`. This feature does not change that and must not add persistence.
- The authoritative option data (finalized) - Factorio 2.1.10 base mod, from `docs/mapexchangestrings/maptype-elevation-NOTES.md`:
  - Nauvis elevation -> default option, `writeValue: null`, `readAliases: ["elevation"]`
  - Lakes elevation  -> `writeValue: "elevation_lakes"`
  - Island elevation -> `writeValue: "elevation_island"`
  - Order in the dropdown: Nauvis, Lakes, Island.
- Use hyphens, never em/en dashes, in any file content.

---

## File Structure

- `docs/mapexchangestrings/maptype-elevation-expressions.json` (already created) - raw oracle dump.
- `docs/mapexchangestrings/maptype-elevation-NOTES.md` (already created) - capture notes + finalized mapping.
- `src/model/mapType.ts` (new) - the `MapType` model: `ELEVATION_KEY`, `MAP_TYPES`, `matchMapType`, `readMapType`, `writeMapType`.
- `test/mapType.spec.ts` (new) - unit tests for the model.
- `src/components/TerrainTab.vue` (modify) - replace the disabled placeholder dropdown with the live one.
- `test/terrainTab.spec.ts` (modify) - replace the "disabled dropdown" test with live-dropdown tests.

---

## Task 1: Commit the oracle capture artifacts

The oracle capture is already done; this task commits its two artifact files so the model's data provenance is in the repo before code depends on it.

**Files:**
- Commit (already created): `docs/mapexchangestrings/maptype-elevation-expressions.json`
- Commit (already created): `docs/mapexchangestrings/maptype-elevation-NOTES.md`

**Interfaces:**
- Produces: the finalized option list documented in `maptype-elevation-NOTES.md` (Nauvis/Lakes/Island with the values in Global Constraints). Task 2 hard-codes those exact values into `MAP_TYPES`.

- [ ] **Step 1: Verify both artifact files exist and are well-formed**

Run: `python3 -m json.tool docs/mapexchangestrings/maptype-elevation-expressions.json >/dev/null && echo OK`
Expected: `OK` (valid JSON). Also confirm `docs/mapexchangestrings/maptype-elevation-NOTES.md` exists and lists Nauvis/Lakes/Island with values `null` / `elevation_lakes` / `elevation_island`.

- [ ] **Step 2: Commit**

```bash
git add docs/mapexchangestrings/maptype-elevation-expressions.json docs/mapexchangestrings/maptype-elevation-NOTES.md
git commit -m "docs: capture base-game elevation map-type oracle dump + notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `src/model/mapType.ts` model + tests

Pure model module mirroring `src/model/climateControls.ts`. All logic is in free functions over a plain PEN dict (`Record<string, string>`); no Vue/Pinia here.

**Files:**
- Create: `src/model/mapType.ts`
- Test: `test/mapType.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `ELEVATION_KEY: "elevation"`
  - `interface MapType { readonly id: string; readonly label: string; readonly writeValue: string | null; readonly readAliases?: readonly string[]; }`
  - `MAP_TYPES: readonly MapType[]`
  - `matchMapType(value: string | undefined, types?: readonly MapType[]): MapType`
  - `readMapType(pen: Record<string, string>): MapType`
  - `writeMapType(pen: Record<string, string>, id: string): void`

- [ ] **Step 1: Write the failing test**

Create `test/mapType.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  ELEVATION_KEY,
  MAP_TYPES,
  matchMapType,
  readMapType,
  writeMapType,
} from "../src/model/mapType";

describe("MAP_TYPES", () => {
  it("lists Nauvis, Lakes, Island in GUI order with the captured values", () => {
    expect(MAP_TYPES.map((m) => m.id)).toEqual(["nauvis", "lakes", "island"]);
    expect(MAP_TYPES.map((m) => m.label)).toEqual([
      "Nauvis elevation",
      "Lakes elevation",
      "Island elevation",
    ]);
    expect(MAP_TYPES.map((m) => m.writeValue)).toEqual([
      null,
      "elevation_lakes",
      "elevation_island",
    ]);
  });

  it("has exactly one default option (writeValue === null)", () => {
    expect(MAP_TYPES.filter((m) => m.writeValue === null)).toHaveLength(1);
  });
});

describe("matchMapType", () => {
  it("resolves an absent value to the default (Nauvis) option", () => {
    expect(matchMapType(undefined).id).toBe("nauvis");
  });

  it("resolves a known writeValue to its option", () => {
    expect(matchMapType("elevation_lakes").id).toBe("lakes");
    expect(matchMapType("elevation_island").id).toBe("island");
  });

  it("resolves an explicit technical-default alias to Nauvis", () => {
    expect(matchMapType("elevation").id).toBe("nauvis");
  });

  it("resolves a readAlias against a synthetic list", () => {
    const types = [
      { id: "d", label: "D", writeValue: null, readAliases: ["base_x"] },
      { id: "o", label: "O", writeValue: "other" },
    ];
    expect(matchMapType("base_x", types).id).toBe("d");
  });

  it("preserves an unknown value as a transient option carrying it verbatim", () => {
    const t = matchMapType("elevation_modded_x");
    expect(t).toEqual({
      id: "elevation_modded_x",
      label: "elevation_modded_x",
      writeValue: "elevation_modded_x",
    });
  });
});

describe("readMapType", () => {
  it("reads the option from pen[ELEVATION_KEY]", () => {
    expect(readMapType({}).id).toBe("nauvis");
    expect(readMapType({ [ELEVATION_KEY]: "elevation_island" }).id).toBe("island");
  });

  it("never mutates the pen dict", () => {
    const pen = { [ELEVATION_KEY]: "elevation_lakes", other: "x" };
    const snapshot = JSON.stringify(pen);
    readMapType(pen);
    readMapType({});
    expect(JSON.stringify(pen)).toBe(snapshot);
  });
});

describe("writeMapType", () => {
  it("selecting the default (Nauvis) option deletes the key", () => {
    const pen: Record<string, string> = { [ELEVATION_KEY]: "elevation_island" };
    writeMapType(pen, "nauvis");
    expect(ELEVATION_KEY in pen).toBe(false);
  });

  it("selecting a known option sets its writeValue", () => {
    const pen: Record<string, string> = {};
    writeMapType(pen, "island");
    expect(pen[ELEVATION_KEY]).toBe("elevation_island");
    writeMapType(pen, "lakes");
    expect(pen[ELEVATION_KEY]).toBe("elevation_lakes");
  });

  it("an unknown id (the transient option) writes itself, idempotently", () => {
    const pen: Record<string, string> = { [ELEVATION_KEY]: "elevation_modded_x" };
    writeMapType(pen, "elevation_modded_x");
    expect(pen[ELEVATION_KEY]).toBe("elevation_modded_x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/mapType.spec.ts`
Expected: FAIL - cannot resolve `../src/model/mapType` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/model/mapType.ts`:

```ts
/**
 * The Factorio "Map type" GUI dropdown. Unlike climate controls, elevation is a
 * named noise expression, not a `control:<name>:frequency|bias` constant, so it
 * is a single string enum written to one `property_expression_names` key.
 *
 * Option data captured from Factorio 2.1.10 (base mod) - see
 * docs/mapexchangestrings/maptype-elevation-NOTES.md.
 */
export const ELEVATION_KEY = "elevation";

export interface MapType {
  /** Stable dropdown option id (also the FDropdown option `value`). */
  readonly id: string;
  /** GUI label from core.cfg. */
  readonly label: string;
  /**
   * Value written to pen[ELEVATION_KEY] on selection. `null` marks the default
   * option -> selecting it deletes the key (default-omission), keeping a
   * Default-based preset byte-identical. The option IS the default iff
   * `writeValue === null` (no separate flag, which could desync).
   */
  readonly writeValue: string | null;
  /**
   * Extra explicit values that also read back as this option, beyond
   * `writeValue`. Nauvis aliases the engine's technical-default expression name
   * ("elevation") so an explicit occurrence still shows as Nauvis and is
   * preserved on an untouched read.
   */
  readonly readAliases?: readonly string[];
}

export const MAP_TYPES: readonly MapType[] = [
  { id: "nauvis", label: "Nauvis elevation", writeValue: null, readAliases: ["elevation"] },
  { id: "lakes", label: "Lakes elevation", writeValue: "elevation_lakes" },
  { id: "island", label: "Island elevation", writeValue: "elevation_island" },
];

function defaultType(types: readonly MapType[]): MapType {
  return types.find((t) => t.writeValue === null) ?? types[0];
}

/**
 * Resolve a stored elevation value to a map-type option. Pure; never mutates.
 * - `undefined` (absent key) -> the default option.
 * - a value equal to an option's `writeValue` or a `readAliases` entry -> it.
 * - any other (modded/future) value -> a transient preserve-option carrying it,
 *   so the value is displayed and never silently lost.
 */
export function matchMapType(
  value: string | undefined,
  types: readonly MapType[] = MAP_TYPES,
): MapType {
  if (value === undefined) return defaultType(types);
  for (const t of types) {
    if (t.writeValue === value) return t;
    if (t.readAliases?.includes(value)) return t;
  }
  return { id: value, label: value, writeValue: value };
}

export function readMapType(pen: Record<string, string>): MapType {
  return matchMapType(pen[ELEVATION_KEY]);
}

/**
 * Apply a selected option id to the PEN dict. A known option with a `null`
 * writeValue deletes the key (default-omission); otherwise the writeValue is
 * stored. An id not in MAP_TYPES (the transient preserve-option) writes itself,
 * so re-selecting a preserved unknown value is an idempotent no-op.
 */
export function writeMapType(pen: Record<string, string>, id: string): void {
  const option = MAP_TYPES.find((m) => m.id === id);
  const writeValue = option ? option.writeValue : id;
  if (writeValue === null) {
    delete pen[ELEVATION_KEY];
  } else {
    pen[ELEVATION_KEY] = writeValue;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vp test test/mapType.spec.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Lint**

Run: `pnpm vp check --fix`
Expected: no errors (formatting may auto-apply).

- [ ] **Step 6: Commit**

```bash
git add src/model/mapType.ts test/mapType.spec.ts
git commit -m "feat(model): mapType read/write over property_expression_names.elevation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the live dropdown into `TerrainTab.vue`

Replace the disabled placeholder with a live `FDropdown` bound to the active preset's PEN through a `computed` get/set, exactly like the moisture/aux sliders. `FDropdown` binds `{ value, label }` and emits the `value`, so the option `value` is the `MapType.id`.

**Files:**
- Modify: `src/components/TerrainTab.vue` (script: lines ~1-31 and the `<template>` `.map-type` block lines ~70-74)
- Test: `test/terrainTab.spec.ts` (replace the disabled-dropdown test at lines 56-62)

**Interfaces:**
- Consumes: `MAP_TYPES`, `readMapType`, `writeMapType` from `../model/mapType`; `usePresetsStore` (existing).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

In `test/terrainTab.spec.ts`, replace the existing test (lines 56-62, "renders a disabled Map type dropdown defaulting to Nauvis elevation") with:

```ts
  it("renders a live Map type dropdown listing Nauvis, Lakes, Island", () => {
    const wrapper = mountTab();
    const select = wrapper.find('[data-test="map-type"]');
    expect(select.exists()).toBe(true);
    expect((select.element as HTMLSelectElement).disabled).toBe(false);
    const labels = select.findAll("option").map((o) => o.text());
    expect(labels).toEqual(["Nauvis elevation", "Lakes elevation", "Island elevation"]);
  });

  it("defaults the Map type to Nauvis for a preset with no elevation override", () => {
    const wrapper = mountTab();
    const select = wrapper.find('[data-test="map-type"]');
    expect((select.element as HTMLSelectElement).value).toBe("nauvis");
  });

  it("selecting Island drives elevation=elevation_island into the exchange string", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const select = wrapper.find('[data-test="map-type"]');
    await select.setValue("island");
    const pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect(pen["elevation"]).toBe("elevation_island");
  });

  it("resetting Map type back to Nauvis removes the elevation key", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const select = wrapper.find('[data-test="map-type"]');
    await select.setValue("island");
    let pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect(pen["elevation"]).toBe("elevation_island");
    await select.setValue("nauvis");
    pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect("elevation" in pen).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vp test test/terrainTab.spec.ts`
Expected: FAIL - dropdown is still `disabled`, options are the single stub, `setValue` does not change the exchange string.

- [ ] **Step 3: Update the component script**

In `src/components/TerrainTab.vue`, replace the stub declaration (lines 30-31):

```ts
// Map type is a fixed placeholder until elevation presets are decoded.
const MAP_TYPE_OPTIONS = [{ value: "nauvis", label: "Nauvis elevation (Default)" }];
```

with an import (add to the existing import group near the top) and a live computed. Add to imports:

```ts
import { MAP_TYPES, readMapType, writeMapType } from "../model/mapType";
```

And where the stub was, add:

```ts
// The Map type dropdown selects the elevation noise expression, stored in the
// active preset's property_expression_names. Options bind by MapType.id; an
// imported preset carrying an unknown elevation value is surfaced as an extra,
// preserved option so nothing is silently dropped.
const mapTypeOptions = computed(() => {
  const current = store.activePreset
    ? readMapType(store.activePreset.propertyExpressionNames)
    : MAP_TYPES[0];
  const known = MAP_TYPES.map((m) => ({ value: m.id, label: m.label }));
  const isKnown = MAP_TYPES.some((m) => m.id === current.id);
  return isKnown ? known : [...known, { value: current.id, label: current.label }];
});

const mapType = computed({
  get: () => {
    const pen = store.activePreset?.propertyExpressionNames;
    return pen ? readMapType(pen).id : "nauvis";
  },
  set: (id: string) => {
    const pen = store.activePreset?.propertyExpressionNames;
    if (pen) writeMapType(pen, id);
  },
});
```

- [ ] **Step 4: Update the template**

In `src/components/TerrainTab.vue`, replace the `.map-type` block (lines 70-74):

```html
  <div class="map-type">
    <label class="map-type-label">Map type</label>
    <FDropdown data-test="map-type" model-value="nauvis" :options="MAP_TYPE_OPTIONS" disabled />
  </div>
```

with:

```html
  <div class="map-type">
    <label class="map-type-label">Map type</label>
    <FDropdown data-test="map-type" v-model="mapType" :options="mapTypeOptions" />
  </div>
```

- [ ] **Step 5: Run the tab tests to verify they pass**

Run: `pnpm vp test test/terrainTab.spec.ts`
Expected: PASS (the four new/updated cases plus the untouched ones).

- [ ] **Step 6: Run the full suite**

Run: `pnpm vp test`
Expected: PASS - no regressions (the codec/fixture round-trip tests must stay green, proving no byte-exactness regression).

- [ ] **Step 7: Lint**

Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/TerrainTab.vue test/terrainTab.spec.ts
git commit -m "feat(ui): live Map type dropdown (Nauvis/Lakes/Island elevation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Verify in the running app

Unit tests prove the wiring; this task confirms the real UI in a browser, the way the slider/checkbox work was verified.

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

Run: `pnpm vp dev` and open the Terrain tab.

- [ ] **Step 2: Confirm the dropdown behavior**

- The Map type dropdown is enabled and lists exactly "Nauvis elevation", "Lakes elevation", "Island elevation".
- On the Default preset it shows "Nauvis elevation".
- Selecting "Island elevation" and viewing the exported exchange string (the app's export/copy affordance) shows `elevation` = `elevation_island` in the decoded PEN; selecting "Nauvis elevation" again removes the key.
- Switching the active preset to the built-in "Lakes" (via the preset selector) shows the dropdown at "Lakes elevation".

- [ ] **Step 3: Note the result**

Record pass/fail in the branch notes. If any check fails, treat it as a real finding and debug before merge (use superpowers:systematic-debugging).

---

## Self-Review (completed by plan author)

- **Spec coverage:** model module (Task 2), UI wiring (Task 3), oracle capture/fixtures (Task 1), testing incl. byte-exactness via full-suite fixture round-trip (Task 3 Step 6), unknown-value preservation (Task 2 + Task 3 option list), default-omission (Task 2 + Task 3), in-app verification (Task 4). The spec's `readAliases` question is resolved: Nauvis carries `readAliases: ["elevation"]`; all three options are concrete.
- **Placeholder scan:** none - every code and command step is complete.
- **Type consistency:** `MapType`/`MAP_TYPES`/`matchMapType`/`readMapType`/`writeMapType` names and signatures are identical across Tasks 2 and 3; the FDropdown `{ value, label }` contract and the `id` binding are consistent with `src/ui/FDropdown.vue`.

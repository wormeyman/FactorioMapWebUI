# Enable/disable checkboxes for autoplace controls - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the game's per-row enable/disable checkbox to autoplace controls, byte-exact with Factorio 2.1.9, by treating `autoplace_controls[name].size === 0` as "disabled."

**Architecture:** No codec change and no new `Preset` field - "disabled" is a derived view over the existing `size` float. A catalog flag (`canBeDisabled`) marks which of the 28 controls get a checkbox; a tiny pure accessor (`autoplaceEnabled.ts`) centralizes the `size === 0` convention; the single shared `ControlRow.vue` renders the checkbox (or an equal-width spacer for always-on rows) and grays a disabled row's sliders. Edits flow through the existing Pinia reactive path into `activeExchangeString`.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, TypeScript, Vitest-compatible tests via `vite-plus/test`, `@vue/test-utils`.

## Global Constraints

- **Byte-exactness is a hard invariant.** The encoder must reproduce the game's zlib@9 stream byte-for-byte; `size: 0` is an ordinary float the codec already round-trips. Do NOT touch `src/codec/`, `src/model/types.ts` `Preset`, or persistence.
- **Disabled ⟺ `size === 0`.** `frequency`/`richness` are retained across a disable. Re-enable sets `size = 1` (100%) - no remembered value.
- **Only `canBeDisabled` controls gray.** An always-on control (no checkbox) must never gray its sliders, even if it somehow carries `size: 0`.
- **The toggle does not self-persist** (no `saveToStorage()` call), consistent with existing slider edits.
- **The 22 disable-able controls** (checkbox): `aquilo_crude_oil`, `calcite`, `coal`, `copper-ore`, `crude-oil`, `fluorine_vent`, `fulgora_cliff`, `gleba_cliff`, `gleba_stone`, `iron-ore`, `lithium_brine`, `nauvis_cliff`, `rocks`, `scrap`, `starting_area_moisture`, `stone`, `sulfuric_acid_geyser`, `trees`, `tungsten_ore`, `uranium-ore`, `vulcanus_coal`, `water`. **The 6 always-on** (no checkbox): `enemy-base`, `fulgora_islands`, `gleba_enemy_base`, `gleba_plants`, `gleba_water`, `vulcanus_volcanism`. Ground truth: `test/fixtures/autoplace-can-be-disabled.dump.json`.
- **Commands:** tests `pnpm vp test [file]`; lint/format `pnpm vp check --fix`. Run `vp` through `pnpm`. Commit on `feat/disable-controls`; do not merge or push (Eric does that).

---

### Task 1: Codec round-trip + diff for the cliff captures (ground-truth lock)

Test-only. Proves the two in-game captures round-trip byte-exact through the existing encoder and that their sole decoded difference is `nauvis_cliff.size` 1 → 0. No source change - this locks the mechanism before any UI work.

**Files:**
- Test (create): `test/cliffDisable.spec.ts`
- Reads (already committed): `docs/mapexchangestrings/cliffs-baseline-default.txt`, `docs/mapexchangestrings/cliffs-nauvis-off.txt`

**Interfaces:**
- Consumes: `decodeExchangeString`, `encodeExchangeString` from `src/codec/mapExchangeString` (existing).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test file**

Create `test/cliffDisable.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodeExchangeString } from "../src/codec/mapExchangeString";

const BASELINE = readFileSync("docs/mapexchangestrings/cliffs-baseline-default.txt", "utf8").trim();
const CLIFFS_OFF = readFileSync("docs/mapexchangestrings/cliffs-nauvis-off.txt", "utf8").trim();

describe("cliff disable captures", () => {
  it.each([
    ["baseline (cliffs on)", BASELINE],
    ["nauvis cliffs off", CLIFFS_OFF],
  ])("round-trips the %s capture byte-for-byte", (_label, s) => {
    expect(encodeExchangeString(decodeExchangeString(s))).toBe(s);
  });

  it("differs only in nauvis_cliff.size (1 -> 0); every other control is identical", () => {
    const on = decodeExchangeString(BASELINE).autoplaceControls;
    const off = decodeExchangeString(CLIFFS_OFF).autoplaceControls;

    expect(Object.keys(off).sort()).toEqual(Object.keys(on).sort());
    expect(on["nauvis_cliff"]).toEqual({ frequency: 1, size: 1, richness: 1 });
    expect(off["nauvis_cliff"]).toEqual({ frequency: 1, size: 0, richness: 1 });

    for (const name of Object.keys(on)) {
      if (name === "nauvis_cliff") continue;
      expect(off[name], name).toEqual(on[name]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm vp test test/cliffDisable.spec.ts`
Expected: PASS (3 assertions/cases). If the round-trip fails, that is a real codec finding - stop and report, do not edit fixtures.

- [ ] **Step 3: Commit**

```bash
git add test/cliffDisable.spec.ts
git commit -m "test(codec): round-trip + diff the cliff enable/disable captures"
```

---

### Task 2: `canBeDisabled` catalog flag

Add a per-control `canBeDisabled: boolean` to the control catalog, matching the game's `can_be_disabled` dump. This is the single source of "which rows get a checkbox," consumed by `ControlRow` in Task 4.

**Files:**
- Modify: `src/model/controlCatalog.ts`
- Test: `test/catalog.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: `test/fixtures/autoplace-can-be-disabled.dump.json` (already committed).
- Produces: `ControlEntry.canBeDisabled: boolean` on every entry of `CONTROL_CATALOG` (read as `CONTROL_CATALOG[name].canBeDisabled` by `ControlRow` in Task 4).

- [ ] **Step 1: Write the failing catalog test**

Append to `test/catalog.spec.ts`. First add the dump import near the top imports (after the existing `import fixtures ...` line):

```ts
import canBeDisabledDump from "./fixtures/autoplace-can-be-disabled.dump.json";
```

Then append this describe block at the end of the file:

```ts
describe("canBeDisabled flag", () => {
  const dump = canBeDisabledDump as Record<string, { can_be_disabled: boolean }>;

  it("matches the game's can_be_disabled dump for all 28 controls", () => {
    expect(Object.keys(CONTROL_CATALOG).sort()).toEqual(Object.keys(dump).sort());
    for (const [name, entry] of Object.entries(CONTROL_CATALOG)) {
      expect(entry.canBeDisabled, name).toBe(dump[name]!.can_be_disabled);
    }
  });

  it("marks 22 controls disable-able and 6 always-on", () => {
    const vals = Object.values(CONTROL_CATALOG);
    expect(vals.filter((e) => e.canBeDisabled).length).toBe(22);
    expect(vals.filter((e) => !e.canBeDisabled).length).toBe(6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vp test test/catalog.spec.ts`
Expected: FAIL - `entry.canBeDisabled` is `undefined` (property does not exist yet), so both new assertions fail. (A type error on `.canBeDisabled` at compile is also acceptable evidence the field is missing.)

- [ ] **Step 3: Add the field to the interface and factories**

In `src/model/controlCatalog.ts`, add the field to `ControlEntry`:

```ts
export interface ControlEntry {
  planet: Planet;
  category: ControlCategory;
  label: string;
  hasRichness: boolean;
  /** True iff the game exposes an enable/disable checkbox for this control (its `can_be_disabled` flag). */
  canBeDisabled: boolean;
  /** Set only for terrain controls, to split them into their two tables. */
  terrainGroup?: TerrainGroup;
}
```

Update the factory functions. `resource`, `enemy`, and `cliff` are uniform (resources and cliffs are always disable-able; enemies never are); `terrain` takes an explicit flag because the coverage group is mixed:

```ts
function resource(planet: Planet, label: string): ControlEntry {
  return { planet, category: "resource", label, hasRichness: true, canBeDisabled: true };
}

function terrain(
  planet: Planet,
  label: string,
  canBeDisabled: boolean,
  terrainGroup: TerrainGroup = "coverage",
): ControlEntry {
  return { planet, category: "terrain", label, hasRichness: false, canBeDisabled, terrainGroup };
}

function cliff(planet: Planet, label: string): ControlEntry {
  return terrain(planet, label, true, "cliff");
}

function enemy(planet: Planet, label: string): ControlEntry {
  return { planet, category: "enemy", label, hasRichness: false, canBeDisabled: false };
}
```

- [ ] **Step 4: Update the coverage-terrain call sites to pass the flag**

In the `CONTROL_CATALOG` literal, the `terrain(...)` calls now need the `canBeDisabled` argument (the `cliff(...)` calls do not - they route through `cliff`). Update exactly these lines:

```ts
  water: terrain("nauvis", "Water", true),
  trees: terrain("nauvis", "Trees", true),
  rocks: terrain("nauvis", "Rocks", true),
  starting_area_moisture: terrain("nauvis", "Starting area moisture", true),
  // Vulcanus
  ...
  vulcanus_volcanism: terrain("vulcanus", "Vulcanus volcanism", false),
  // Gleba
  ...
  gleba_water: terrain("gleba", "Gleba water", false),
  gleba_plants: terrain("gleba", "Gleba plants", false),
  // Fulgora
  ...
  fulgora_islands: terrain("fulgora", "Fulgora islands", false),
```

Leave the `resource(...)`, `cliff(...)`, and `enemy(...)` call sites untouched. (Also fix the stray leading-space indentation on the `rocks:` line while you are there so `vp check` is clean.)

- [ ] **Step 5: Run the catalog test to verify it passes**

Run: `pnpm vp test test/catalog.spec.ts`
Expected: PASS (all existing tests plus the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/model/controlCatalog.ts test/catalog.spec.ts
git commit -m "feat(model): add canBeDisabled flag to the control catalog"
```

---

### Task 3: `autoplaceEnabled` accessor

A thin, pure, non-persisted accessor over an `AutoplaceSetting` that keeps the `size === 0` convention in one documented place.

**Files:**
- Create: `src/model/autoplaceEnabled.ts`
- Test (create): `test/autoplaceEnabled.spec.ts`

**Interfaces:**
- Consumes: `AutoplaceSetting` from `src/model/types` (`{ frequency: number; size: number; richness: number }`).
- Produces: `isEnabled(control: AutoplaceSetting): boolean` and `setEnabled(control: AutoplaceSetting, on: boolean): void`, imported by `ControlRow.vue` in Task 4.

- [ ] **Step 1: Write the failing unit test**

Create `test/autoplaceEnabled.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { isEnabled, setEnabled } from "../src/model/autoplaceEnabled";
import type { AutoplaceSetting } from "../src/model/types";

function make(size: number): AutoplaceSetting {
  return { frequency: 2, size, richness: 3 };
}

describe("autoplaceEnabled", () => {
  it("isEnabled is false only when size is 0", () => {
    expect(isEnabled(make(0))).toBe(false);
    expect(isEnabled(make(1))).toBe(true);
    expect(isEnabled(make(0.1667))).toBe(true);
  });

  it("setEnabled(false) sets size to 0 and leaves frequency/richness", () => {
    const c = make(1);
    setEnabled(c, false);
    expect(c.size).toBe(0);
    expect(c.frequency).toBe(2);
    expect(c.richness).toBe(3);
  });

  it("setEnabled(true) restores size to 1 with no remembered value", () => {
    const c = make(0);
    setEnabled(c, true);
    expect(c.size).toBe(1);
    expect(c.frequency).toBe(2);
    expect(c.richness).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vp test test/autoplaceEnabled.spec.ts`
Expected: FAIL - module `../src/model/autoplaceEnabled` does not exist.

- [ ] **Step 3: Write the accessor**

Create `src/model/autoplaceEnabled.ts`:

```ts
import type { AutoplaceSetting } from "./types";

/**
 * A derived, non-persisted view of an autoplace control's enabled state. The
 * game encodes "disabled" as `size === 0` (only reachable via the row's
 * checkbox, never a slider notch, which start at ~17%). Keeping the convention
 * here avoids scattering `=== 0` across components.
 */
export function isEnabled(control: AutoplaceSetting): boolean {
  return control.size !== 0;
}

/**
 * Enable -> size 1 (100%); disable -> size 0. `frequency` and `richness` are
 * untouched. Re-enabling always restores size to 1 (no remembered pre-disable
 * value), matching the game's own behavior on import.
 */
export function setEnabled(control: AutoplaceSetting, on: boolean): void {
  control.size = on ? 1 : 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vp test test/autoplaceEnabled.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/autoplaceEnabled.ts test/autoplaceEnabled.spec.ts
git commit -m "feat(model): add autoplaceEnabled isEnabled/setEnabled accessor"
```

---

### Task 4: The checkbox in `ControlRow.vue` (UI)

> Implement this task on **sonnet** (UI/Vue work). Others may use the cheapest capable model.

Add the enable checkbox to the single shared row component: a fixed-width gutter in the label cell that holds a checkbox for `canBeDisabled` controls and an equal-width empty spacer otherwise (keeps labels aligned in the mixed Terrain coverage table). When a `canBeDisabled` control is disabled, gray the row's sliders; always-on controls never gray.

**Files:**
- Modify: `src/components/ControlRow.vue`
- Test (create): `test/controlRow.spec.ts`

**Interfaces:**
- Consumes: `CONTROL_CATALOG[name].canBeDisabled` (Task 2); `isEnabled`, `setEnabled` (Task 3); `FPercentSlider`'s existing `disabled` prop.
- Produces: a checkbox `input[type="checkbox"][data-test="control-enable"]` on disable-able rows; a `span.control-enable` gutter on every row.

- [ ] **Step 1: Write the failing component test**

Create `test/controlRow.spec.ts`:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import ControlRow from "../src/components/ControlRow.vue";
import type { ControlColumn } from "../src/model/controlCatalog";
import { usePresetsStore } from "../src/store/presets";

const CLIFF_COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Continuity" },
];

function mountRow(name: string) {
  setActivePinia(createPinia());
  localStorage.clear();
  const store = usePresetsStore();
  const wrapper = mount(ControlRow, { props: { name, columns: CLIFF_COLUMNS } });
  return { store, wrapper };
}

describe("ControlRow enable checkbox", () => {
  beforeEach(() => localStorage.clear());

  it("renders an enable checkbox for a disable-able control", () => {
    const { wrapper } = mountRow("nauvis_cliff");
    expect(wrapper.find('input[type="checkbox"][data-test="control-enable"]').exists()).toBe(true);
  });

  it("renders no checkbox but keeps the gutter spacer for an always-on control", () => {
    const { wrapper } = mountRow("vulcanus_volcanism");
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.find(".control-enable").exists()).toBe(true);
  });

  it("unchecking sets size to 0 and disables the row's sliders", async () => {
    const { store, wrapper } = mountRow("nauvis_cliff");
    await wrapper.find('input[type="checkbox"]').setValue(false);
    expect(store.activePreset!.autoplaceControls["nauvis_cliff"]!.size).toBe(0);
    const sliders = wrapper.findAll('input[type="range"]');
    expect(sliders.length).toBe(2);
    expect(sliders.every((s) => (s.element as HTMLInputElement).disabled)).toBe(true);
  });

  it("re-checking restores size to 1 and re-enables the sliders", async () => {
    const { store, wrapper } = mountRow("nauvis_cliff");
    const cb = wrapper.find('input[type="checkbox"]');
    await cb.setValue(false);
    await cb.setValue(true);
    expect(store.activePreset!.autoplaceControls["nauvis_cliff"]!.size).toBe(1);
    const sliders = wrapper.findAll('input[type="range"]');
    expect(sliders.every((s) => !(s.element as HTMLInputElement).disabled)).toBe(true);
  });

  it("never grays an always-on control even when its size is 0", async () => {
    const { store, wrapper } = mountRow("vulcanus_volcanism");
    store.activePreset!.autoplaceControls["vulcanus_volcanism"]!.size = 0;
    await wrapper.vm.$nextTick();
    const sliders = wrapper.findAll('input[type="range"]');
    expect(sliders.every((s) => !(s.element as HTMLInputElement).disabled)).toBe(true);
  });

  it("preserves frequency and richness across a disable then enable", async () => {
    const { store, wrapper } = mountRow("nauvis_cliff");
    const ctrl = store.activePreset!.autoplaceControls["nauvis_cliff"]!;
    ctrl.frequency = 2;
    ctrl.richness = 3;
    const cb = wrapper.find('input[type="checkbox"]');
    await cb.setValue(false);
    await cb.setValue(true);
    expect(ctrl.size).toBe(1);
    expect(ctrl.frequency).toBe(2);
    expect(ctrl.richness).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vp test test/controlRow.spec.ts`
Expected: FAIL - no checkbox is rendered yet, so the first test (and the toggle tests) fail.

- [ ] **Step 3: Add the checkbox, gutter, and slider graying to `ControlRow.vue`**

Edit `src/components/ControlRow.vue`. Update the `<script setup>` to import the accessor and compute enabled state + a toggle handler:

```ts
<script setup lang="ts">
import { computed } from "vue";
import { CONTROL_CATALOG, type ControlColumn } from "../model/controlCatalog";
import { isEnabled, setEnabled } from "../model/autoplaceEnabled";
import { PLANET_ICONS, PLANET_LABELS } from "../model/planets";
import { RESOURCE_ICONS } from "../model/resourceIcons";
import { usePresetsStore } from "../store/presets";
import FPercentSlider from "../ui/FPercentSlider.vue";

const props = defineProps<{ name: string; columns: ControlColumn[] }>();
const store = usePresetsStore();

const entry = computed(() => CONTROL_CATALOG[props.name]);
const control = computed(() => store.activePreset?.autoplaceControls[props.name]);
const icon = computed(() => RESOURCE_ICONS[props.name]);

// Only a disable-able control consults its enabled state; always-on controls
// are always treated as enabled (and never gray) regardless of a stray size.
const enabled = computed(() =>
  entry.value?.canBeDisabled && control.value ? isEnabled(control.value) : true,
);

function onToggle(event: Event) {
  if (control.value) setEnabled(control.value, (event.target as HTMLInputElement).checked);
}
</script>
```

Update the label cell to add the gutter, and the slider cells to gray when disabled:

```html
    <td class="label">
      <span class="control-enable">
        <input
          v-if="entry.canBeDisabled"
          type="checkbox"
          data-test="control-enable"
          :checked="enabled"
          :aria-label="`Enable ${entry.label}`"
          @change="onToggle"
        />
      </span>
      <img
        v-if="icon"
        data-test="resource-icon"
        class="resource-icon"
        :src="icon"
        alt=""
        width="22"
        height="22"
      />
      {{ entry.label }}
    </td>
```

```html
    <td v-for="col in columns" :key="col.key" class="cell">
      <FPercentSlider v-model="control[col.key]" :disabled="entry.canBeDisabled && !enabled" />
    </td>
```

Add the gutter styles inside the `<style scoped>` block (e.g. after the `.resource-icon` rule):

```css
.control-enable {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  vertical-align: middle;
}

.control-enable input {
  width: 16px;
  height: 16px;
  accent-color: var(--f-orange);
  cursor: pointer;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vp test test/controlRow.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ControlRow.vue test/controlRow.spec.ts
git commit -m "feat(ui): enable/disable checkbox and slider graying in ControlRow"
```

---

### Task 5: Terrain-tab integration test

End-to-end through the real Terrain tab: unchecking Cliffs drives `nauvis_cliff.size` to 0 in `activeExchangeString`; re-checking restores it. Also confirms the mixed coverage table shows a checkbox on disable-able rows and only a spacer on always-on rows.

**Files:**
- Modify: `test/terrainTab.spec.ts` (append tests; imports already present)

**Interfaces:**
- Consumes: `TerrainTab` (renders `ControlRow` via `ControlTable`), `usePresetsStore`, `decodeExchangeString` - all already imported in this spec.

- [ ] **Step 1: Write the failing integration tests**

Append inside the existing `describe("TerrainTab", ...)` block in `test/terrainTab.spec.ts`:

```ts
  it("shows an enable checkbox on disable-able coverage rows but not always-on ones", () => {
    const wrapper = mountTab();
    const water = wrapper.find('[data-test="control-row-water"]');
    const volcanism = wrapper.find('[data-test="control-row-vulcanus_volcanism"]');
    expect(water.find('input[type="checkbox"]').exists()).toBe(true);
    expect(volcanism.find('input[type="checkbox"]').exists()).toBe(false);
    expect(volcanism.find(".control-enable").exists()).toBe(true);
  });

  it("unchecking Cliffs drives nauvis_cliff.size to 0 in the exchange string, re-checking restores it", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const cb = wrapper.find(
      '[data-test="control-row-nauvis_cliff"] input[type="checkbox"][data-test="control-enable"]',
    );
    expect(cb.exists()).toBe(true);

    await cb.setValue(false);
    let decoded = decodeExchangeString(store.activeExchangeString as string);
    expect(decoded.autoplaceControls["nauvis_cliff"]?.size).toBe(0);

    await cb.setValue(true);
    decoded = decodeExchangeString(store.activeExchangeString as string);
    expect(decoded.autoplaceControls["nauvis_cliff"]?.size).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm vp test test/terrainTab.spec.ts`
Expected: PASS (all existing tests plus the two new ones). Tasks 2-4 already implement the behavior, so these should pass immediately; if the checkbox is missing, the failure points back to `ControlRow`.

- [ ] **Step 3: Commit**

```bash
git add test/terrainTab.spec.ts
git commit -m "test(ui): terrain-tab cliff disable drives size 0 into exchange string"
```

---

### Task 6: Full-suite verification + lint

Confirm the whole suite is green and the tree is lint-clean.

**Files:** none (verification only).

- [ ] **Step 1: Run lint/format**

Run: `pnpm vp check --fix`
Expected: clean (no remaining errors). Review any auto-fixes.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm vp test`
Expected: all tests PASS, including the pre-existing codec round-trip suite (unchanged) and the new specs (`cliffDisable`, `catalog` additions, `autoplaceEnabled`, `controlRow`, `terrainTab` additions).

- [ ] **Step 3: Commit any lint fixups**

```bash
git add -A
git commit -m "chore: lint/format for disable-controls feature"
```

(Skip this commit if `vp check --fix` changed nothing.)

---

## Notes for the executor

- **Resources tab** is all disable-able and **Enemy tab** is all always-on, so both are covered by the shared `ControlRow` change without their own integration test; the Terrain coverage table is the only mixed one and is the alignment case worth testing (Task 5).
- **Grayed size slider cosmetics:** an `FPercentSlider` with `modelValue: 0` displays `"0%"` with the thumb clamped to the index-0 (17%) slot. This is a deliberate, accepted cosmetic (reads as "off"), not a bug - do not "fix" it.
- **Do not** edit anything under `src/codec/`, the `Preset` type, or add persistence. If a codec round-trip ever fails, that is a real finding - stop and report.

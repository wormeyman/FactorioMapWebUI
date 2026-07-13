# Editable Climate Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Terrain tab's Moisture and Terrain-type "climate control" rows fully editable and byte-exact with the Factorio 2.1.9 map generator GUI.

**Architecture:** These controls have no dedicated MapGenSettings structure; their values live purely in `property_expression_names` (`control:moisture:*`, `control:aux:*`), which the codec already round-trips byte-exact. So this is a model + UI wiring task with an unchanged codec. A generalized `StepScale` abstraction lets one slider widget serve both the percentage (Scale) notches and the bias (Bias) notches; a thin `climateControls` accessor reads/writes the two controls' keys on a preset's `propertyExpressionNames`, deleting a key when the value lands on its default notch.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), Pinia, `vite-plus/test` runner (`vp test`), `@vue/test-utils`.

## Global Constraints

- **Test runner.** Tests import from `"vite-plus/test"` (not `vitest`); run with `vp test`. Component tests use `@vue/test-utils`.
- **Wire number format.** Every climate value is `printf("%.6f")`, i.e. `value.toFixed(6)` (fixed 6 decimals, leading `-` for negatives).
- **Codec is unchanged.** Do not touch `src/codec/`. `decodeExchangeString` / `encodeExchangeString` already read/write `propertyExpressionNames` byte-exact in sorted key order.
- **No new persisted fields.** The `Preset` type and its stored shape are unchanged; climate values are derived views over the existing `propertyExpressionNames`.
- **Preserve existing exports.** `PERCENT_STEPS`, `stepValue`, `nearestStepIndex`, `formatPercent` in `controlScale.ts` stay exported and behaviorally unchanged (still used directly elsewhere).
- **Preserve `data-test` hooks.** The two climate rows keep `data-test="terrain-noise-moisture"` and `data-test="terrain-noise-terrain-type"`.
- **Default-omission rule.** Writing a value that snaps to the default notch (Scale 100% / Bias 0) must `delete` the key, so an edited-then-reset preset stays byte-identical to the game (whose Default dict is `{}`).
- **Non-mutating read.** Reading only snaps a slider for display; it never rewrites the dict. An off-notch imported string is preserved until the user actively moves that slider.

---

### Task 1: Generalize the step model (`StepScale`, `BIAS_SCALE`, `formatWire6`)

**Files:**
- Modify: `src/model/controlScale.ts` (append after the existing exports)
- Test: `test/controlScale.spec.ts` (append new `describe` blocks)

**Interfaces:**
- Consumes: existing `PERCENT_STEPS`, `stepValue`, `nearestStepIndex`, `formatPercent` (unchanged).
- Produces:
  - `interface StepScale { readonly count: number; nearestIndex(value: number): number; valueAt(index: number): number; format(value: number): string; readonly ariaLabel: string; }`
  - `const PERCENT_SCALE: StepScale` — the default; wraps the existing percentage helpers, `ariaLabel = "Percentage"`.
  - `const BIAS_SCALE: StepScale` — 21 uniform notches over `[-0.5, +0.5]` step `0.05`; `valueAt(i) = (i - 10) / 20`; `nearestIndex` by linear distance; `format` = signed 2-decimal (`"+0.05"`, `"-0.50"`, `"0.00"`); `ariaLabel = "Bias"`.
  - `function formatWire6(n: number): string` — `n.toFixed(6)`, the single wire formatter for all four values.

- [ ] **Step 1: Write the failing tests**

Append to `test/controlScale.spec.ts`. Extend the existing import line at the top of the file so it reads:

```ts
import {
  PERCENT_STEPS,
  stepValue,
  nearestStepIndex,
  formatPercent,
  PERCENT_SCALE,
  BIAS_SCALE,
  formatWire6,
} from "../src/model/controlScale";
```

Then append these blocks to the end of the file:

```ts
describe("formatWire6", () => {
  it("formats with fixed six decimals and a leading minus for negatives", () => {
    expect(formatWire6(0.5)).toBe("0.500000");
    expect(formatWire6(6)).toBe("6.000000");
    expect(formatWire6(-0.5)).toBe("-0.500000");
    expect(formatWire6(2 / 3)).toBe("0.666667");
  });
});

describe("PERCENT_SCALE", () => {
  it("has parity with the direct percentage helpers", () => {
    expect(PERCENT_SCALE.count).toBe(PERCENT_STEPS.length);
    expect(PERCENT_SCALE.ariaLabel).toBe("Percentage");
    for (const s of PERCENT_STEPS) {
      const idx = PERCENT_SCALE.nearestIndex(s.value);
      expect(idx).toBe(nearestStepIndex(s.value));
      expect(PERCENT_SCALE.valueAt(idx)).toBe(stepValue(idx));
      expect(PERCENT_SCALE.format(s.value)).toBe(formatPercent(s.value));
    }
  });
});

describe("BIAS_SCALE", () => {
  it("has 21 uniform notches from -0.5 to +0.5", () => {
    expect(BIAS_SCALE.count).toBe(21);
    expect(BIAS_SCALE.ariaLabel).toBe("Bias");
    expect(BIAS_SCALE.valueAt(0)).toBeCloseTo(-0.5, 10);
    expect(BIAS_SCALE.valueAt(10)).toBe(0);
    expect(BIAS_SCALE.valueAt(11)).toBeCloseTo(0.05, 10);
    expect(BIAS_SCALE.valueAt(20)).toBeCloseTo(0.5, 10);
  });

  it("clamps out-of-range indices", () => {
    expect(BIAS_SCALE.valueAt(-3)).toBe(BIAS_SCALE.valueAt(0));
    expect(BIAS_SCALE.valueAt(99)).toBe(BIAS_SCALE.valueAt(20));
  });

  it("finds the nearest notch by linear distance and clamps", () => {
    expect(BIAS_SCALE.nearestIndex(0)).toBe(10);
    expect(BIAS_SCALE.nearestIndex(0.05)).toBe(11);
    expect(BIAS_SCALE.nearestIndex(-0.5)).toBe(0);
    expect(BIAS_SCALE.nearestIndex(0.07)).toBe(11);
    expect(BIAS_SCALE.nearestIndex(2)).toBe(20);
  });

  it("formats signed two-decimal labels", () => {
    expect(BIAS_SCALE.format(0)).toBe("0.00");
    expect(BIAS_SCALE.format(0.05)).toBe("+0.05");
    expect(BIAS_SCALE.format(-0.5)).toBe("-0.50");
    expect(BIAS_SCALE.format(0.45)).toBe("+0.45");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test test/controlScale.spec.ts`
Expected: FAIL — `PERCENT_SCALE`, `BIAS_SCALE`, `formatWire6` are not exported (import error / undefined).

- [ ] **Step 3: Implement the additions**

Append to `src/model/controlScale.ts` (after `formatPercent`):

```ts
/**
 * A discrete slider scale: a fixed set of notches with a nearest-notch snap,
 * a display formatter, and an aria-label. Lets one slider widget serve both
 * the geometric percentage steps and the uniform bias steps.
 */
export interface StepScale {
  /** Number of notches (input range is 0..count-1). */
  readonly count: number;
  /** Index of the notch nearest to a raw value. */
  nearestIndex(value: number): number;
  /** Raw value at a notch index (clamped to range). */
  valueAt(index: number): number;
  /** Human label for a value, e.g. "150%" or "+0.05". */
  format(value: number): string;
  /** aria-label for the range input. */
  readonly ariaLabel: string;
}

/** The 12 geometric percentage notches; the widget's default scale. */
export const PERCENT_SCALE: StepScale = {
  count: PERCENT_STEPS.length,
  nearestIndex: nearestStepIndex,
  valueAt: stepValue,
  format: formatPercent,
  ariaLabel: "Percentage",
};

const BIAS_COUNT = 21;
const BIAS_STEP = 0.05;

/** The 21 uniform bias notches: -0.50, -0.45, ..., 0, ..., +0.45, +0.50. */
export const BIAS_SCALE: StepScale = {
  count: BIAS_COUNT,
  nearestIndex(value: number): number {
    const i = Math.round(value / BIAS_STEP) + 10;
    return Math.min(BIAS_COUNT - 1, Math.max(0, i));
  },
  valueAt(index: number): number {
    const i = Math.min(BIAS_COUNT - 1, Math.max(0, Math.round(index)));
    return (i - 10) / 20;
  },
  format(value: number): string {
    const fixed = value.toFixed(2);
    return value > 0 ? `+${fixed}` : fixed;
  },
  ariaLabel: "Bias",
};

/** The single wire formatter for all climate values: fixed 6 decimals. */
export function formatWire6(n: number): string {
  return n.toFixed(6);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test test/controlScale.spec.ts`
Expected: PASS (all blocks, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/model/controlScale.ts test/controlScale.spec.ts
git commit -m "feat(model): add StepScale, BIAS_SCALE, and formatWire6 for climate sliders"
```

---

### Task 2: Climate-control accessor (`src/model/climateControls.ts`)

**Files:**
- Create: `src/model/climateControls.ts`
- Test: `test/climateControls.spec.ts`

**Interfaces:**
- Consumes: `PERCENT_SCALE`, `BIAS_SCALE`, `formatWire6` from `./controlScale` (Task 1).
- Produces:
  - `interface ClimateControl { readonly freqKey: string; readonly biasKey: string; }`
  - `const MOISTURE: ClimateControl` — keys `control:moisture:frequency` / `control:moisture:bias`.
  - `const TERRAIN_TYPE: ClimateControl` — keys `control:aux:frequency` / `control:aux:bias`.
  - `function readScale(pen: Record<string,string>, c: ClimateControl): number` — scale multiplier (`1 / frequency`), default `1`.
  - `function writeScale(pen: Record<string,string>, c: ClimateControl, scaleMultiplier: number): void` — snap to nearest percent notch; delete the freq key at 100%, else set `formatWire6(1 / snapped)`.
  - `function readBias(pen: Record<string,string>, c: ClimateControl): number` — the stored bias, default `0`.
  - `function writeBias(pen: Record<string,string>, c: ClimateControl, bias: number): void` — snap to nearest bias notch; delete the bias key at 0, else set `formatWire6(snapped)`.

- [ ] **Step 1: Write the failing tests**

Create `test/climateControls.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  MOISTURE,
  TERRAIN_TYPE,
  readBias,
  readScale,
  writeBias,
  writeScale,
} from "../src/model/climateControls";

describe("readScale / writeScale", () => {
  it("defaults to multiplier 1 when the freq key is absent", () => {
    expect(readScale({}, MOISTURE)).toBe(1);
  });

  it("inverts the stored frequency into a scale multiplier", () => {
    expect(readScale({ "control:moisture:frequency": "0.666667" }, MOISTURE)).toBeCloseTo(1.5, 4);
    expect(readScale({ "control:moisture:frequency": "6.000000" }, MOISTURE)).toBeCloseTo(1 / 6, 4);
  });

  it("writes 150% as the inverse frequency string", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, MOISTURE, Math.fround(3 / 2));
    expect(pen["control:moisture:frequency"]).toBe("0.666667");
  });

  it("writes 600% as 0.166667", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, MOISTURE, Math.fround(6));
    expect(pen["control:moisture:frequency"]).toBe("0.166667");
  });

  it("deletes the freq key when writing the default 100% notch", () => {
    const pen: Record<string, string> = { "control:moisture:frequency": "0.500000" };
    writeScale(pen, MOISTURE, 1);
    expect("control:moisture:frequency" in pen).toBe(false);
  });

  it("uses the aux keys for terrain type", () => {
    const pen: Record<string, string> = {};
    writeScale(pen, TERRAIN_TYPE, Math.fround(6));
    expect(pen["control:aux:frequency"]).toBe("0.166667");
  });

  it("reads an off-notch imported frequency without rewriting it (non-mutating)", () => {
    const pen: Record<string, string> = { "control:moisture:frequency": "5" };
    expect(readScale(pen, MOISTURE)).toBeCloseTo(0.2, 6);
    expect(pen["control:moisture:frequency"]).toBe("5");
  });
});

describe("readBias / writeBias", () => {
  it("defaults to 0 when the bias key is absent", () => {
    expect(readBias({}, MOISTURE)).toBe(0);
  });

  it("reads the stored bias directly", () => {
    expect(readBias({ "control:moisture:bias": "0.500000" }, MOISTURE)).toBe(0.5);
    expect(readBias({ "control:moisture:bias": "-0.500000" }, MOISTURE)).toBe(-0.5);
  });

  it("writes a bias notch as a fixed-6 string", () => {
    const pen: Record<string, string> = {};
    writeBias(pen, MOISTURE, 0.05);
    expect(pen["control:moisture:bias"]).toBe("0.050000");
  });

  it("writes +0.50 and -0.50 on the aux key", () => {
    const pen: Record<string, string> = {};
    writeBias(pen, TERRAIN_TYPE, 0.5);
    expect(pen["control:aux:bias"]).toBe("0.500000");
    writeBias(pen, TERRAIN_TYPE, -0.5);
    expect(pen["control:aux:bias"]).toBe("-0.500000");
  });

  it("deletes the bias key when writing the default 0 notch", () => {
    const pen: Record<string, string> = { "control:moisture:bias": "0.500000" };
    writeBias(pen, MOISTURE, 0);
    expect("control:moisture:bias" in pen).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test test/climateControls.spec.ts`
Expected: FAIL — module `../src/model/climateControls` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/model/climateControls.ts`:

```ts
import { BIAS_SCALE, PERCENT_SCALE, formatWire6 } from "./controlScale";

/**
 * A Factorio "climate control." Unlike autoplace controls, these have no
 * dedicated MapGenSettings floats; their Scale and Bias live purely as
 * `property_expression_names` overrides. `aux` (terrain type) encodes
 * identically to `moisture` (confirmed against in-game captures).
 */
export interface ClimateControl {
  readonly freqKey: string;
  readonly biasKey: string;
}

export const MOISTURE: ClimateControl = {
  freqKey: "control:moisture:frequency",
  biasKey: "control:moisture:bias",
};

export const TERRAIN_TYPE: ClimateControl = {
  freqKey: "control:aux:frequency",
  biasKey: "control:aux:bias",
};

type Pen = Record<string, string>;

/**
 * Scale multiplier shown by the GUI. The wire stores frequency (the inverse),
 * so scale = 1 / frequency. Absent key => default multiplier 1 (100%).
 * Non-mutating: an off-notch stored string is read but never rewritten.
 */
export function readScale(pen: Pen, c: ClimateControl): number {
  return 1 / Number(pen[c.freqKey] ?? "1");
}

/**
 * Snap to the nearest percent notch and store its inverse frequency. Landing
 * on the default 100% notch deletes the key (matching the game's empty dict).
 */
export function writeScale(pen: Pen, c: ClimateControl, scaleMultiplier: number): void {
  const snapped = PERCENT_SCALE.valueAt(PERCENT_SCALE.nearestIndex(scaleMultiplier));
  if (snapped === 1) {
    delete pen[c.freqKey];
  } else {
    pen[c.freqKey] = formatWire6(1 / snapped);
  }
}

/** Stored bias, read directly. Absent key => default 0. Non-mutating. */
export function readBias(pen: Pen, c: ClimateControl): number {
  return Number(pen[c.biasKey] ?? "0");
}

/**
 * Snap to the nearest bias notch and store it. Landing on the default 0 notch
 * deletes the key.
 */
export function writeBias(pen: Pen, c: ClimateControl, bias: number): void {
  const snapped = BIAS_SCALE.valueAt(BIAS_SCALE.nearestIndex(bias));
  if (snapped === 0) {
    delete pen[c.biasKey];
  } else {
    pen[c.biasKey] = formatWire6(snapped);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test test/climateControls.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/model/climateControls.ts test/climateControls.spec.ts
git commit -m "feat(model): climate-control accessor over property_expression_names"
```

---

### Task 3: `FPercentSlider.vue` accepts a `StepScale`

**Files:**
- Modify: `src/ui/FPercentSlider.vue`
- Test: `test/fPercentSlider.spec.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `StepScale`, `PERCENT_SCALE`, `BIAS_SCALE` from `../model/controlScale`.
- Produces: `FPercentSlider` gains an optional `scale?: StepScale` prop defaulting to `PERCENT_SCALE`. All notch/label/aria behavior now routes through `props.scale`. Existing call sites that pass no `scale` behave exactly as before.

- [ ] **Step 1: Write the failing tests**

Append to `test/fPercentSlider.spec.ts`. First extend the imports at the top of the file to add `BIAS_SCALE`:

```ts
import { BIAS_SCALE } from "../src/model/controlScale";
```

Then append this block to the end of the file:

```ts
describe("FPercentSlider with a custom scale", () => {
  it("renders bias notches, label, and aria-label", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 0.05, scale: BIAS_SCALE } });
    const input = w.find("input");
    expect(input.attributes("max")).toBe("20"); // 21 notches
    expect((input.element as HTMLInputElement).value).toBe("11"); // +0.05 is index 11
    expect(input.attributes("aria-valuetext")).toBe("+0.05");
    expect(input.attributes("aria-label")).toBe("Bias");
    expect(w.text()).toContain("+0.05");
  });

  it("emits the bias notch value on input", async () => {
    const w = mount(FPercentSlider, { props: { modelValue: 0, scale: BIAS_SCALE } });
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "0"; // -0.50
    await input.trigger("input");
    expect(w.emitted("update:modelValue")?.[0]?.[0]).toBeCloseTo(-0.5, 10);
  });

  it("keeps the percentage aria-label by default", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    expect(w.find("input").attributes("aria-label")).toBe("Percentage");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test test/fPercentSlider.spec.ts`
Expected: FAIL — the `scale` prop is ignored, so `max` stays `"11"`, the label/aria come from the percentage helpers, and `BIAS_SCALE` is treated as unused.

- [ ] **Step 3: Rewrite the component**

Replace the `<script setup>` block and the `<input>` element in `src/ui/FPercentSlider.vue`. New `<script setup>`:

```ts
<script setup lang="ts">
import { computed } from "vue";
import { PERCENT_SCALE, type StepScale } from "../model/controlScale";

const props = withDefaults(
  defineProps<{ modelValue: number; disabled?: boolean; scale?: StepScale }>(),
  { disabled: false, scale: () => PERCENT_SCALE },
);
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const index = computed(() => props.scale.nearestIndex(props.modelValue));
const label = computed(() => props.scale.format(props.modelValue));

function onInput(event: Event) {
  emit("update:modelValue", props.scale.valueAt(Number((event.target as HTMLInputElement).value)));
}
</script>
```

New `<input>` (inside the existing `<template>`, replacing the current one — the two changed attributes are `:max` and `:aria-label`):

```html
    <input
      class="f-percent-slider"
      type="range"
      min="0"
      :max="props.scale.count - 1"
      step="1"
      :value="index"
      :disabled="disabled"
      :aria-valuetext="label"
      :aria-label="props.scale.ariaLabel"
      @input="onInput"
    />
```

Then widen the label so signed bias values like `+0.05` fit. In the `<style scoped>` block, change `.f-percent-label`'s `min-width` from `34px` to `40px`:

```css
.f-percent-label {
  min-width: 40px;
  font-size: 12px;
  color: var(--f-text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test test/fPercentSlider.spec.ts`
Expected: PASS — both the new bias block and the pre-existing percentage tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/FPercentSlider.vue test/fPercentSlider.spec.ts
git commit -m "feat(ui): FPercentSlider accepts a StepScale (percent or bias)"
```

---

### Task 4: `TerrainTab.vue` live climate rows + driving test

**Files:**
- Modify: `src/components/TerrainTab.vue`
- Test: `test/terrainTab.spec.ts` (replace the inert-rows test; add live-rows + driving tests)

**Interfaces:**
- Consumes: `MOISTURE`, `TERRAIN_TYPE`, `readScale`, `writeScale`, `readBias`, `writeBias` (Task 2); `BIAS_SCALE` (Task 1); `FPercentSlider` with its `scale` prop (Task 3); `PLANET_ICONS`, `PLANET_LABELS` from `../model/planets`; `usePresetsStore` from `../store/presets`.
- Produces: the `terrain-noise-table` now renders two editable rows (Moisture, Terrain type), each with an "Appears on" Nauvis icon cell, a Scale slider, and a Bias slider, all bound to the active preset's `propertyExpressionNames` through the accessor. The `terrain-noise-moisture` / `terrain-noise-terrain-type` hooks are preserved.

- [ ] **Step 1: Update the tests**

In `test/terrainTab.spec.ts`, add `beforeEach` to the imports and clear storage so the store seeds the default preset. Replace the import line and add a `beforeEach` inside the `describe`:

Change the top import to:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import TerrainTab from "../src/components/TerrainTab.vue";
import { usePresetsStore } from "../src/store/presets";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
```

Add, as the first line inside `describe("TerrainTab", () => {`:

```ts
  beforeEach(() => {
    localStorage.clear();
  });
```

Then **delete** the existing test named `"renders inert Moisture and Terrain type noise rows with disabled sliders"` (it asserts disabled sliders, which no longer holds) and replace it with:

```ts
  it("renders live Moisture and Terrain type rows with enabled Scale and Bias sliders", () => {
    const wrapper = mountTab();
    for (const row of ["terrain-noise-moisture", "terrain-noise-terrain-type"]) {
      const el = wrapper.find(`[data-test="${row}"]`);
      expect(el.exists(), row).toBe(true);
      const sliders = el.findAll('input[type="range"]');
      expect(sliders.length, row).toBe(2);
      expect(sliders.every((s) => !(s.element as HTMLInputElement).disabled), row).toBe(true);
    }
  });

  it('gives each climate row an "Appears on" Nauvis icon', () => {
    const wrapper = mountTab();
    const cols = headers(wrapper, "terrain-noise-table");
    expect(cols).toContain("Appears on");
    for (const row of ["terrain-noise-moisture", "terrain-noise-terrain-type"]) {
      const icon = wrapper.find(`[data-test="${row}"] img[data-test="appears-on"]`);
      expect(icon.exists(), row).toBe(true);
      expect(icon.attributes("alt"), row).toBe("Nauvis");
    }
  });

  it("drives Moisture Scale 150% + Bias +0.05 into the exchange string byte-exact", async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    const store = usePresetsStore();
    const wrapper = mount(TerrainTab);
    const row = wrapper.find('[data-test="terrain-noise-moisture"]');
    const sliders = row.findAll('input[type="range"]');
    await sliders[0]?.setValue("7"); // Scale notch 7 = 150%
    await sliders[1]?.setValue("11"); // Bias notch 11 = +0.05

    const pen = decodeExchangeString(store.activeExchangeString as string).propertyExpressionNames;
    expect(pen["control:moisture:frequency"]).toBe("0.666667");
    expect(pen["control:moisture:bias"]).toBe("0.050000");
  });
```

> Note: `mountTab()` already calls `setActivePinia(createPinia())`, so its store resolves to the default seeded preset. The driving test re-establishes the same active pinia so `usePresetsStore()` and the mounted component share one store instance.

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test test/terrainTab.spec.ts`
Expected: FAIL — the current `TerrainTab` renders disabled `FSlider`s with no "Appears on" column and no store binding.

- [ ] **Step 3: Rewrite `TerrainTab.vue`**

Replace the `<script setup>` block. Remove the `FSlider` import and the `NOISE_ROWS` constant; add the store, accessor, planet, and slider imports plus the four bound computeds:

```ts
<script setup lang="ts">
import { computed } from "vue";
import { type ControlColumn, controlsForTerrainGroup } from "../model/controlCatalog";
import {
  type ClimateControl,
  MOISTURE,
  TERRAIN_TYPE,
  readBias,
  readScale,
  writeBias,
  writeScale,
} from "../model/climateControls";
import { BIAS_SCALE } from "../model/controlScale";
import { PLANET_ICONS, PLANET_LABELS } from "../model/planets";
import { usePresetsStore } from "../store/presets";
import FDropdown from "../ui/FDropdown.vue";
import FPercentSlider from "../ui/FPercentSlider.vue";
import ControlTable from "./ControlTable.vue";

const COVERAGE_COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Scale" },
  { key: "size", label: "Coverage" },
];

const CLIFF_COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Continuity" },
];

// Map type is a fixed placeholder until elevation presets are decoded.
const MAP_TYPE_OPTIONS = [{ value: "nauvis", label: "Nauvis elevation (Default)" }];

const store = usePresetsStore();

// Scale/Bias sliders bind through the climate accessor to the active preset's
// property_expression_names. Mutating that dict in place flows into
// activeExchangeString via the same reactive path as autoplace ControlRows.
function scaleModel(c: ClimateControl) {
  return computed({
    get: () => {
      const pen = store.activePreset?.propertyExpressionNames;
      return pen ? readScale(pen, c) : 1;
    },
    set: (v: number) => {
      const pen = store.activePreset?.propertyExpressionNames;
      if (pen) writeScale(pen, c, v);
    },
  });
}

function biasModel(c: ClimateControl) {
  return computed({
    get: () => {
      const pen = store.activePreset?.propertyExpressionNames;
      return pen ? readBias(pen, c) : 0;
    },
    set: (v: number) => {
      const pen = store.activePreset?.propertyExpressionNames;
      if (pen) writeBias(pen, c, v);
    },
  });
}

const moistureScale = scaleModel(MOISTURE);
const moistureBias = biasModel(MOISTURE);
const auxScale = scaleModel(TERRAIN_TYPE);
const auxBias = biasModel(TERRAIN_TYPE);
</script>
```

Replace the `terrain-noise-table` `<section>` in the `<template>` (keep the two `<section>`s above it unchanged). Both climate controls are Nauvis-only, so every row carries a Nauvis "Appears on" cell and the whole tab now reads consistently:

```html
  <section data-test="terrain-noise-table">
    <table class="control-table">
      <thead>
        <tr>
          <th>Setting</th>
          <th class="appears-on-th">Appears on</th>
          <th>Scale</th>
          <th>Bias</th>
        </tr>
      </thead>
      <tbody>
        <tr data-test="terrain-noise-moisture">
          <td class="label">Moisture</td>
          <td class="appears-on">
            <img
              data-test="appears-on"
              class="planet-icon"
              :src="PLANET_ICONS.nauvis"
              :alt="PLANET_LABELS.nauvis"
              :title="PLANET_LABELS.nauvis"
              width="24"
              height="24"
            />
          </td>
          <td class="cell"><FPercentSlider v-model="moistureScale" /></td>
          <td class="cell"><FPercentSlider v-model="moistureBias" :scale="BIAS_SCALE" /></td>
        </tr>
        <tr data-test="terrain-noise-terrain-type">
          <td class="label">Terrain type</td>
          <td class="appears-on">
            <img
              data-test="appears-on"
              class="planet-icon"
              :src="PLANET_ICONS.nauvis"
              :alt="PLANET_LABELS.nauvis"
              :title="PLANET_LABELS.nauvis"
              width="24"
              height="24"
            />
          </td>
          <td class="cell"><FPercentSlider v-model="auxScale" /></td>
          <td class="cell"><FPercentSlider v-model="auxBias" :scale="BIAS_SCALE" /></td>
        </tr>
      </tbody>
    </table>
  </section>
```

In `<style scoped>`, remove the now-unused `.note` rule and add the "Appears on" column styles (mirroring `ControlTable`/`ControlRow`). Replace the `.note { ... }` block with:

```css
.control-table th.appears-on-th {
  text-align: center;
}

.appears-on {
  padding: 6px 8px;
  text-align: center;
  width: 1%;
  white-space: nowrap;
}

.planet-icon {
  display: block;
  margin: 0 auto;
  vertical-align: middle;
}
```

- [ ] **Step 4: Run the terrain and full suites to verify they pass**

Run: `vp test test/terrainTab.spec.ts test/app.spec.ts`
Expected: PASS. (`app.spec.ts` is included because `TerrainTab` now reads the store; confirm nothing regressed in the mounted-App tests.)

- [ ] **Step 5: Commit**

```bash
git add src/components/TerrainTab.vue test/terrainTab.spec.ts
git commit -m "feat(ui): editable Moisture and Terrain-type climate rows on the Terrain tab"
```

---

### Task 5: Codec round-trip fixtures for the 8 in-game captures

**Files:**
- Create: `test/climateFixtures.spec.ts`
- Reference (read-only, in place): `docs/mapexchangestrings/climate-*.txt` (the 8 captures)

**Interfaces:**
- Consumes: `decodeExchangeString`, `encodeExchangeString` from `../src/codec/mapExchangeString`; the committed capture `.txt` files.
- Produces: a regression suite proving each capture re-encodes byte-for-byte and decodes to its documented `property_expression_names` (catching any future `aux`-vs-`moisture` drift for free).

- [ ] **Step 1: Write the failing test**

Create `test/climateFixtures.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodeExchangeString } from "../src/codec/mapExchangeString";

const DIR = "docs/mapexchangestrings";

// [file, expected property_expression_names] — the 8 confirmed captures
// (seed 123456, Default Nauvis preset), one or two sliders changed each.
const CAPTURES: [file: string, pen: Record<string, string>][] = [
  ["climate-moisture-scale600.txt", { "control:moisture:frequency": "0.166667" }],
  ["climate-moisture-scale150.txt", { "control:moisture:frequency": "0.666667" }],
  ["climate-moisture-scale17.txt", { "control:moisture:frequency": "6.000000" }],
  ["climate-moisture-bias+0.50.txt", { "control:moisture:bias": "0.500000" }],
  ["climate-moisture-bias-0.50.txt", { "control:moisture:bias": "-0.500000" }],
  ["climate-moisture-bias+0.05.txt", { "control:moisture:bias": "0.050000" }],
  [
    "climate-moisture-scale600-bias+0.50.txt",
    { "control:moisture:bias": "0.500000", "control:moisture:frequency": "0.166667" },
  ],
  [
    "climate-terrain-scale600-bias+0.50.txt",
    { "control:aux:bias": "0.500000", "control:aux:frequency": "0.166667" },
  ],
];

describe("climate control captures", () => {
  it.each(CAPTURES)("re-emits %s byte-for-byte", (file) => {
    const original = readFileSync(`${DIR}/${file}`, "utf8").trim();
    expect(encodeExchangeString(decodeExchangeString(original))).toBe(original);
  });

  it.each(CAPTURES)("decodes the documented property_expression_names in %s", (file, expected) => {
    const original = readFileSync(`${DIR}/${file}`, "utf8").trim();
    const pen = decodeExchangeString(original).propertyExpressionNames;
    for (const [k, v] of Object.entries(expected)) {
      expect(pen[k]).toBe(v);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `vp test test/climateFixtures.spec.ts`
Expected: PASS immediately — the codec is unchanged, so this documents/locks existing behavior. (If any case fails, that is a real finding about the capture files or key names — investigate before proceeding, do not edit the expected values to match.)

- [ ] **Step 3: (No implementation needed — codec is unchanged.)**

This task is a pure regression/fixture task; there is no production code to write.

- [ ] **Step 4: Run the whole suite to confirm nothing else regressed**

Run: `vp test`
Expected: PASS (all specs).

- [ ] **Step 5: Commit**

```bash
git add test/climateFixtures.spec.ts
git commit -m "test: round-trip the 8 in-game climate-control captures"
```

---

## Self-Review

**Spec coverage:**
- Wire keys (moisture / aux, freq / bias) — Task 2 (`MOISTURE`, `TERRAIN_TYPE`).
- `%.6f` number format — Task 1 (`formatWire6`), used in Task 2.
- Scale inversion + 12 notches — Task 1 (`PERCENT_SCALE`) + Task 2 (`readScale`/`writeScale`); notch table validated in Task 2 + Task 5.
- Bias 21 notches, direct storage — Task 1 (`BIAS_SCALE`) + Task 2 (`readBias`/`writeBias`).
- Default-omission rule — Task 2 (delete-on-default tests).
- Non-mutating read — Task 2 (off-notch import test).
- Codec unchanged / byte-exact — Task 5 (round-trip fixtures).
- `StepScale` generalization — Task 1; `FPercentSlider` accepts it — Task 3.
- Live TerrainTab rows with "Appears on" Nauvis cell, preserved `data-test` hooks — Task 4.
- App-level drive → decoded `propertyExpressionNames` equals captures — Task 4 (driving test).
- Out of scope (Map type dropdown, Preset type, persistence) — untouched; Task 4 leaves the disabled `FDropdown` in place.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every step carries full code.

**Type consistency:** `StepScale` members (`count`, `nearestIndex`, `valueAt`, `format`, `ariaLabel`) are used identically in Tasks 1, 3. `ClimateControl` (`freqKey`, `biasKey`) and the four accessor functions keep the same signatures across Tasks 2 and 4. `propertyExpressionNames` matches the confirmed field name on both `Preset` and `DecodedExchange`. Slider notch indices used in Task 4's driving test (Scale 150% = index 7, Bias +0.05 = index 11) match the notch definitions in Task 1.

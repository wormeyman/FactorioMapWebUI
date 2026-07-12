# Percentage Control Sliders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the continuous multiplier sliders on the control tables with discrete percentage sliders that snap to Factorio's twelve steps (17%-600%), and move the starting-area size control onto the Enemy tab.

**Architecture:** A new pure model module `controlScale.ts` holds the twelve steps (float32 values + percent labels) and index/value helpers. A new `FPercentSlider.vue` renders an index-domain range input that snaps to those steps and shows a percent label. `ControlRow` swaps its `FSlider` + `FNumberInput` pair for one `FPercentSlider`; the Enemy tab gains a starting-area row; the Advanced tab loses it.

**Tech Stack:** Vue 3 + TypeScript + `vite-plus` (`vp`); tests in `vite-plus/test` run with `pnpm test`.

## Global Constraints

- **Package manager:** pnpm. Run the app test suite with `pnpm test` at repo root.
- **Test runner:** import from `vite-plus/test` (never add vitest to the app).
- **Byte-exact codec:** the multipliers and `startingArea` are float32. Every step value is `Math.fround(fraction)`, so storing them keeps re-emitted exchange strings byte-identical. Do not change the codec.
- **Writing style:** hyphens (`-`), never em/en dashes, in all files and commit messages.
- **Commits:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV
  ```
- **Do NOT delete `FSlider.vue`:** it is still used by `TerrainTab.vue` (disabled noise rows) and `test/ui-kit.spec.ts`. Only remove its use from `ControlRow.vue`.

## The twelve steps (reference)

| index | fraction | value (`Math.fround`) | percent |
| --- | --- | --- | --- |
| 0 | 1/6 | 0.1666666716337204 | 17 |
| 1 | 1/4 | 0.25 | 25 |
| 2 | 1/3 | 0.3333333432674408 | 33 |
| 3 | 1/2 | 0.5 | 50 |
| 4 | 3/4 | 0.75 | 75 |
| 5 | 1 | 1 | 100 |
| 6 | 4/3 | 1.3333333730697632 | 133 |
| 7 | 3/2 | 1.5 | 150 |
| 8 | 2 | 2 | 200 |
| 9 | 3 | 3 | 300 |
| 10 | 4 | 4 | 400 |
| 11 | 6 | 6 | 600 |

---

## File Structure

```
src/
  model/controlScale.ts        (new: steps + stepValue/nearestStepIndex/formatPercent)
  ui/FPercentSlider.vue         (new: index-domain range slider + percent label)
  components/
    ControlRow.vue              (modify: FSlider+FNumberInput -> FPercentSlider)
    EnemyTab.vue                (modify: add starting-area row)
    AdvancedTab.vue             (modify: remove starting-area field)
test/
  controlScale.spec.ts          (new)
  fPercentSlider.spec.ts        (new)
  resourceEnemyTabs.spec.ts     (modify: add EnemyTab starting-area test)
  advancedTab.spec.ts           (modify: remove starting-area test)
```

Shared interface used by every consumer:

```ts
// src/model/controlScale.ts
export interface PercentStep { value: number; percent: number }
export const PERCENT_STEPS: readonly PercentStep[];   // 12 steps, ascending
export function stepValue(index: number): number;     // clamped step value
export function nearestStepIndex(value: number): number; // log-ratio nearest, tie -> higher, <=0 -> 0
export function formatPercent(value: number): string; // `${Math.round(value*100)}%`
```

---

## Task 1: `controlScale.ts` model

**Files:**
- Create: `src/model/controlScale.ts`
- Test: `test/controlScale.spec.ts`

**Interfaces:**
- Produces: `PERCENT_STEPS`, `stepValue`, `nearestStepIndex`, `formatPercent` (signatures above).

- [ ] **Step 1: Write the failing test**

`test/controlScale.spec.ts`:
```ts
import { describe, it, expect } from "vite-plus/test";
import { PERCENT_STEPS, stepValue, nearestStepIndex, formatPercent } from "../src/model/controlScale";

describe("PERCENT_STEPS", () => {
  it("has the twelve Factorio percentages in order", () => {
    expect(PERCENT_STEPS.map((s) => s.percent)).toEqual([
      17, 25, 33, 50, 75, 100, 133, 150, 200, 300, 400, 600,
    ]);
  });

  it("stores exact float32 step values", () => {
    expect(PERCENT_STEPS[2].value).toBe(Math.fround(1 / 3)); // 0.3333333432674408
    expect(PERCENT_STEPS[6].value).toBe(Math.fround(4 / 3)); // 1.3333333730697632
    expect(PERCENT_STEPS[5].value).toBe(1);
    expect(PERCENT_STEPS[11].value).toBe(6);
  });
});

describe("stepValue / nearestStepIndex", () => {
  it("round-trips every on-scale value", () => {
    for (const s of PERCENT_STEPS) {
      expect(stepValue(nearestStepIndex(s.value))).toBe(s.value);
    }
  });

  it("clamps the index in stepValue", () => {
    expect(stepValue(-3)).toBe(PERCENT_STEPS[0].value);
    expect(stepValue(99)).toBe(PERCENT_STEPS[11].value);
  });

  it("uses log-ratio distance for off-scale values", () => {
    expect(nearestStepIndex(5)).toBe(11); // 500%: closer to 600% than 400% in log space
    expect(nearestStepIndex(0.6)).toBe(3); // 60%: closer to 50% than 75%
    expect(nearestStepIndex(1000)).toBe(11);
    expect(nearestStepIndex(0)).toBe(0);
    expect(nearestStepIndex(-5)).toBe(0);
  });

  it("breaks ties toward the higher step", () => {
    const tie = Math.sqrt(stepValue(5) * stepValue(6)); // geo mean of 100% and 133%
    expect(nearestStepIndex(tie)).toBe(6);
  });
});

describe("formatPercent", () => {
  it("formats the true percentage of any value", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(Math.fround(1 / 6))).toBe("17%");
    expect(formatPercent(5)).toBe("500%");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test controlScale`
Expected: FAIL - cannot resolve `../src/model/controlScale`.

- [ ] **Step 3: Write the implementation**

`src/model/controlScale.ts`:
```ts
/**
 * Factorio's discrete frequency / size / richness (and starting-area) scale.
 * Stored as float32 in the map-exchange string, so each step is Math.fround of
 * an exact fraction; storing these keeps re-emitted strings byte-identical.
 */
const FRACTIONS = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4, 6];

export interface PercentStep {
  /** The float32 multiplier stored in the exchange string. */
  value: number;
  /** The display percentage, e.g. 17, 100, 600. */
  percent: number;
}

export const PERCENT_STEPS: readonly PercentStep[] = FRACTIONS.map((f) => {
  const value = Math.fround(f);
  return { value, percent: Math.round(value * 100) };
});

export function stepValue(index: number): number {
  const i = Math.min(PERCENT_STEPS.length - 1, Math.max(0, Math.round(index)));
  return PERCENT_STEPS[i].value;
}

/**
 * Index of the closest step to `value`, measured by log-ratio distance (the
 * scale is geometric). Ties resolve to the higher step (via `<=`); a
 * non-positive value clamps to index 0.
 */
export function nearestStepIndex(value: number): number {
  if (!(value > 0)) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PERCENT_STEPS.length; i++) {
    const dist = Math.abs(Math.log(value / PERCENT_STEPS[i].value));
    if (dist <= bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test controlScale`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/controlScale.ts test/controlScale.spec.ts
git commit -m "feat(ui): percentage control scale model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV"
```

---

## Task 2: `FPercentSlider.vue`

**Files:**
- Create: `src/ui/FPercentSlider.vue`
- Test: `test/fPercentSlider.spec.ts`

**Interfaces:**
- Consumes: `PERCENT_STEPS`, `stepValue`, `nearestStepIndex`, `formatPercent` (Task 1).
- Produces: `FPercentSlider` with prop `modelValue: number` (and optional `disabled`), emitting `update:modelValue` with a snapped step value.

- [ ] **Step 1: Write the failing test**

`test/fPercentSlider.spec.ts`:
```ts
import { describe, it, expect } from "vite-plus/test";
import { mount } from "@vue/test-utils";
import FPercentSlider from "../src/ui/FPercentSlider.vue";

describe("FPercentSlider", () => {
  it("positions the thumb and label for an on-scale value", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("5"); // 100% is index 5
    expect(input.attributes("aria-valuetext")).toBe("100%");
    expect(w.text()).toContain("100%");
  });

  it("emits the exact step float on input", async () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1 } });
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "8"; // 200%
    await input.trigger("input");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([2]);
  });

  it("shows an off-scale value's true percent at the nearest notch", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 5 } });
    const input = w.find("input");
    expect(w.text()).toContain("500%");
    expect((input.element as HTMLInputElement).value).toBe("11");
  });

  it("respects disabled", () => {
    const w = mount(FPercentSlider, { props: { modelValue: 1, disabled: true } });
    expect((w.find("input").element as HTMLInputElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test fPercentSlider`
Expected: FAIL - cannot resolve `../src/ui/FPercentSlider.vue`.

- [ ] **Step 3: Write the implementation**

`src/ui/FPercentSlider.vue`:
```vue
<script setup lang="ts">
import { computed } from "vue";
import { PERCENT_STEPS, formatPercent, nearestStepIndex, stepValue } from "../model/controlScale";

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const index = computed(() => nearestStepIndex(props.modelValue));
const label = computed(() => formatPercent(props.modelValue));

function onInput(event: Event) {
  emit("update:modelValue", stepValue(Number((event.target as HTMLInputElement).value)));
}
</script>

<template>
  <span class="f-percent">
    <input
      class="f-percent-slider"
      type="range"
      min="0"
      :max="PERCENT_STEPS.length - 1"
      step="1"
      :value="index"
      :disabled="disabled"
      :aria-valuetext="label"
      aria-label="Percentage"
      @input="onInput"
    />
    <span class="f-percent-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.f-percent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.f-percent-slider {
  appearance: none;
  width: 90px;
  height: 6px;
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.f-percent-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-percent-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-percent-label {
  min-width: 34px;
  font-size: 12px;
  color: var(--f-text);
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test fPercentSlider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/FPercentSlider.vue test/fPercentSlider.spec.ts
git commit -m "feat(ui): FPercentSlider discrete percentage slider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV"
```

---

## Task 3: Swap `ControlRow` to `FPercentSlider`

**Files:**
- Modify: `src/components/ControlRow.vue`

**Interfaces:**
- Consumes: `FPercentSlider` (Task 2).

- [ ] **Step 1: Replace the imports**

In `src/components/ControlRow.vue`, replace these two import lines:
```ts
import FNumberInput from "../ui/FNumberInput.vue";
import FSlider from "../ui/FSlider.vue";
```
with:
```ts
import FPercentSlider from "../ui/FPercentSlider.vue";
```

- [ ] **Step 2: Replace the cell markup**

Replace:
```vue
    <td v-for="col in columns" :key="col.key" class="cell">
      <FSlider v-model="control[col.key]" />
      <FNumberInput v-model="control[col.key]" />
    </td>
```
with:
```vue
    <td v-for="col in columns" :key="col.key" class="cell">
      <FPercentSlider v-model="control[col.key]" />
    </td>
```

- [ ] **Step 3: Remove the orphaned CSS**

Delete this now-unused block from the `<style scoped>` section:
```css
.cell:deep(.f-slider) {
  width: 90px;
  vertical-align: middle;
  margin-right: 6px;
}
```

- [ ] **Step 4: Run the affected suites to verify no regression**

Run: `pnpm test resourceEnemyTabs terrainTab`
Expected: PASS (tables still render controls; the disabled noise-row FSliders on the Terrain tab are untouched).

- [ ] **Step 5: Commit**

```bash
git add src/components/ControlRow.vue
git commit -m "feat(ui): render control cells with the percentage slider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV"
```

---

## Task 4: Move starting area to the Enemy tab

**Files:**
- Modify: `src/components/EnemyTab.vue`
- Modify: `src/components/AdvancedTab.vue`
- Test: `test/resourceEnemyTabs.spec.ts` (add), `test/advancedTab.spec.ts` (remove one test)

**Interfaces:**
- Consumes: `FPercentSlider` (Task 2), `usePresetsStore().activePreset.startingArea`.

- [ ] **Step 1: Write the failing Enemy-tab test**

In `test/resourceEnemyTabs.spec.ts`, add `usePresetsStore` to the imports:
```ts
import { usePresetsStore } from "../src/store/presets";
```
and add this test inside the existing `describe("EnemyTab", ...)` block:
```ts
  it("shows and edits the starting area size", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(EnemyTab);
    const input = wrapper.find('[data-test="starting-area"] input');
    expect((input.element as HTMLInputElement).value).toBe("5"); // startingArea 1 -> 100% -> index 5
    (input.element as HTMLInputElement).value = "8"; // 200%
    await input.trigger("input");
    expect(store.activePreset?.startingArea).toBe(2);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test resourceEnemyTabs`
Expected: FAIL - no `[data-test="starting-area"]` on the Enemy tab yet.

- [ ] **Step 3: Add the starting-area row to `EnemyTab.vue`**

Replace the entire `src/components/EnemyTab.vue` with:
```vue
<script setup lang="ts">
import { computed } from "vue";
import { type ControlColumn, controlsForCategory } from "../model/controlCatalog";
import { usePresetsStore } from "../store/presets";
import ControlTable from "./ControlTable.vue";
import FPercentSlider from "../ui/FPercentSlider.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
];
</script>

<template>
  <ControlTable :names="controlsForCategory('enemy')" :columns="COLUMNS" leadLabel="Setting" />
  <div v-if="preset" class="starting-area">
    <span class="sa-label">Starting area size</span>
    <FPercentSlider v-model="preset.startingArea" data-test="starting-area" />
  </div>
  <p class="note">
    Evolution and expansion settings live in the MapSettings payload region and unlock in Phase 1.
  </p>
</template>

<style scoped>
.starting-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
}

.sa-label {
  font-weight: 700;
}

.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>
```

- [ ] **Step 4: Run the Enemy-tab test to verify it passes**

Run: `pnpm test resourceEnemyTabs`
Expected: PASS (both the header test and the new starting-area test).

- [ ] **Step 5: Remove the starting-area field from `AdvancedTab.vue`**

In `src/components/AdvancedTab.vue`, delete this block from the Map size `<div class="size-row">`:
```vue
      <label>
        Starting area
        <FNumberInput v-model="preset.startingArea" data-test="starting-area" />
      </label>
```
Leave the width and height labels (and the `FNumberInput` import - width/height still use it).

- [ ] **Step 6: Remove the stale Advanced-tab test**

In `test/advancedTab.spec.ts`, delete the entire test:
```ts
  it("shows and edits the active preset's starting area", async () => {
    ...
    expect(store.activePreset?.startingArea).toBe(2);
  });
```

- [ ] **Step 7: Run both tab suites to verify they pass**

Run: `pnpm test advancedTab resourceEnemyTabs`
Expected: PASS (Advanced tab keeps width/height/peaceful/no-enemies; Enemy tab owns starting area).

- [ ] **Step 8: Commit**

```bash
git add src/components/EnemyTab.vue src/components/AdvancedTab.vue test/resourceEnemyTabs.spec.ts test/advancedTab.spec.ts
git commit -m "feat(ui): move starting-area size to the Enemy tab as a percentage slider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV"
```

---

## Task 5: Full-suite, byte-exact, build, and lint gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole app suite**

Run: `pnpm test`
Expected: PASS. In particular `ui-kit` (FSlider) and `terrainTab` (disabled noise-row FSliders) stay green - `FSlider` was not removed - and the codec round-trip suites (`encode`, `decode`) are unchanged, confirming byte-exactness held.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: builds without error.

- [ ] **Step 3: Lint + format**

Run: `pnpm check`
Expected: no warnings or lint errors. If it reformats files, `git add -A` and amend the last commit or make a `style(ui): vp check` commit.

- [ ] **Step 4: Commit any formatting**

```bash
git add -A
git commit -m "style(ui): vp check formatting for percentage sliders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uc4yUwLsjHLyjyzA2KReHV" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage** (spec section -> task):
- 3 Scale + byte-exactness (float32 `Math.fround` steps) -> Task 1.
- 4.1 `controlScale.ts` (steps, stepValue, nearestStepIndex log-ratio + tie-break, formatPercent) -> Task 1.
- 4.2 `FPercentSlider.vue` (index-domain range, percent label, aria-valuetext, off-scale) -> Task 2.
- 4.3 `ControlRow` swap + orphaned-CSS cleanup -> Task 3.
- 4.4 Enemy tab gains starting area; Advanced tab drops it -> Task 4.
- 4.5 `FSlider` kept (only removed from `ControlRow`) -> Task 3 + Global Constraints + Task 5 (ui-kit/terrainTab stay green).
- 5 Testing (controlScale, FPercentSlider, EnemyTab, AdvancedTab, byte-exact regression) -> Tasks 1, 2, 4, 5.
- 6 Non-goals (no None/0%, no free-form entry, no codec change) -> respected; nothing adds a 0 step or numeric entry.

**Placeholder scan:** No TBD/TODO. Every code step shows the full code; every run step shows the command and expected result. The only literal placeholder in the codebase (`Claude-Session` URL) is the required commit trailer.

**Type consistency:** `PERCENT_STEPS`/`stepValue`/`nearestStepIndex`/`formatPercent` are defined in Task 1 and consumed with identical names/signatures in Task 2. `FPercentSlider`'s `modelValue: number` + `update:modelValue` contract matches its use in Tasks 3 and 4. `startingArea` is a `number` on `Preset`, matching the `v-model` in Task 4 and the `.toBe(2)` assertion. Index 5 = 100% and index 8 = 200% are consistent between the reference table and the Task 2/4 tests.

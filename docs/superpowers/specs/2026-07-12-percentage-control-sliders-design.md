# Factorio Map WebUI - Percentage Control Sliders Design

- **Date:** 2026-07-12
- **Status:** Design approved; ready for implementation plan.
- **Depends on:** the autoplace control model (`src/model/controlCatalog.ts`,
  `src/model/types.ts` `AutoplaceSetting`), the control UI
  (`src/components/ControlRow.vue`, `ControlTable.vue`, `ResourcesTab.vue`,
  `TerrainTab.vue`, `EnemyTab.vue`, `AdvancedTab.vue`), and the byte-exact
  map-exchange codec.

## 1. Summary

Replace the raw multiplier sliders on the control tables with **discrete
percentage sliders** that snap to Factorio's own steps, so the editor reads the
way the game does. Each frequency / size / richness control (Resources, Terrain,
Enemy) and the starting-area size become a slider that snaps to one of twelve
percentages and shows that percentage as a label:

```
17%  25%  33%  50%  75%  100%  133%  150%  200%  300%  400%  600%
```

`100%` is the default. Starting-area size moves from the Advanced tab onto the
Enemy tab, matching Factorio's grouping (enemy bases, gleba bases, starting
area).

## 2. Current state

- `ControlRow.vue` renders, per column, an `FSlider` (continuous `type=range`,
  `min=0 max=6 step=0.05`) **and** an `FNumberInput` showing the raw float, both
  bound to `control[col.key]` (a `frequency` / `size` / `richness` float).
- `startingArea` is a raw `FNumberInput` on `AdvancedTab.vue`, next to
  width/height.
- Columns: Resources = frequency/size/richness; Terrain coverage = scale/coverage
  (frequency/size relabelled); Terrain cliffs = frequency/continuity; Enemy =
  frequency/size. All are the same underlying autoplace multipliers and share the
  same percentage scale.

## 3. The scale and byte-exactness (the crux)

The map-exchange codec is **byte-exact**; the multipliers are stored as
**float32** (`readFloat32`/`writeFloat32`; `startingArea` is schema type `f32`).
Because `writeFloat32` truncates to float32 on write, storing `Math.fround(x)`
values round-trips byte-exactly (indeed a plain double would emit identical
bytes). This is confirmed by the fixtures, whose non-default values are exactly
the float32 forms of simple fractions - e.g. `Rail world`'s `coal.frequency`
decodes to `0.3333333432674408` = `Math.fround(1/3)`, and
`starting-area-diff.txt` decodes to `1.3333333730697632` = `Math.fround(4/3)`.
Observed on-scale in the corpus: controls `0.25`, `Math.fround(1/3)`, `0.5`,
`0.75`, `1.5`, `2`, `3`, `4`; startingArea `0.75`, `Math.fround(4/3)`, `3`. One
**off-scale** value also exists: `starting-area-5.txt` = `5` (500%), a
synthetic/manual value between the 400% and 600% steps - proof the UI must
tolerate off-scale inputs (see 4.1/4.2).

The twelve steps therefore map to `Math.fround` of the exact fractions:

| % | value |
| --- | --- |
| 17% | `Math.fround(1/6)` |
| 25% | `Math.fround(1/4)` = 0.25 |
| 33% | `Math.fround(1/3)` |
| 50% | 0.5 |
| 75% | 0.75 |
| 100% | 1 |
| 133% | `Math.fround(4/3)` |
| 150% | 1.5 |
| 200% | 2 |
| 300% | 3 |
| 400% | 4 |
| 600% | 6 |

Storing these exact float32 doubles keeps every re-emitted exchange string
byte-identical to the game's. The percent label for a step is
`Math.round(value * 100)` (e.g. `Math.fround(1/6)` -> 17, `Math.fround(4/3)` ->
133), which reproduces the game's rounded labels.

**Verify-at-implementation (low risk):** the `1/3` (33%) and `4/3` (133%) steps
are directly fixture-confirmed. Only `1/6` (17%) is inferred from the same
float32-of-fraction pattern (the corpus has no 17% sample). If exactness for that
one step ever matters, confirm against an in-game preset dump (the project has an
in-game parse oracle). Either way the codec round-trips whatever float32 we
store, so the only risk is a cosmetic byte mismatch versus the game for the 17%
step.

## 4. Components

### 4.1 `src/model/controlScale.ts` (new)

Single source of truth for the scale, no UI:

- `PERCENT_STEPS: readonly { value: number; percent: number }[]` - the twelve
  steps in ascending order, `value` = `Math.fround(fraction)`, `percent` =
  `Math.round(value * 100)`.
- `stepValue(index: number): number` - value at a step index (clamped).
- `nearestStepIndex(value: number): number` - index of the closest step (for
  positioning the thumb, including off-scale values). The scale is
  quasi-geometric, so "closest" is measured by **log-ratio distance**
  (`|Math.log(value / stepValue(i))|`), not linear distance, so e.g. `5.0` (500%)
  resolves sensibly between the 400% and 600% notches. Ties resolve to the
  **higher** step. `value <= 0` clamps to index 0. Pin all of this in tests.
- `formatPercent(value: number): string` - `` `${Math.round(value * 100)}%` ``
  (shows the true percentage of any value, on- or off-scale).

### 4.2 `src/ui/FPercentSlider.vue` (new)

Replaces `FSlider` + the raw `FNumberInput` in the control tables.

- Props: `modelValue: number` (the float), `disabled?: boolean`.
- Emits `update:modelValue` with a snapped step value.
- Renders a `type=range` input over **indices** `min=0 max=11 step=1`, positioned
  at `nearestStepIndex(modelValue)`; on input, emits `stepValue(index)`.
- Shows a `formatPercent(modelValue)` label beside the track (e.g. `100%`).
- Off-scale `modelValue`: the label shows the true percentage and the thumb sits
  at the nearest notch; the value only changes to an exact step when the user
  drags. On-scale values (all built-ins) are never rewritten.
- **Accessibility:** the range input's domain is a step index, which a screen
  reader would otherwise announce as "6 of 11". Set `aria-valuetext` to the
  percent string (and an `aria-label`) so it announces "100%". Arrow keys moving
  one notch per index is the intended keyboard behaviour.

### 4.3 `ControlRow.vue` (change)

Each column cell renders a single `FPercentSlider` bound to `control[col.key]`
instead of the `FSlider` + `FNumberInput` pair. Remove the now-orphaned
`.cell:deep(.f-slider)` CSS and the number-box margin. No other logic changes.
`FNumberInput` stays in the codebase (Advanced tab width/height still use it).

### 4.4 `EnemyTab.vue` (change) and `AdvancedTab.vue` (change)

- `EnemyTab.vue` keeps its enemy control table (enemy bases, gleba bases via
  `controlsForCategory('enemy')`) and gains a **Starting area size** row: a
  labelled `FPercentSlider` bound to `store.activePreset.startingArea`. Starting
  area uses the same 12-step scale (stated by the user, and consistent with the
  fixture samples `0.75`/`Math.fround(4/3)`/`3` = 75%/133%/300%).
- `AdvancedTab.vue` drops the Starting area field; Map size keeps width/height.

### 4.5 `src/ui/FSlider.vue` (keep - do NOT delete)

`FSlider` is **still used** after this change: `TerrainTab.vue` renders it for the
inert, disabled Moisture / Terrain-type noise rows (one at the `-1..1` scale), and
`test/ui-kit.spec.ts` covers it. Only remove the `FSlider` import and usage from
`ControlRow.vue`; leave `FSlider` and its uses in `TerrainTab.vue` untouched.

## 5. Testing

- **`controlScale`** (unit): `PERCENT_STEPS` values equal the expected float32
  constants and percents are `17,25,33,50,75,100,133,150,200,300,400,600`;
  `stepValue(nearestStepIndex(v)) === v` for every on-scale `v`;
  `nearestStepIndex` picks the closest step for an off-scale value;
  `formatPercent` formatting.
- **`FPercentSlider`** (component): dragging to an index emits the exact step
  float; label shows the step percent; `aria-valuetext` is the percent string; an
  off-scale `modelValue` (e.g. `5` -> "500%") renders its true percent and snaps
  only on interaction.
- **`EnemyTab`**: renders the enemy controls and a Starting area row; editing it
  writes `startingArea`.
- **`AdvancedTab`**: no longer renders the starting-area field (width/height
  remain). The existing `test/advancedTab.spec.ts` "starting area" test moves to
  `EnemyTab` (rewrite it there; drop it from the Advanced spec).
- **Unchanged tests to keep green**: `test/ui-kit.spec.ts` (FSlider) and
  `test/terrainTab.spec.ts` (the disabled noise-row FSliders) must still pass -
  FSlider is not removed.
- **Byte-exact regression**: the existing codec round-trip tests over the 9
  built-in presets (and the `starting-area-*` fixtures) stay green (values
  unchanged), confirming no drift.

## 6. Non-goals

- No `None` (0%) step - strictly the twelve steps above.
- No free-form numeric entry for controls (percentage label only); width/height
  keep their number inputs.
- No change to the codec, the exported JSON/ZIP, or the control catalog.

## 7. Success criteria

1. Every frequency / size / richness control on Resources, Terrain, and Enemy is
   a discrete slider snapping to the twelve percentages, shown as a `%` label.
2. Starting-area size is a percentage slider on the Enemy tab; the Advanced tab
   no longer shows it.
3. Selecting a step stores the exact float32 value; all 9 built-in presets still
   round-trip byte-exactly.
4. `pnpm test` (app) passes, including new `controlScale`, `FPercentSlider`,
   `EnemyTab`, and `AdvancedTab` tests.

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
**float32**. This is confirmed by the built-in fixtures, whose non-default values
are exactly the float32 forms of simple fractions - e.g. `Rail world`'s
`coal.frequency` decodes to `0.3333333432674408`, which is precisely
`Math.fround(1/3)`. Observed in the corpus: `0.25`, `Math.fround(1/3)`, `0.5`,
`0.75`, `1.5`, `2`, `3`, `4`, and startingArea `0.75` and `3`.

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

**Verify-at-implementation (low risk):** the `1/3` step is directly confirmed
against a fixture; `1/6` (17%) and `4/3` (133%) are inferred from the same
float32-of-fraction pattern (the corpus has no 17%/133% sample). If exactness for
those two steps ever matters, confirm against an in-game preset dump (the project
already has an in-game parse oracle). Either way the codec round-trips whatever
float32 we store, so the only risk is a cosmetic byte mismatch versus the game
for those two specific steps.

## 4. Components

### 4.1 `src/model/controlScale.ts` (new)

Single source of truth for the scale, no UI:

- `PERCENT_STEPS: readonly { value: number; percent: number }[]` - the twelve
  steps in ascending order, `value` = `Math.fround(fraction)`, `percent` =
  `Math.round(value * 100)`.
- `stepValue(index: number): number` - value at a step index (clamped).
- `nearestStepIndex(value: number): number` - index of the closest step (for
  positioning the thumb, including off-scale values).
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

### 4.3 `ControlRow.vue` (change)

Each column cell renders a single `FPercentSlider` bound to `control[col.key]`
instead of the `FSlider` + `FNumberInput` pair. No other logic changes.

### 4.4 `EnemyTab.vue` (change) and `AdvancedTab.vue` (change)

- `EnemyTab.vue` keeps its enemy control table (enemy bases, gleba bases via
  `controlsForCategory('enemy')`) and gains a **Starting area size** row: a
  labelled `FPercentSlider` bound to `store.activePreset.startingArea`.
- `AdvancedTab.vue` drops the Starting area field; Map size keeps width/height.

### 4.5 `src/ui/FSlider.vue` (remove)

Becomes unused once `ControlRow` switches to `FPercentSlider`; delete it (and any
test that referenced it).

## 5. Testing

- **`controlScale`** (unit): `PERCENT_STEPS` values equal the expected float32
  constants and percents are `17,25,33,50,75,100,133,150,200,300,400,600`;
  `stepValue(nearestStepIndex(v)) === v` for every on-scale `v`;
  `nearestStepIndex` picks the closest step for an off-scale value;
  `formatPercent` formatting.
- **`FPercentSlider`** (component): dragging to an index emits the exact step
  float; label shows the step percent; an off-scale `modelValue` renders its true
  percent and snaps only on interaction.
- **`EnemyTab`**: renders the enemy controls and a Starting area row; editing it
  writes `startingArea`.
- **`AdvancedTab`**: no longer renders the starting-area field (width/height
  remain).
- **Byte-exact regression**: the existing codec round-trip tests over the 9
  built-in presets stay green (values unchanged), confirming no drift.

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

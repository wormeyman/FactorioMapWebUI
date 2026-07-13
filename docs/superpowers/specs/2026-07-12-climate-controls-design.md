# Editable Moisture & Terrain-type climate controls

Date: 2026-07-12

## Motivation

The Terrain tab shows a "Moisture" and a "Terrain type" row at the bottom, each
with a Scale and a Bias slider, but they are inert (disabled, with a "not yet
editable" note). This project makes them fully editable and byte-exact with the
Factorio 2.1.9 map generator GUI.

These two controls are the game's "climate controls." Unlike the autoplace
controls (which have dedicated `frequency`/`size`/`richness` floats), the climate
controls have no dedicated MapGenSettings structure. Their values are stored
purely as `property_expression_names` overrides, which the codec already
round-trips byte-exact. So this is a model + UI wiring task; the codec is
unchanged.

## Ground truth

Confirmed from 8 in-game captures (seed 123456, Default Nauvis preset, one or two
sliders changed per capture), archived in `docs/mapexchangestrings/`. Decoded
`property_expression_names` values:

| Capture | Key(s) -> value |
| --- | --- |
| moisture Scale 600% | `control:moisture:frequency` = `"0.166667"` |
| moisture Scale 150% | `control:moisture:frequency` = `"0.666667"` |
| moisture Scale 17% | `control:moisture:frequency` = `"6.000000"` |
| moisture Bias +0.50 | `control:moisture:bias` = `"0.500000"` |
| moisture Bias -0.50 | `control:moisture:bias` = `"-0.500000"` |
| moisture Bias +0.05 | `control:moisture:bias` = `"0.050000"` |
| moisture Scale 600% + Bias +0.50 | both moisture keys, both set |
| terrain-type Scale 600% + Bias +0.50 | `control:aux:bias` = `"0.500000"`, `control:aux:frequency` = `"0.166667"` |

### Rules derived

- **Wire keys.** Moisture -> `control:moisture:frequency`, `control:moisture:bias`.
  Terrain type -> `control:aux:frequency`, `control:aux:bias`. `aux` encodes
  identically to `moisture` (confirmed).
- **Number format.** Every value is `printf("%.6f")`, i.e. `value.toFixed(6)`
  (fixed 6 decimals, leading `-` for negatives).
- **Scale.** The 12 percentage notches shared with the frequency sliders:
  17, 25, 33, 50, 75, 100, 133, 150, 200, 300, 400, 600%. The GUI shows *scale*;
  the wire stores *frequency*, its inverse: `frequency = (1 / scaleMultiplier)`,
  then `.toFixed(6)`. The `FRACTIONS` set is symmetric under reciprocal, so every
  inverted value is itself a member of the set. Default 100% (frequency 1) is
  **omitted** from the dict.
- **Bias.** 21 notches, uniform: -0.50, -0.45, ..., 0, ..., +0.45, +0.50 (step
  0.05). The wire stores the bias directly: `bias.toFixed(6)`. Default 0 is
  **omitted**.

Full Scale notch -> wire table (derivable, no more captures needed):

| Scale | frequency | wire string |
| --- | --- | --- |
| 17% | 6 | `6.000000` |
| 25% | 4 | `4.000000` |
| 33% | 3 | `3.000000` |
| 50% | 2 | `2.000000` |
| 75% | 4/3 | `1.333333` |
| 100% | 1 | (omitted) |
| 133% | 3/4 | `0.750000` |
| 150% | 2/3 | `0.666667` |
| 200% | 1/2 | `0.500000` |
| 300% | 1/3 | `0.333333` |
| 400% | 1/4 | `0.250000` |
| 600% | 1/6 | `0.166667` |

## Architecture

### Codec: unchanged

`decodeExchangeString` / `encodePayload` already read and write
`propertyExpressionNames: Record<string, string>` byte-exact, emitting keys in
sorted order (so `control:*:bias` precedes `control:*:frequency`, matching the
captures). No codec change.

### `src/model/controlScale.ts`: generalize the step model

Introduce a small `StepScale` abstraction so one slider widget can serve both the
percentage steps and the bias steps:

```ts
export interface StepScale {
  /** Number of notches (input range is 0..count-1). */
  readonly count: number;
  /** Index of the notch nearest to a raw value. */
  nearestIndex(value: number): number;
  /** Raw value at a notch index. */
  valueAt(index: number): number;
  /** Human label for a value, e.g. "150%" or "+0.05". */
  format(value: number): string;
  /** aria-label for the range input. */
  readonly ariaLabel: string;
}
```

- `PERCENT_SCALE: StepScale` wraps the existing `PERCENT_STEPS` /
  `nearestStepIndex` / `stepValue` / `formatPercent` (geometric nearest, unchanged
  behavior). This is the default the widget uses today.
- `BIAS_SCALE: StepScale` over the 21 bias notches: `count = 21`,
  `valueAt(i) = (i - 10) * 0.05` (clamped/rounded), `nearestIndex` by linear
  distance, `format(v) = signed fixed display` (e.g. `+0.05`, `-0.50`, `0.00`).
- `formatWire6(n: number): string` returns `n.toFixed(6)` - the single wire
  formatter used for all four values.

The existing `PERCENT_STEPS`, `nearestStepIndex`, `stepValue`, `formatPercent`
exports stay (still used directly by `ControlRow`/`FPercentSlider`'s default).

### `src/model/climateControls.ts`: new derived accessor

A thin layer over a `Preset`'s `propertyExpressionNames`. The `Preset` type and
stored shape are unchanged; there are no new persisted fields. For each control
(`"moisture"` and `"aux"`):

- `readScale(pen): number` -> `1 / Number(pen[freqKey] ?? "1")` (defaults to
  scale multiplier 1 = 100% when the key is absent).
- `writeScale(pen, scaleMultiplier)`: if the nearest notch is 100%, `delete`
  the freq key; else set it to `formatWire6(1 / scaleMultiplier)`.
- `readBias(pen): number` -> `Number(pen[biasKey] ?? "0")`.
- `writeBias(pen, bias)`: if the nearest notch is 0, `delete` the bias key; else
  set it to `formatWire6(bias)`.

**Default-omission rule.** Writes that land on the default notch delete the key,
matching the game (whose Default dict is `{}`). This keeps edited-then-reset
presets byte-identical to the game.

**Read is non-mutating.** Reading only snaps the slider for display; it never
rewrites the dict. An imported off-notch value (e.g. a hand-authored `"5"`)
displays at its nearest notch but its exact string is preserved until the user
actively moves that slider. This mirrors how autoplace controls snap for display
while retaining their stored float.

### `src/ui/FPercentSlider.vue`: accept a `StepScale`

Add an optional `scale?: StepScale` prop defaulting to `PERCENT_SCALE`. Replace
the hard references (`PERCENT_STEPS.length`, `nearestStepIndex`, `stepValue`,
`formatPercent`) with `props.scale.count`, `.nearestIndex`, `.valueAt`,
`.format`, `.ariaLabel`. Existing usages (`ControlRow`) pass nothing and behave
exactly as before. Styling is untouched (the label `min-width` may widen slightly
to fit `+0.05`).

### `src/components/TerrainTab.vue`: live rows

Replace the inert noise table (the `NOISE_ROWS` block and its disabled `FSlider`s
plus the "not yet editable" note) with two live rows, Moisture and Terrain type.
Each row:

- **Scale** cell: `FPercentSlider` bound through the climate accessor
  (read/writeScale on the active preset), default `PERCENT_SCALE`.
- **Bias** cell: `FPercentSlider` with `:scale="BIAS_SCALE"`, bound through
  read/writeBias.

Bindings target `store.activePreset.propertyExpressionNames` via the accessor, so
edits flow into `activeExchangeString` through the same reactive path as
`ControlRow`. The `terrain-noise-moisture` and `terrain-noise-terrain-type`
`data-test` hooks are preserved so existing tests keep resolving the rows.

## Data flow

1. User drags the Moisture Scale slider to 150%.
2. `FPercentSlider` emits `valueAt(index)` = multiplier 1.5.
3. `writeScale(pen, 1.5)` sets `pen["control:moisture:frequency"] = "0.666667"`.
4. Pinia reactivity recomputes `activeExchangeString`; the emitted map-exchange
   string now carries the moisture key, byte-identical to the capture.
5. Resetting the slider to 100% deletes the key; the string returns to the
   default form.

## Fixtures and testing

- **Fixtures.** The 8 captures in `docs/mapexchangestrings/` become committed
  round-trip fixtures. (The plan decides whether to reference them in place or
  copy into `test/fixtures/`; referencing in place is simplest.)
- **Codec round-trip.** Each capture decodes and re-encodes byte-identical (folds
  into the existing round-trip suite). This catches any `aux`-vs-`moisture`
  discrepancy for free.
- **`controlScale` unit tests.** `BIAS_SCALE` notch values and `nearestIndex`;
  `formatWire6`; `PERCENT_SCALE` parity with the old direct helpers.
- **`climateControls` unit tests.** Scale inversion (multiplier <-> frequency
  string), bias read/write, and the default-omission rule (writing default
  deletes the key; writing non-default inserts it); non-mutating read of an
  off-notch import.
- **App test.** On the Terrain tab, drive the Moisture Scale slider to 150% and
  the Bias slider to +0.05, then assert `activeExchangeString`'s decoded
  `propertyExpressionNames` equals the corresponding capture's.

## Out of scope

- The "Map type" dropdown / elevation presets stays the disabled placeholder.
- No changes to the codec, the `Preset` type, or persistence.

## Open questions

None. All notch values, ranges, the inversion, the `%.6f` format, and `aux`
equivalence are confirmed against captures.

# Map type (elevation) dropdown - design

Date: 2026-07-13
Status: Approved (brainstorming), pending implementation plan
Branch: `feat/map-type-elevation`

## Goal

Make the "Map type" dropdown on the Terrain tab live. Replace the disabled
placeholder in `src/components/TerrainTab.vue` (the `MAP_TYPE_OPTIONS` stub, a
single hard-coded "Nauvis elevation (Default)") with the real, selectable
base-game map-type presets, byte-exact with the Factorio 2.1.x GUI - the same
discipline used to ship the Moisture / Terrain-type climate controls.

## Key finding: this is model + UI only, no codec work

Decoding the 9 read-only built-in presets (`test/fixtures/builtin-presets.json`)
shows the Map type selection lives entirely in one
`property_expression_names` (PEN) key, `elevation`:

| Preset | `elevation` value |
| --- | --- |
| Default, Rich Resources, Marathon, Death world, Death world marathon, Rail world | *(absent)* |
| Island | `elevation_island` |
| Lakes, Ribbon world | `elevation_lakes` |

The codec (`src/codec/mapExchangeString.ts`) already round-trips arbitrary PEN
keys opaquely, so `elevation` is preserved on import today; only the editor is
missing. This feature therefore touches **no codec code and no fixtures** - it
is a new model module plus a UI wire-up, the same shape as
`src/model/climateControls.ts`.

### Why it is a string enum, not sliders

Unlike `control:<name>:frequency|bias` climate controls, elevation is a **named
noise expression**. `factorioLuaAPI/prototypes/NamedNoiseExpression.html`
documents the mechanism: the GUI's Map type dropdown is populated from
noise-expression prototypes whose `intended_property = "elevation"`, each
labeled by `localised_name` and ordered by `order`; the lowest-order entry (or
the `order = "2000"` technical default) is shown as the GUI default. The concrete
base-game expressions with their labels are **base-mod data**, not in the API
mirror - they come from the oracle capture (Task 1).

## Non-goals

- No codec changes; no edits to any `test/fixtures/*` ground truth.
- The Map type dropdown touches **only** the `elevation` key. The other keys the
  Island/Lakes presets set (`aux`, `moisture`, `cliffiness`, `cliff_elevation`,
  `trees_forest_path_cutout`) are out of scope - the Map type dropdown selects the
  elevation generator only, and the full-preset load is a separate control. This
  means picking "Islands" here yields an elevation-only island that generates
  differently from the built-in "Island" preset; that is intended and matches the
  game GUI, but the claim is verified against the oracle in Task 1, not assumed.
- No new per-planet "appears on" treatment; Map type is a single control at the
  top of the Terrain tab.

## Components

### 1. `src/model/mapType.ts` (new)

Mirrors the non-mutating discipline of `climateControls.ts`.

```ts
export const ELEVATION_KEY = "elevation";

export interface MapType {
  readonly id: string;      // stable dropdown option id, e.g. "normal" / "island"
  readonly label: string;   // GUI label, e.g. "Normal" / "Islands"
  // Written to pen[ELEVATION_KEY] on selection. `null` = the default option ->
  // selecting it deletes the key (default-omission). The option IS the default
  // iff writeValue === null (no separate `isDefault` flag - it would be
  // derivable and could desync).
  readonly writeValue: string | null;
  // OPTIONAL, SPECULATIVE: extra explicit PEN values that also *read back* as
  // this option, beyond `writeValue`. Reserved for the case where the base
  // engine emits its technical-default elevation expression by an explicit name
  // (e.g. a bare "elevation") that should still show as "Normal". The decode of
  // the 9 builtins needs NO alias - `elevation_lakes`/`elevation_island` are
  // distinct non-default options, not default aliases. Task 1 confirms whether
  // any alias is needed at all; ship without it unless the oracle demands it.
  readonly readAliases?: readonly string[];
}

// Populated from the oracle capture (Task 1). Ordered by the prototypes' `order`.
export const MAP_TYPES: readonly MapType[];
```

- `readMapType(pen): MapType` - resolves `pen[ELEVATION_KEY]` to an option:
  absent key -> the default option (`writeValue === null`); a value equal to an
  option's `writeValue` (or a `readAliases` entry, if any) -> that option; an
  **unrecognized** value (modded / future) -> a synthesized transient option
  `{ id: value, label: value, writeValue: value }` so it is displayed and
  preserved. **Never mutates `pen`.**
- `writeMapType(pen, id): void` - looks up the option in `MAP_TYPES` by `id`. A
  found option with `writeValue === null` -> `delete pen[ELEVATION_KEY]`
  (byte-exact for a Default-based preset); a found option with a string
  `writeValue` -> `pen[ELEVATION_KEY] = writeValue`. If `id` is not in
  `MAP_TYPES` (the transient unknown option), fall back to
  `pen[ELEVATION_KEY] = id`, so re-selecting the preserved value is an
  idempotent no-op rather than a crash or a silent drop.

Read/write are intentionally asymmetric in the same way `climateControls.ts` is:
reading works over the raw stored value while writing normalizes. Because a
distinct non-default value (e.g. `elevation_lakes`) round-trips as itself, an
untouched import stays byte-identical; only an active user selection of the
default option deletes the key, making edited-then-reset converge to the game's
canonical (absent) default. Note: multiple presets sharing a value is a
non-issue - `readMapType` is a pure function of `pen[ELEVATION_KEY]`, so every
preset resolves independently (every absent-key preset simply shows the default).

### 2. `src/components/TerrainTab.vue`

- Delete the `MAP_TYPE_OPTIONS` stub and the `disabled` attribute.
- `FDropdown`'s prop is `options: { value: string; label: string }[]` and it
  emits/binds that `value` (not an `id`). So the component maps each `MapType`
  to `{ value: mt.id, label: mt.label }`, and the `computed` get/set translates
  between that emitted `value` (an id) and the PEN dict:
  - get: `readMapType(pen).id`, with the options list = `MAP_TYPES` mapped as
    above, plus - when `readMapType` returns the synthesized transient option -
    that option appended so the unknown value is a selectable/shown entry.
  - set: `writeMapType(pen, emittedValue)`.
- The `computed` reads/writes `store.activePreset.propertyExpressionNames`, the
  same reactive path the moisture/aux sliders already use, so edits flow into
  `activeExchangeString` through Pinia reactivity for free.
- Label copy: the new labels are bare ("Normal"/"Islands"), dropping the stub's
  "Nauvis" qualifier. That is deliberate - the `elevation` key is Nauvis-surface
  only (consistent with the tab's Nauvis planet icons) - but it removes the only
  surface hint on the control, so keep the wording review-worthy. Also note the
  "Islands" label collides with the built-in "Island" *preset* name; they are
  different things (see non-goals) - a short helper/tooltip may be warranted.

Note: as with all control edits, changes mutate reactive state but are **not**
persisted to localStorage until an action calls `saveToStorage()` (existing
app-wide behavior; not changed here).

## Oracle capture (Task 1) and fixtures

Authoritative option list comes from the game, driven headless from this repo:

- Binary: `~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio` (2.1.10, build 86940).
- A dumper mod's `control.lua` iterates `prototypes.named_noise_expression`,
  filters `intended_property == "elevation"`, and writes
  `{ name, localised_name, order }` as JSON to `script-output/`. That set **is**
  the dropdown.
- Run headless with an isolated `--config` whose `write-data` points at a temp
  dir, per the CLAUDE.md recipe, so it is safe alongside a running game.
- Human labels: `localised_name` is a `LocalisedString` (a locale key + section),
  not display text; resolve it from the base-mod locale at
  `.../Contents/data/base/locale/en/*.cfg` (e.g. `elevation_island` -> "Islands").
  This is fragile in two ways the plan must handle: (a) an expression may have
  **no** explicit `localised_name`, so Factorio auto-derives the label and there
  is no cfg entry; (b) resolving a key needs its cfg section, not a bare key.
  Fallback rule: if a label cannot be resolved, use the expression `name`
  verbatim - labels are cosmetic and must never come out blank.
- Verify the core semantic assumption (see non-goals): confirm from the oracle /
  a captured before/after string that toggling the in-game Map type dropdown
  rewrites **only** `elevation` and leaves `aux`/`moisture`/`cliffiness`/
  `cliff_elevation`/`trees_forest_path_cutout` untouched. This is the load-bearing
  justification for the model touching one key; do not take it on faith.
- Capture one map-exchange string per option (set the GUI Map type, export) or
  synthesize by writing the PEN key and re-encoding, then assert each decodes to
  the expected `elevation` value and re-encodes byte-identically. Archive the
  captures under `docs/mapexchangestrings/` as committed round-trip fixtures.

If the headless `--create` triggers an interactive Steam auth prompt, hand Eric
an exact `!` command to run; otherwise the capture is fully automated.

Version note: the install is 2.1.10, not the 2.1.9 named in the task. The
map-exchange format is stable across 2.1.x and the read-only `builtin-presets.json`
still round-trips; the capture version is recorded in the fixtures.

## Testing

- `test/mapType.spec.ts`:
  - `readMapType` for absent key -> default option; for each known value -> its
    option; for an unknown value -> synthesized preserve-option with the raw name.
  - `writeMapType` default option deletes the key; a known option sets it; the
    transient unknown id falls back to writing itself (idempotent no-op).
  - Reads never mutate the PEN dict (including an explicit default-value read).
- Byte-exactness: decode -> re-encode each newly captured fixture equals the
  original string.
- `test/terrainTab.spec.ts`: replace the existing "renders a disabled Map type
  dropdown" test with one asserting the dropdown is live, lists the captured
  options, reflects the active preset's `elevation`, and updates it on selection.

## Risks / open items

- The exact option set (labels, order, and count) is finalized by Task 1. The
  decode of the 9 builtins already establishes that `elevation_lakes` and
  `elevation_island` are distinct non-default options and absent = default; Task 1
  only adds the human labels, `order`, and any option with no builtin coverage.
- The `readAliases` mechanism ships only if the oracle shows the engine emitting
  the technical-default expression under an explicit name; otherwise it is dropped.
- Steam auth prompt on headless `--create` is the only step that might need Eric.

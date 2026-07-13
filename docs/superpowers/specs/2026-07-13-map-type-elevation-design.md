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
  `trees_forest_path_cutout`) are out of scope - this matches the game GUI, where
  the Map type dropdown selects the elevation generator only and the full-preset
  load is a separate control.
- No new per-planet "appears on" treatment; Map type is a single control at the
  top of the Terrain tab.

## Components

### 1. `src/model/mapType.ts` (new)

Mirrors the non-mutating discipline of `climateControls.ts`.

```ts
export const ELEVATION_KEY = "elevation";

export interface MapType {
  readonly id: string;      // stable dropdown option id (what FDropdown binds to)
  readonly label: string;   // GUI label, e.g. "Normal" / "Islands"
  readonly isDefault: boolean;
  // Written to pen[ELEVATION_KEY] on selection. The default option's writeValue
  // is null -> selecting it deletes the key (default-omission).
  readonly writeValue: string | null;
  // Explicit PEN values that also *read back* as this option. The default option
  // may alias the technical-default expression name (e.g. "elevation_lakes") so
  // a preset that stores it explicitly still shows "Normal". Task 1 confirms
  // whether such an alias exists.
  readonly readAliases?: readonly string[];
}

// Populated from the oracle capture (Task 1). Ordered by the prototypes' `order`.
export const MAP_TYPES: readonly MapType[];
```

- `readMapType(pen): MapType` - resolves `pen[ELEVATION_KEY]` to an option:
  absent key -> the default option; a value equal to an option's `writeValue` or
  one of its `readAliases` -> that option; an **unrecognized** value
  (modded / future) -> a synthesized transient option
  `{ id: value, label: value, isDefault: false, writeValue: value }` so it is
  displayed and preserved. **Never mutates `pen`.**
- `writeMapType(pen, id): void` - looks up the option by `id`; `writeValue === null`
  (the default option) -> `delete pen[ELEVATION_KEY]` (byte-exact for a
  Default-based preset); otherwise `pen[ELEVATION_KEY] = writeValue`.

Read/write are intentionally asymmetric in the same way `climateControls.ts` is:
reading an aliased explicit value (e.g. an explicit `elevation_lakes`) shows the
default option but does **not** delete the key; only an active user selection of
the default option deletes it. This keeps an untouched import byte-identical while
making edited-then-reset converge to the game's canonical (absent) default.

### 2. `src/components/TerrainTab.vue`

- Delete the `MAP_TYPE_OPTIONS` stub and the `disabled` attribute.
- Bind the `FDropdown` via a `computed` get/set to
  `store.activePreset.propertyExpressionNames`, using `readMapType` /
  `writeMapType`. The options list is `MAP_TYPES` plus, when the current value is
  unrecognized, the synthesized preserve-option so it can be shown as selected.
- This is the same reactive path the moisture/aux sliders already use, so edits
  flow into `activeExchangeString` through Pinia reactivity for free.

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
- Human labels: `localised_name` is a locale key; resolve display text from the
  base-mod locale at `.../Contents/data/base/locale/en/*.cfg`
  (e.g. `elevation_island` -> "Islands").
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
  - `writeMapType` default option deletes the key; a known option sets it.
  - Reads never mutate the PEN dict (including an explicit default-value read).
- Byte-exactness: decode -> re-encode each newly captured fixture equals the
  original string.
- `test/terrainTab.spec.ts`: replace the existing "renders a disabled Map type
  dropdown" test with one asserting the dropdown is live, lists the captured
  options, reflects the active preset's `elevation`, and updates it on selection.

## Risks / open items

- The exact option set is finalized by Task 1. The model is data-driven so it
  absorbs whatever the oracle reports; the one question it settles is whether
  `elevation_lakes` is a distinct GUI option or is itself the "Normal" default.
- Steam auth prompt on headless `--create` is the only step that might need Eric.

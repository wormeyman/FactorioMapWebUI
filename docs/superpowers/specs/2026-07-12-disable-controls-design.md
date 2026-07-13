# Enable/disable checkboxes for autoplace controls

Date: 2026-07-12

## Motivation

The Factorio 2.1.9 map generator puts an enable/disable checkbox on the left of
many autoplace-control rows (resources, cliffs, water, trees, rocks, ...).
Unchecking one turns that feature off - the common ask being "no cliffs on
Nauvis/Gleba/Fulgora." The app renders these rows (via `ControlRow`) but has no
checkbox, so controls can't be disabled. This adds the checkbox, byte-exact with
the game.

## Ground truth

Confirmed from two in-game captures (Factorio 2.1.9, Default preset, same seed,
only the Cliffs checkbox toggled), archived at
`docs/mapexchangestrings/cliffs-baseline-default.txt` and
`docs/mapexchangestrings/cliffs-nauvis-off.txt`.

Decoded diff between the two strings - the **only** payload change:

| control | baseline | cliffs off |
| --- | --- | --- |
| `nauvis_cliff` | `{frequency:1, size:1, richness:1}` | `{frequency:1, size:0, richness:1}` |

Everything else is identical: same 28 `autoplace_controls` keys,
`default_enable_all_autoplace_controls` stays `true`, the mid-block
`autoplace_settings` count stays `0`, `property_expression_names` unchanged, and
the tail/`cliff_settings` (name `"cliff"`, elevations, richness) untouched. Both
strings round-trip **byte-exact** through the existing encoder (`size: 0`
included).

### Which controls get a checkbox

The game's `AutoplaceControlPrototype.can_be_disabled` flag decides. Dumped from
the running game headless (committed at
`test/fixtures/autoplace-can-be-disabled.dump.json`):

- **Can be disabled (checkbox, 22):** `aquilo_crude_oil`, `calcite`, `coal`,
  `copper-ore`, `crude-oil`, `fluorine_vent`, `fulgora_cliff`, `gleba_cliff`,
  `gleba_stone`, `iron-ore`, `lithium_brine`, `nauvis_cliff`, `rocks`, `scrap`,
  `starting_area_moisture`, `stone`, `sulfuric_acid_geyser`, `trees`,
  `tungsten_ore`, `uranium-ore`, `vulcanus_coal`, `water`.
- **Always on (no checkbox, 6):** `enemy-base`, `fulgora_islands`,
  `gleba_enemy_base`, `gleba_plants`, `gleba_water`, `vulcanus_volcanism`.

This matches the game GUI exactly (Water/Trees/Rocks/Starting-area-moisture and
the cliffs have checkboxes; Vulcanus volcanism, Gleba water/plants, Fulgora
islands do not). Climate controls (Moisture, Terrain type) are not autoplace
controls and have no checkbox - unchanged.

### Rules derived

- **Disabled ⟺ `size === 0`.** An autoplace control is disabled exactly when its
  `size` is `0`. `frequency` and `richness` are retained across a disable.
- **`size = 0` is not a slider notch.** The percentage notches start at 17%
  (`≈0.1667`); `0` is only reachable via the checkbox, so the checkbox and the
  size slider never collide.
- **Re-enable → `size = 1` (100%).** The wire loses the pre-disable size (it is
  `0`), so re-checking always restores `size` to the default `1`. No remembered
  value, matching the game's own behavior on import.

## Architecture

### Codec: unchanged

`size: 0` is an ordinary float the codec already reads and writes byte-exact. No
codec change; no new `Preset` field. "Disabled" is a derived view over the
existing `autoplaceControls[name].size`.

### `src/model/controlCatalog.ts`: a `canBeDisabled` flag

Add a per-control `canBeDisabled: boolean` to the catalog, sourced from the
committed game dump (the 22 names above). A tiny helper module or catalog field;
consumers ask `canBeDisabled(name)`.

### `src/model/autoplaceEnabled.ts` (new): derived enable accessor

A thin, non-persisted accessor over an `AutoplaceSetting`:

- `isEnabled(control): boolean` -> `control.size !== 0`.
- `setEnabled(control, on: boolean)`: `on ? (control.size = 1) : (control.size = 0)`.

Small and pure; keeps the `size === 0` convention in one documented place rather
than scattering `=== 0` across components.

### `src/components/ControlRow.vue`: the checkbox

- For a control whose catalog entry `canBeDisabled` is true, render a checkbox at
  the left of the label cell (matching the game), bound to `isEnabled(control)`.
  Toggling calls `setEnabled`.
- When disabled (`size === 0`), the row's sliders (`FPercentSlider` for
  frequency / size / richness) are shown but `disabled` (grayed), matching the
  game. Frequency and richness keep their values; the size slider is grayed and
  its value is `0`.
- Controls that cannot be disabled render no checkbox but **reserve the checkbox
  gutter** so their labels stay aligned with checkbox rows (matching the game,
  where "Vulcanus volcanism" lines up under "Water"). Their sliders are always
  active.
- The edit flows through the same reactive path as the existing sliders
  (mutating `store.activePreset.autoplaceControls[name].size`), so
  `activeExchangeString` updates identically.

This is the one shared row component, so every tab (Resources, Terrain; Enemy's
controls are all always-on) gets the behavior in one place.

## Data flow

1. User unchecks "Cliffs" on the Terrain tab.
2. `setEnabled(nauvisCliffControl, false)` sets `size = 0`.
3. Pinia reactivity recomputes `activeExchangeString`; the emitted string now
   carries `nauvis_cliff.size = 0`, byte-identical to the capture.
4. Re-checking sets `size = 1`; the string returns to the enabled form and the
   sliders re-activate.

## Fixtures and testing

- **Fixtures.** Commit the two captures (`cliffs-baseline-default.txt`,
  `cliffs-nauvis-off.txt`) and the `can_be_disabled` dump
  (`test/fixtures/autoplace-can-be-disabled.dump.json`).
- **Codec round-trip.** Both captures decode and re-encode byte-identical (folds
  into the existing round-trip suite), and the decoded diff is exactly
  `nauvis_cliff.size` 1 -> 0.
- **Catalog test.** `canBeDisabled` matches the dump for all 28 controls (the 22
  disable-able, the 6 always-on).
- **`autoplaceEnabled` unit tests.** `isEnabled` (size 0 vs non-zero);
  `setEnabled` toggling to 0 and back to 1; frequency/richness untouched.
- **`ControlRow` component tests.** A disable-able control renders a checkbox;
  an always-on control does not; unchecking sets `size = 0` and disables the
  row's sliders; re-checking restores `size = 1` and re-enables them.
- **App test.** On the Terrain tab, uncheck Cliffs and assert
  `activeExchangeString`'s decoded `nauvis_cliff.size === 0` (and re-check
  restores it).

## Out of scope

- Climate controls (Moisture, Terrain type) - not autoplace controls, no
  checkbox.
- The always-on controls - no checkbox by design (`can_be_disabled = false`).
- No change to the codec, the `Preset` type, or persistence.

## Open questions

None. The mechanism (`size === 0`), the `can_be_disabled` set, the re-enable
default (`size = 1`), and byte-exact round-trip are all confirmed against
captures and the game data dump.

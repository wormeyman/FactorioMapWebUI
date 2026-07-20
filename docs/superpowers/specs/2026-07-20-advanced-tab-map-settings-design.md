# Advanced tab: editable map settings - design

Date: 2026-07-20
Branch: `worktree-feat+advanced-tab` (worktree off origin/main)

## Goal

Finish the Advanced tab so the following map-settings fields are editable in the
UI and round-trip byte-exact through the map-exchange codec:

- **Map**: Width, Height (already wired; tidy only)
- **Technology**: Price Multiplier
- **Pollution**: Pollution (enabled), Absorption modifier, Attack cost modifier,
  Minimum to damage trees, Absorbed per damaged tree, Diffusion ratio
- **Asteroids**: Spawning rate
- **Spoiling**: Spoiling rate

## Background / current state

`src/components/AdvancedTab.vue` today shows only editable Width/Height plus a
read-only `property_expression_names` dump and a note that "full map settings ...
are decoded and included in the exported ZIP."

Round-trip editability model (see `src/model/mapSettings.ts` and
`src/model/convert.ts`):

- `Preset.opaqueTailB64` carries every tail byte and is the round-trip source of
  truth. `presetToEncodable` rebuilds the tail from it, then overlays the
  editable sections back on top before encoding.
- Today only `enemyEvolution` and `enemyExpansion` are overlaid, via
  `writeEnemyToTail`. `pollution`, `difficulty`, and `asteroids` are decoded into
  `Preset.mapSettings` as **read-only** derived views and are ignored by the
  encoder.

The EnemyTab establishes the conventions this work follows: `EnemyValueRow`
(slider + number box + `FInfo` tooltip), `FCheckbox` for enables, section-level
gating (children disabled when the section's `enabled` is false), and
display-scaling (`EVO_DISPLAY_SCALE`) where the map GUI shows a scaled value
while the wire stays raw - the scale is applied only on set so an untouched
import stays byte-exact.

## Field mapping (GUI label -> wire key)

| GUI label | wire key | default | display |
|---|---|---|---|
| Width / Height | `Preset.width` / `Preset.height` | 2000 | raw (already wired) |
| Technology > Price Multiplier | `difficulty.technologyPriceMultiplier` | 1 | raw multiplier |
| Pollution > Pollution | `pollution.enabled` | true | checkbox |
| Absorption modifier | `pollution.ageing` | 1 | percent (x100) |
| Attack cost modifier | `pollution.enemyAttackPollutionConsumptionModifier` | 1 | percent (x100) |
| Minimum to damage trees | `pollution.minPollutionToDamageTrees` | 60 | raw |
| Absorbed per damaged tree | `pollution.pollutionPerTreeDamage` | 50 | raw |
| Diffusion ratio | `pollution.diffusionRatio` | 0.02 | percent (x100) |
| Asteroids > Spawning rate | `asteroids.spawningRate` | 1 | percent (x100) |
| Spoiling > Spoiling rate | `difficulty.spoilTimeModifier` | 1 | percent (x100) |

Defaults confirmed from `test/fixtures/map-settings.example.json`.

**Inferred pieces that the oracle pass must confirm:** the "Absorption modifier"
-> `ageing` mapping, and whether each modifier is displayed as a percentage
(x100) versus raw. Slider ranges/steps and the verbatim tooltip strings also come
from the game. See "Oracle verification" below.

## Components

### 1. Round-trip overlay - `src/model/mapSettings.ts`

Generalize `writeEnemyToTail` into `writeMapSettingsToTail(tail, mapSettings)`:

- Keeps the exact `put(key, value)` helper (copies only when `value !== undefined`
  so a genuinely-absent decoded field is never spuriously added; a `false`/`0`
  edit IS written).
- Retains all existing `enemyEvolution.*` / `enemyExpansion.*` writes unchanged.
- Adds overlays for the newly-editable keys only:
  - `pollution.enabled`, `pollution.ageing`,
    `pollution.enemyAttackPollutionConsumptionModifier`,
    `pollution.minPollutionToDamageTrees`, `pollution.pollutionPerTreeDamage`,
    `pollution.diffusionRatio`
  - `difficulty.technologyPriceMultiplier`, `difficulty.spoilTimeModifier`
  - `asteroids.spawningRate`
- Does NOT write the other pollution/difficulty/asteroids/unitGroup/pathFinder
  keys; those remain carried opaquely via `opaqueTailB64`.

`src/model/convert.ts:50` swaps the `writeEnemyToTail(...)` call for
`writeMapSettingsToTail(tail, preset.mapSettings)`. The `Preset.mapSettings`
docstring in `src/model/types.ts` is updated to reflect that pollution,
difficulty, and asteroids are now (partially) round-trip editable.

**Invariant preserved:** for an untouched preset every overlaid value equals the
decoded one, so all 9 builtin fixtures still re-encode byte-for-byte. This is the
hard test gate.

### 2. Display scaling - `AdvancedTab.vue`

A small `DISPLAY_SCALE` map mirroring `EVO_DISPLAY_SCALE`: percentage fields
(`ageing`, attack-cost modifier, `diffusionRatio`, `spawningRate`,
`spoilTimeModifier`) show `wire * 100` with a `%` suffix; tree thresholds and the
tech price multiplier show raw. A computed getter/setter per field applies the
scale only on set, matching the EnemyTab discipline. Round away float-multiply
noise in the getter (as EnemyTab does).

### 3. UI sections - `AdvancedTab.vue`

Reuse `EnemyValueRow`, `FCheckbox`, `FInfo`. Sections in order:

- **Map size** - existing Width/Height (`FNumberInput`); tidy only.
- **Technology** - Price Multiplier.
- **Pollution** - `enabled` checkbox, then the 5 value rows; each child row
  `:disabled` when `pollution.enabled` is false (mirrors enemy-section gating).
- **Asteroids** - Spawning rate.
- **Spoiling** - Spoiling rate.
- **Property expression names** - the existing read-only dump, moved into a
  collapsed `<details>` element below the controls (kept as a diagnostic).

Each value row carries `data-test` attributes for component tests and an `:info`
tooltip.

### 4. Tests (TDD) - `test/mapSettings.spec.ts` + store/component

- For each new editable field: decode a preset -> set the field -> encode ->
  decode, and assert the value round-trips.
- Untouched-preset byte-exactness: extend / rely on the existing builtin-fixture
  re-encode assertions to prove the generalized overlay changed no bytes.
- Component: bindings write the wire value at the correct scale (e.g. setting the
  displayed `2` for diffusion writes `0.02`); pollution gating disables the child
  rows when `enabled` is false.

## Oracle verification

Per the chosen approach, confirm the inferred mapping and scaling against the
game before finalizing labels/scales:

- **Wire round-trip** is confirmed by `helpers.parse_map_exchange_string` (the
  existing dump-mod oracle) - this validates that edited values serialize to the
  expected wire keys/values.
- **Display scaling, slider ranges, and tooltip text** are NOT exposed by
  `parse_map_exchange_string` (it returns wire values, not GUI display). These
  come from importing strings with known wire values and reading the map-gen GUI
  (the same "import a known string, read the GUI" method the EnemyTab comment
  cites) plus the game's locale `.cfg` for verbatim tooltip strings.

**Fallback:** if the Factorio binary is not reachable from the worktree, implement
against the table above with code comments flagging each unverified scale, and
verify in-game afterward. This fallback still ships correct wire round-trip; only
the display scaling would be pending confirmation.

## Out of scope (YAGNI)

- unitGroup and pathFinder sections (not requested; remain opaque/read-only).
- The many other pollution/difficulty fields not in the requested list.
- Any change to the codec binary layout - this work only touches the overlay,
  model, and UI layers.

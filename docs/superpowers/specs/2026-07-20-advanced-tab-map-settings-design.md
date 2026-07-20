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

## Field mapping (GUI label -> wire key) - ORACLE VERIFIED 2026-07-20

Verified in-game (Factorio 2.1.9): labels + tooltips from the core locale
`[gui-map-generator]` section; display scales and slider ranges by reading the
map-gen Advanced GUI; the label->wire-field mapping by importing a sentinel
exchange string (one unique value per field) and reading each control.

| GUI label | wire key | control | scale | range (display) |
|---|---|---|---|---|
| Width / Height | `Preset.width` / `Preset.height` | number box | raw | (already wired) |
| Technology > Price multiplier | `difficulty.technologyPriceMultiplier` | number box | raw | 1 - 100000 |
| Pollution (enable) | `pollution.enabled` | checkbox | - | - |
| Absorption modifier | `pollution.ageing` | slider+box | percent (x100) | 10 - 400% |
| Attack cost modifier | `pollution.enemyAttackPollutionConsumptionModifier` | slider+box | percent (x100) | 10 - 400% |
| Minimum to damage trees | `pollution.minPollutionToDamageTrees` | slider+box | raw | 0 - 9999 |
| Absorbed per damaged tree | `pollution.pollutionRestoredPerTreeDamage` | slider+box | raw | 0 - 9999 |
| Diffusion ratio | `pollution.diffusionRatio` | slider+box | percent (x100) | 0 - 25% |
| Asteroids > Spawning rate | `asteroids.spawningRate` | slider+box | percent (x100) | 10 - 400% |
| Spoiling > Spoiling rate | `difficulty.spoilTimeModifier` | slider+box | percent INVERSE (100/wire) | 10 - 1000% |

Two findings overturned the pre-oracle guesses:

- **"Absorbed per damaged tree" is `pollutionRestoredPerTreeDamage`, NOT
  `pollutionPerTreeDamage`.** Sentinel had per=44 / restored=10 (default); the GUI
  field showed 10, i.e. it tracks our `restored` field. The overlay and UI target
  `pollutionRestoredPerTreeDamage`; `pollutionPerTreeDamage` stays carried opaquely.
- **Spoiling rate is displayed as the INVERSE of the wire value:**
  `display% = round(100 / spoilTimeModifier)` (wire is spoil *time*, GUI shows
  *rate*). Sentinel `spoilTimeModifier=0.77` displayed 130% (100/0.77). Setting
  rate R% writes `wire = 100 / R`. This field does NOT use the linear `scaled()`
  helper; it needs its own inverse getter/setter.

The other seven mappings/scales read exactly as predicted on sentinel import
(Absorption 11%, Attack 22%, Diffusion 5%, Min-to-damage 33, Price 3, Spawning
66%, and the Absorbed/Spoiling above).

Verbatim tooltip strings (core locale, use as `FInfo` text):

- Price multiplier: (no dedicated map-gen tooltip; omit `info` or leave empty)
- Pollution: `Controls whether pollution is enabled.\nNote: Disabled pollution will disable some achievements.`
- Absorption modifier: `Modifier of how much pollution is absorbed by trees and tiles.\nNote: A value higher than 100% will disable some achievements.`
- Attack cost modifier: `Modifier of how much pollution is consumed to send a biter to attack.\nNote: A value higher than 100% will disable some achievements.`
- Minimum to damage trees: `Trees have 4 different progressive stages toward being destroyed by pollution. Any pollution above this amount starts the process of moving a tree toward a more damaged stage.` (drop the achievement note - its threshold is a runtime placeholder)
- Absorbed per damaged tree: `Trees have 4 different progressive stages toward being destroyed by pollution. This value specifies how much pollution is absorbed when moving to a more damaged stage.`
- Diffusion ratio: `The amount of pollution diffused into neighboring chunks per second.`
- Spawning rate: `Rate at which asteroids spawn in space.`
- Spoiling rate: `Rate at which spoilable items spoil.`

Defaults (from `test/fixtures/map-settings.example.json`): ageing 1,
enemy_attack...modifier 1, min_pollution_to_damage_trees 60,
pollution_restored_per_tree_damage 10, diffusion_ratio 0.02, spawning_rate 1,
technology_price_multiplier 1, spoil_time_modifier 1.

**(Historical) pre-oracle inferences:** "Absorption modifier" -> `ageing`
(CONFIRMED); "Absorbed per damaged tree" -> `pollutionPerTreeDamage` (WRONG - the
oracle proved it is `pollutionRestoredPerTreeDamage`); all display scales assumed
linear x100 (WRONG for Spoiling rate, which is inverse). These are why the oracle
pass mattered: a wrong label/scale still round-trips byte-exact, so no unit test
catches it - only in-game reading does.

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
    `pollution.minPollutionToDamageTrees`,
    `pollution.pollutionRestoredPerTreeDamage` (the "Absorbed per damaged tree"
    GUI field - oracle-verified), `pollution.diffusionRatio`
  - `difficulty.technologyPriceMultiplier`, `difficulty.spoilTimeModifier`
  - `asteroids.spawningRate`
- Does NOT write the other pollution/difficulty/asteroids/unitGroup/pathFinder
  keys; those remain carried opaquely via `opaqueTailB64`.

Renaming `writeEnemyToTail` touches **four** references that all must be updated
in lockstep (verified by review):

- `src/model/convert.ts:8` - the import.
- `src/model/convert.ts:50` - the call site, swapped for
  `writeMapSettingsToTail(tail, preset.mapSettings)`.
- `test/mapSettings.spec.ts:3` (import) and `:231-259` - two tests call
  `writeEnemyToTail(tail, evolution, expansion)` directly; update to the new
  `(tail, mapSettings)` signature.
- The function's own docstring at `src/model/mapSettings.ts:289-300` (currently
  describes enemy-only behavior) plus the `Preset.mapSettings` docstring in
  `src/model/types.ts:49-56`.

The new docstring MUST keep the "writes only these specific keys" contract
prominent (the old `writeEnemyToTail` doc does this well): the function writes
enemy in full plus the hand-picked pollution/difficulty/asteroids subset below,
and deliberately does NOT touch unitGroup, pathFinder, or the other
pollution/difficulty keys - so a future dev wiring, say, a unitGroup control is
not misled by the "map settings" name into assuming it is already handled.

Note on the `put()` undefined-guard: optional tail fields decode to `null` when
absent (not `undefined`), and the tail is pre-populated from `opaqueTailB64`, so
`mapSettings.X` is always a number/bool or `null` here - never `undefined`. The
guard stays as harmless defense, but it is effectively inert for these fields; an
absent optional arrives as `null`, `put` copies it (`null !== undefined`), and
`writeFields` re-emits presence-byte 0 - still byte-exact. Do not over-invest
test effort in the `undefined` path; no fixture exercises it.

**Invariant preserved:** for an untouched preset every overlaid value equals the
decoded one, so all 9 builtin fixtures still re-encode byte-for-byte. This is the
hard test gate.

### 2. Display scaling - `AdvancedTab.vue`

A small per-field `DISPLAY_SCALE` map mirroring `EVO_DISPLAY_SCALE`. A computed
getter/setter per field applies the scale only on set, matching the EnemyTab
discipline; round away float-multiply noise in the getter (as EnemyTab does).

**Each field's scale is independently unverified** and must be confirmed by the
oracle pass rather than by applying one uniform x100 rule (review finding - the
x100 "percent" idea has no in-repo precedent; EnemyTab only ever scales by
1e7/1e5). Working hypotheses, each flagged in code for verification:

- Likely percent (x100): `ageing`, attack-cost modifier, `spawningRate`.
- Likely raw: `minPollutionToDamageTrees`, `pollutionPerTreeDamage`,
  `technologyPriceMultiplier`.
- **Explicitly suspect, must be resolved in-game:**
  - `technologyPriceMultiplier` (raw) vs `spoilTimeModifier` (percent) - both are
    `difficulty_settings` multipliers defaulting to 1, so treating them
    differently is a red flag; one is probably wrong.
  - `diffusionRatio` (default 0.02, a genuine ratio, not a unit-multiplier) - the
    game may show it as `2`, `0.02`, or `2%`; do not assume it shares the
    modifier x100 rule.

The no-op boundary matters: whatever scale is chosen, re-setting the displayed
value of an untouched field must write back the exact decoded f64 (e.g. display
`2` -> `0.02`) so re-encoding stays byte-exact. This is locked in by a test
(below).

### 3. UI sections - `AdvancedTab.vue`

Reuse `EnemyValueRow`, `FCheckbox`, `FInfo`. Sections in order:

- **Map size** - existing Width/Height (`FNumberInput`); tidy only. MUST keep the
  `map-width` / `map-height` `data-test` hooks (asserted by
  `test/advancedTab.spec.ts`).
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
- Untouched-preset byte-exactness: the existing `presetToEncodable round-trips`
  test over all 9 builtin fixtures (`test/encode.spec.ts:96-102`) already gates
  this - confirm it still passes after the overlay generalization (it is the real
  regression net; the fixtures may not all contain e.g. asteroids keys, but the
  structural no-op guarantee plus this test covers the sections they do contain).
- **Falsy / no-op edits** (mirroring the existing `enemyExpansion` guards at
  `test/convert.spec.ts:26-38`):
  - `pollution.enabled = false` round-trips as **present-false**, not absent
    (the `{ optional: "bool" }` path writes presence=1/value=0 -
    `fieldSchema.ts:70-77` - it does not collapse `false` to absent).
  - a numeric pollution field set to `0` survives the round-trip.
  - a display-scale no-op boundary: re-setting the displayed value of an
    untouched percent field writes back the exact decoded f64 and re-encodes
    byte-identically (e.g. diffusion displayed `2` -> `0.02`).
- Component: bindings write the wire value at the correct scale; pollution gating
  disables the child rows when `enabled` is false.

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

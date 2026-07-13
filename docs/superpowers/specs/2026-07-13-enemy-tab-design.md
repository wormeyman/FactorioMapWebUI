# Enemy tab build-out - design

Date: 2026-07-13
Status: approved design, pre-implementation

## Goal

Duplicate the in-game Enemy tab in the map-preset editor: the existing enemy
autoplace rows plus the No-enemies / Peaceful checkboxes, the starting-area
slider, and two new editable sections - Enemy expansion and Evolution - whose
values flow into the exported map-exchange string byte-exactly.

This is the first feature that makes part of the MapSettings tail *editable*.
Phase 1c already decodes every `enemyEvolution.*` / `enemyExpansion.*` field, but
`Preset.mapSettings` is a read-only derived view; the encoder round-trips from
the raw `opaqueTailB64` bytes and never reads it. This work promotes the two
enemy sections to round-trip-editable state.

## Scope

In scope, top to bottom of the Enemy tab:

1. Enemy bases table (Nauvis + Gleba enemy-base autoplace) - Frequency / Size,
   17-600% scale, "Appears on" column. **Unchanged** (already rendered by
   `ControlTable`).
2. No enemies + Peaceful mode checkboxes - **moved** from the Advanced tab.
3. Starting area size slider - existing `FPercentSlider`, 17-600%. **Unchanged.**
4. Enemy expansion section (new, editable).
5. Evolution section (new, editable).

Out of scope: pollution / unit-group / path-finder / difficulty / asteroids
settings (they remain carried opaquely in `opaqueTailB64`); exact slider
ranges/steps (placeholders now, real numbers supplied later); FInfo tooltips
(possible follow-up).

## Editable fields

The section-enable checkboxes bind the section's `enabled` bool. Each value row
is a coarse `FSlider` plus a precise `FNumberInput`, both bound to the same
model value; the number box is the source of truth. Ranges/steps are
placeholders this phase.

Evolution (`mapSettings.enemyEvolution`, f64):

| Row label       | Wire field        |
| --------------- | ----------------- |
| (section)       | `enabled`         |
| Time factor     | `timeFactor`      |
| Destroy factor  | `destroyFactor`   |
| Pollution factor| `pollutionFactor` |

Enemy expansion (`mapSettings.enemyExpansion`):

| Row label                  | Wire field                 | Type | UI unit          |
| -------------------------- | -------------------------- | ---- | ---------------- |
| (section)                  | `enabled`                  | bool | -                |
| Minimum expansion distance | `minExpansionDistance`     | u32  | raw              |
| Maximum expansion distance | `maxExpansionDistance`     | u32  | raw              |
| Evolution group size factor| `evolutionGroupSizeFactor` | f64  | raw              |
| Minimum cooldown           | `minExpansionCooldown`     | u32  | minutes (ticks)  |
| Maximum cooldown           | `maxExpansionCooldown`     | u32  | minutes (ticks)  |

Cooldowns display in minutes; the model stores ticks (u32). Convert at the UI
boundary: `minutes = ticks / 3600`, `ticks = round(minutes * 3600)` (3600
ticks/minute). The wire field stays u32 ticks. An untouched imported value
survives byte-exact (minutes is a display-only computed); only an *edit* applies
the round, so a non-whole-minute import (e.g. 36001 ticks) shows an ugly
fraction and nudging the slider quantizes to whole-ish minutes - acceptable,
worth a comment on the computed. Note the decoded default `minExpansionCooldown`
is 36000 ticks (10 min), so the UI default reads 10, not the 4 in
`example.json` (a documented divergence, see `test/mapSettings.spec.ts`).

All other `enemyExpansion.*` fields (radii, coefficients, the friendly/enemy
influence radii, `neighbouring*`, `maxCollidingTilesCoefficient`) are NOT exposed
and ride along unchanged in `opaqueTailB64`.

## Architecture

### Layer 1 - codec/model: encode-time overlay (byte-exact)

`opaqueTailB64` stays the round-trip carrier for the entire tail. The two enemy
sub-objects of `Preset.mapSettings` become editable (they already exist and hold
every decoded value). On encode, overlay them back onto the flat `TailBlock`,
then serialize:

- New `writeEnemyToTail(tail, enemyEvolution, enemyExpansion)` in
  `src/model/mapSettings.ts` - the inverse of the `enemyEvolution.*` /
  `enemyExpansion.*` reads in `tailToNested`. It writes **only the enemy dotted
  keys** (never the sibling pollution/unitGroup/pathFinder/etc. keys), and
  copies a field **only when `value !== undefined`** - an explicit
  undefined-check, NOT a truthiness check. This is load-bearing: the overlay
  base (`bytesToTail(opaqueTailB64)`) reflects the *original* decoded state and
  `opaqueTailB64` is never updated after decode, so a falsy edit must still be
  written or it is silently dropped. `enabled: false` encodes as presence-flag
  `1` + value `0x00`; a `0` distance/cooldown is a real edit. Only a field that
  decoded genuinely absent (`undefined`, presence flag 0) is skipped so it is
  not spuriously added.
- `presetToEncodable` (`src/model/convert.ts`): after
  `bytesToTail(base64ToBytes(preset.opaqueTailB64))`, call `writeEnemyToTail`
  with the preset's two sub-objects, then pass the mutated tail to the encoder.

Byte-exact invariant preserved: for an unedited preset the overlaid values equal
the decoded ones, so the serialized tail is identical and every existing
round-trip fixture test still passes (`test/encode.spec.ts` round-trips all 9
built-ins through `presetToEncodable` and asserts byte-identical output - that
test is the safety net and must stay green). Numeric fields go through
`DataView` (`f64`/`u32`), not the `%.6f` string path used by climate/property
expressions, so there is no float-formatting truncation risk. `jsonExport`
already reads `mapSettings.enemyEvolution/Expansion`, so JSON/ZIP export stays
consistent for free.

**Documentation debt this introduces (must be addressed in the change):** after
this, `mapSettings.enemyEvolution` / `enemyExpansion` become round-trip
authoritative (via the overlay) while the sibling sections in the *same object*
stay read-only-derived and are ignored by the encoder. The now-stale comments at
`types.ts:47-50` ("Read-only this phase; not the round-trip source of truth")
and the `mapSettings.ts` header must be updated to spell out this asymmetry, so a
future dev wiring, say, a pollution slider is not surprised it has no effect.

Rejected alternatives:
- **TailBlock as the sole source of truth** (drop `opaqueTailB64`): every typed
  field becomes editable but with a large blast radius (convert, jsonExport,
  zipExport, all round-trip tests) and it must losslessly carry byte-only
  artifacts (`pathFinder.trailingA`, `cliff.unknownFloat`, `opaqueTail`). More
  than this feature needs.
- **Separate top-level editable enemy fields** duplicating what `mapSettings`
  holds: risks the JSON-export view drifting from the editable state.

### Layer 2 - enable/disable semantics

"Enemy expansion" checkbox <-> `enemyExpansion.enabled`; "Evolution" checkbox
<-> `enemyEvolution.enabled`. When a section is disabled its value rows render
disabled (greyed), mirroring the game and the existing autoplace-disable
pattern. Values persist while disabled, so re-checking restores them (unlike the
cliff enable, which zeroes size - these sections carry their own `enabled` bool).

### Layer 3 - UI

- `src/components/EnemyTab.vue`: restructure to the five blocks above. Bind the
  new sliders/number boxes through `store.activePreset.mapSettings.enemyEvolution`
  / `enemyExpansion`. Cooldown rows bind through a minutes<->ticks computed.
  Remove the "unlock in Phase 1" note.
- `src/components/AdvancedTab.vue`: remove the "Enemies" heading and the
  Peaceful/No-enemies checkbox row (moved to Enemy). The map-size and
  property-expression sections stay.
- Reuse existing kit: `FCheckbox`, `FSlider`, `FNumberInput`, `ControlTable`,
  `FPercentSlider`. Add `data-test` hooks per row/section for tests.

## Data flow

Editing a number box / slider mutates the reactive `mapSettings.enemyEvolution`
or `enemyExpansion` object in place -> `activeExchangeString` recomputes through
Pinia -> `presetToEncodable` overlays the enemy sections onto the tail ->
byte-exact re-encode with the edited values. (Edits are not persisted to
localStorage until a Save action, per the app-wide convention.)

## Testing (TDD)

- **Codec / model round-trip:** all existing built-in-preset fixtures re-encode
  byte-identical (unchanged invariant). New:
  - editing `enemyEvolution.timeFactor` changes the re-encoded string (decode
    the re-encode, assert the new value);
  - editing an `enemyExpansion` u32 field likewise;
  - toggling a section `enabled` flips the wire bit;
  - **falsy-edit regressions (guard the truthiness trap):** toggling a section
    `enabled` to `false` persists through re-encode, and setting a numeric enemy
    field (a distance or cooldown) to `0` persists - these fail if the overlay
    uses a truthiness check instead of `!== undefined`;
  - an unedited preset overlaid-then-encoded is byte-identical to the original.
- **`writeEnemyToTail`:** inverse of the `tailToNested` reads - write a nested
  object into a fresh `TailBlock`, read back via `tailToNested`, values match;
  an `undefined` field is not written.
- **UI (`@vue/test-utils` + pinia):**
  - Enemy tab renders the expansion + evolution rows and the two section
    checkboxes;
  - a section checkbox unchecked disables its value inputs;
  - No-enemies / Peaceful present on the Enemy tab and absent from Advanced;
  - editing a number box flows into `store.activeExchangeString` (decode +
    assert), including the cooldown minutes->ticks conversion.

## Conventions

Pure-additive where possible; no fixture edits (byte-exactness is a hard
invariant). Hyphens, not em/en dashes. Tests import from `vite-plus/test`. Lint
via `pnpm vp check --fix` (Biome; no vue-tsc). Node 24.18.0.

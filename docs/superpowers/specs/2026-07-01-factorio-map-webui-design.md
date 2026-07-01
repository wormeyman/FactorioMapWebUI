# Factorio Map WebUI - Design Spec

- **Date:** 2026-07-01
- **Status:** Approved for planning
- **Author:** Eric Johnson (with Claude)
- **Target game version:** Factorio **2.1.9 (experimental)**, map-exchange format tag `2.1.9.3`

## 1. Summary

A browser-based tool for authoring, previewing (later), and exchanging Factorio
**map generation presets**. Users edit the same settings Factorio's in-game "Map
generator" screen exposes (resources, terrain, enemies, advanced/map settings),
organize them into named presets, and import/export them as Factorio **map
exchange strings** and as `map-gen-settings.json` / `map-settings.json` files.

It is a **pure static single-page app** - no backend, no server, nothing leaves
the browser. This matches the approach of the sibling project FactorioTools
(client-side .NET WASM) and FBE (client-side blueprint editing).

## 2. Goals / Non-Goals

### Goals
- Faithful editor for Factorio 2.1.9 map generation settings across **all five
  Space Age planets** (Nauvis, Vulcanus, Gleba, Fulgora, Aquilo).
- **Byte-perfect** map-exchange-string import/export: a string exported by the
  tool must be accepted by the real game, and a string exported by the game must
  round-trip through the tool to a byte-identical string.
- Export `map-gen-settings.json` + `map-settings.json` (and the exchange string)
  as a downloadable ZIP.
- Named presets persisted in `localStorage`, with duplicate/rename/delete/save.
- Factorio-styled UI matching the game's own map generator screen.

### Non-Goals (v1)
- **No live rendered map preview.** A faithful preview requires Factorio's own
  noise engine, which cannot be reproduced in pure JS. The preview panel is a
  styled placeholder in v1 (see Section 10, Phasing). This is a deliberate
  deferral, not a gap.
- No mod/scenario packaging beyond the JSON + exchange string.
- No cloud sync or accounts.

## 3. Architecture

Layered, with each layer independently testable and the codec fully decoupled
from Vue:

```
UI components (Factorio-styled Vue 3)
      | read/write reactive model
Preset store (Pinia, persisted to localStorage)
      | holds
Settings model (typed: MapGenSettings + MapSettings + difficulty, per preset)
      | (de)serialized by
Codec        map exchange string   (binary <-> base64 <-> zlib <-> CRC32)
IO           JSON / ZIP export + import
```

The codec is plain TypeScript (`decode(str) -> Preset`, `encode(preset) -> str`)
with **zero Vue dependency**, so it is unit-tested directly against the captured
fixtures.

## 4. Target format findings (from fixtures)

Reverse-engineered from 9 real preset strings exported from Factorio 2.1.9
(`test/fixtures/builtin-presets.json`, all verified to decode):

- Envelope: `>>>` + base64( zlib( payload ) ) + `<<<`. Game wraps base64 at 57
  chars on export but ignores whitespace on import.
- **Compression is zlib level 9** (Z_BEST_COMPRESSION). All 9 fixtures carry the
  `78 da` header, and a level-9 deflate of the inflated payload reproduces the
  compressed bytes **byte-identically** (level 6 does not). This is load-bearing
  for the byte-identical export goal - see Sections 6 and 10.
- Payload starts with an **8-byte version header**: four `uint16` LE =
  `2.1.9.3`.
- **One flag byte at offset 8** (`0x00` in every fixture) sits between the header
  and the autoplace dictionary. Purpose unconfirmed; the autoplace control
  **count is at offset 9**.
- `autoplace_controls` is a **single flat dictionary** keyed by control name,
  NOT nested per planet. Count is a plain `uint8` (28 in Default; NOT observed as
  a space-optimized varint in any fixture). Each entry = `uint8` name length +
  name bytes + three `float32` LE (frequency, size, richness). Keys are emitted
  in **ordinal (byte) sort order** (`-` 0x2d before `_` 0x5f), e.g.
  `aquilo_crude_oil, calcite, coal, copper-ore, crude-oil, enemy-base, ...`. The
  encoder MUST sort by code point to be byte-perfect. Planet association is
  encoded in the names (see catalog below).
- After autoplace comes a **55-byte undecoded MapGenSettings block** (terrain /
  water / starting-area scalars; it VARIES between presets - 3 distinct values
  across the 9 fixtures - and is fully mapped in Phase 1). *Corrected
  2026-07-01 during Phase 0 implementation: this spec originally placed the
  block after `property_expression_names`; the original byte-verification
  passed coincidentally because Default's byte at the wrong offset is `0x00`
  (an empty dict). Re-verified against all 9 fixtures at the corrected offset.*
- Then `property_expression_names` (a **string -> string dictionary**, count
  byte then key/value length-prefixed strings). It is **empty in the six
  Nauvis-only presets** but **populated in Lakes/Island (6 keys: `aux`,
  `cliff_elevation`, `cliffiness`, `elevation`, `moisture`,
  `trees_forest_path_cutout`) and Ribbon world (2 keys: `elevation`,
  `trees_forest_path_cutout`)**, which is why those three inflate larger. This
  dict is first-class, not an afterthought.
- Then the remaining tail (640 bytes in every fixture except Default's 645 -
  the cliff anomaly below lives here): a **cliff block** using `float32` (e.g.
  `10.0`, `40.0`), and **MapSettings** (pollution / enemy_evolution /
  enemy_expansion / unit_group / path_finder / steering).
- MapSettings fields are **presence-byte + a value whose type is fixed by that
  field's schema** - a mix of `float64` (pollution rates, evolution factors),
  `uint32` (expansion/group integer fields, observed as `01 05 00 00 00` etc.),
  and counted sub-arrays. It is **NOT** uniformly `float64`; reading every
  optional as a `float64` mis-parses the enemy/unit-group region.
- Payload ends with a **CRC32** (zlib/ANSI polynomial, `uint32` LE) over all
  preceding bytes. Verified to match on all 9 fixtures.

### Known fixture anomaly: Default cliff string

Default inflates to **1387 B** and contains a standalone length-prefixed string
`05 "cliff"` in its cliff region; every other Nauvis-only preset is **1382 B**
with **zero** such standalone token. So Default and Rich Resources encode cliff
settings differently despite (presumably) identical cliff config. This implies
either a **conditional/interned string emission rule** (emit the name only when
it differs from the prototype default) or that Default was captured in a
non-canonical state. **Unresolved, and Default is the origin of `defaults.ts`**,
so it must be settled before the encoder is trusted (Section 14).

Validation already performed: decoding "Rich Resources" and diffing against
"Default" yields exactly richness `1.0 -> 2.0` on the six Nauvis resources -
the wiki's literal definition of that preset. This confirms field-locating from
fixtures works.

### Autoplace control catalog (Default, 28 controls)

Used as reference data (`name -> { planet, category, label }`) so the UI can
group a flat dict under the correct planet tab.

| Planet | Controls |
|---|---|
| Nauvis (unprefixed) | `coal`, `copper-ore`, `crude-oil`, `iron-ore`, `stone`, `uranium-ore`, `enemy-base`, `trees`, `water`, `rocks`, `nauvis_cliff`, `starting_area_moisture` |
| Vulcanus | `vulcanus_coal`, `vulcanus_volcanism`, `calcite`, `sulfuric_acid_geyser`, `tungsten_ore` |
| Gleba | `gleba_stone`, `gleba_water`, `gleba_plants`, `gleba_cliff`, `gleba_enemy_base` |
| Fulgora | `scrap`, `lithium_brine`, `fulgora_cliff`, `fulgora_islands` |
| Aquilo | `aquilo_crude_oil`, `fluorine_vent` |

The exact field lists for the non-autoplace sections (terrain, per-planet
settings, map settings) are finalized against fixtures during Phase 1; the spec
does not invent fields that are not confirmed by a real string.

## 5. Settings model (`src/model/`)

Mirrors the wire format so the model round-trips exactly:

```ts
Preset {
  name: string
  seed: number
  randomEachMap: boolean
  autoplaceControls: Record<string, { frequency: number; size: number; richness: number }>
  // remaining MapGenSettings (property_expression_names, cliffs, water, terrain,
  //   startingArea, width, height, ...) - finalized against fixtures
  mapSettings: {
    pollution; enemyEvolution; enemyExpansion; unitGroup; pathFinder; steering
  }
  difficulty: { technologyPriceMultiplier: number /* Marathon = 4 */ }
}
```

**Ordering contract:** `autoplaceControls` is a `Record<string, ...>` for
ergonomics, but the encoder MUST serialize keys in **ordinal (code-point) sort
order** (see Section 4). The UI may store/display in any order; encoding sorts.

Reference data (not user-editable):
- `planets.ts` - planet list + which controls/settings belong to each.
- `controlCatalog.ts` - `name -> { planet, category, label, hasRichness }`.
- `defaults.ts` - the Default preset, derived from the Default fixture (pending
  resolution of the cliff anomaly in Section 4).

## 6. Codec (`src/codec/`)

- `mapExchangeString.ts` - `decode` / `encode` orchestration + `>>>`/`<<<`
  envelope + base64.
- `binaryReader.ts` / `binaryWriter.ts` - little-endian primitives, length-
  prefixed strings, presence-byte optionals with **per-field value types**
  (float64 / float32 / uint32 / bool), and the property-tree layout. Factorio's
  space-optimized varint is included but applied **only where a fixture proves it
  is used** - observed counts (autoplace = 28, property_expression_names) are
  plain `uint8`, so do NOT varint-encode them.
- `stringDict.ts` - the `property_expression_names` string->string dictionary
  and the conditional cliff-string rule (Section 4 anomaly). This is the highest-
  uncertainty part of the format and gets dedicated tests before the encoder is
  trusted.
- `deflate.ts` - zlib via **`pako`**, pinned to **level 9** to match the game's
  `78 da` stream.
- `crc32.ts` - CRC32 (zlib/ANSI polynomial, `uint32` LE) over the payload.

**Compression fidelity is a hard requirement.** A very early Phase-1 test must
assert that pako at level 9 reproduces the compressed bytes of all 9 fixtures. If
pako diverges from zlib@9 on any fixture, byte-identical *string* export is not
achievable with pako and we fall back to a zlib-exact deflate; regardless, the
**primary** correctness guarantee is defined at the payload level (Section 10),
not the string level. The browser's native `CompressionStream` is NOT usable
here (fixed, non-level-9 compression).

**Fixture-driven and version-aware.** The codec writes the `2.1.9.3` header; the
reader keys on all four `uint16`s of the tuple (the 4th can bump independently of
the 2.1.9 game patch). Because 2.1.9 is experimental, the reader records the
version so a format shift is detectable rather than silently mis-parsed.

## 7. UI (`src/ui/` kit + `src/components/`)

A small Factorio-styled component kit built to match the mockup's palette and
bevels: `FPanel`, `FButton`, `FSlider` (slotted orange slider), `FDropdown`,
`FCheckbox`, `FNumberInput`, `FTabs`.

Screens (mirroring the mockup):
- `PresetBar` (top) - edit-preset dropdown, new-preset name + Create, built-in
  preset dropdown, seed + "Random each new map".
- `ResourcesTab` / `TerrainTab` / `EnemyTab` / `AdvancedTab` (left).
- `PreviewPanel` (right) - planet selector, quality, auto-refresh, Preview
  button; placeholder image in v1.
- Bottom action bar - Duplicate / Download ZIP / Delete / Save.

The **planet dropdown** selects which planet's controls the Resources/Terrain
tabs display, driven by the control catalog.

## 8. Persistence & IO

- **Presets:** Pinia store persisted to `localStorage`.
- **Import:** paste a map exchange string, or upload `map-gen-settings.json` /
  `map-settings.json`.
- **Export:** copy exchange string; **Download ZIP** (`JSZip`) containing
  `map-gen-settings.json`, `map-settings.json`, and the exchange string as
  `.txt`.

## 9. Tooling

- **Vite+ (`vp` CLI, v0.2.1)** - unified toolchain (Vite/Rolldown/Vitest/
  Oxlint/Oxfmt/tsdown). Config in `vite.config.ts` via `defineConfig` from
  `vite-plus`.
- **Package manager:** pnpm (Vite+ default).
- **Node:** pinned to `24.18.0` via `.node-version` (matches FBE).
- **Tests:** import from `vite-plus/test` (not `vitest`).
- Day-to-day: `vp install`, `vp dev`, `vp check --fix`, `vp test`, `vp build`.
- Git hooks: `vp config` + `vp staged` running `vp check --fix` on staged files.
- **Deploy:** static build (`vp build`) to Cloudflare Pages (same host family as
  FactorioTools/FBE).

## 10. Testing strategy

The codec is the safety-critical layer; tests center on it.

- **Payload round-trip (PRIMARY):** for each of the 9 fixtures,
  `inflate(encode(decode(s)))` must byte-equal `inflate(s)` (the decompressed
  payload). This is what actually guarantees the game accepts our output and is
  independent of the compressor implementation.
- **String round-trip (SECONDARY, caveated):** `encode(decode(s)) === s`
  byte-for-byte. Achievable only with deflate pinned to level 9 (verified for all
  9 fixtures with native zlib). Kept as a stricter check, explicitly dependent on
  the compressor matching zlib@9.
- **Compressor fidelity:** assert pako@level-9 reproduces each fixture's
  compressed bytes (gates whether the string-level check is even attainable).
- **Field-location:** decode assertions pinning known preset differences
  (Rich Resources richness = 2.0 on the six Nauvis resources; Marathon
  `technologyPriceMultiplier` = 4 - as a decode assertion, not a hard offset).
- **Absent-optional branch:** the fixtures are all-present (`01`) flags, so the
  `0x00` "field absent" path is unexercised by the corpus. Add a targeted encode/
  decode test (or capture a fixture that omits a field) so a bug there is caught.
- **float32 precision:** autoplace values are `float32` but the model uses JS
  `double`; a user value not representable in `float32` (e.g. richness 1.3) will
  round on encode. Test this explicitly so it is not mistaken for a codec bug.
- **Model/UI:** unit tests for catalog grouping, key ordinal-sort on encode, and
  store persistence.
- **E2E (optional, later):** Playwright, mirroring FBE.

## 11. Project structure

```
FactorioMapWebUI/
  index.html
  package.json                 # pnpm, vp scripts, node 24.18.0
  vite.config.ts               # defineConfig from 'vite-plus'
  tsconfig.json
  .node-version                # 24.18.0
  src/
    main.ts
    App.vue
    ui/                        # FPanel, FButton, FSlider, FDropdown, ...
    components/                # PresetBar, ResourcesTab, ..., PreviewPanel
    model/                     # types, planets, controlCatalog, defaults
    codec/                     # mapExchangeString, binaryReader/Writer, crc32
    store/                     # presets.ts (Pinia + localStorage)
    io/                        # zipExport, jsonExport, jsonImport
  test/
    fixtures/builtin-presets.json   # 9 verified 2.1.9.3 preset strings
    codec.spec.ts
  docs/superpowers/specs/
```

## 12. Phasing

Note: the model, `defaults.ts`, and the full field set are **derived by decoding
fixtures**, so decode work cannot be deferred to "after Phase 0." Decoding is the
low-risk half of the codec (already proven to work), so it leads.

- **Phase 0:** (a) codec **decode** + derive the model / catalog / `defaults.ts`
  from the fixtures; (b) scaffold with `vp create vue` and build the Factorio UI
  kit + the full editor wired to the in-memory model + localStorage presets.
  These two tracks are parallelizable. Result: a complete, usable, Factorio-
  styled editor over the real settings model - minus export.
- **Phase 1:** codec **encode** + round-trip tests (payload-level primary), the
  cliff-anomaly resolution, then **exports**: map-exchange string, and JSON/ZIP.
  JSON export is Phase 1 because it needs the full decoded field set AND the
  game's JSON schemas (Appendix A) - it cannot be completed in Phase 0.

## 13. Fixtures

`test/fixtures/builtin-presets.json` holds all 9 built-in presets (Default,
Rich Resources, Marathon, Death world, Death world marathon, Rail world, Ribbon
world, Lakes, Island) captured from Factorio 2.1.9, each verified to decode as
`2.1.9.3`, with a `_decodeStatus` block recording inflated size + version.

Note: map exchange strings are fragile under manual copy (a single interior
base64 char can be silently swapped, corrupting the zlib stream while passing
length/charset checks). Capture via `pbpaste > file` rather than pasting through
intermediaries. Additional single-setting diff fixtures will be gathered in
Phase 1 to pin non-autoplace field offsets.

## 14. Risks & open questions

- **Default cliff anomaly (open, blocking encoder trust):** Default carries an
  extra standalone `"cliff"` string the other presets lack (Section 4). Action:
  re-capture all 9 in one clean session via `pbpaste > file`, diff Default vs
  Rich Resources cliff bytes at the payload level, and determine the emission
  rule; pin it with a test.
- **Compression must match zlib@9:** byte-identical string export depends on the
  deflate stream matching the game's level-9 output. pako@9 is expected to match
  but is a separate implementation - gate with the compressor-fidelity test; the
  payload-level round-trip is the real guarantee if it diverges.
- **Experimental format drift:** 2.1.9 is experimental; the exchange layout may
  change between patches. Mitigation: version-aware codec keyed on the full
  4-tuple, fixtures tagged with the exact version.
- **Unconfirmed field offsets:** terrain / per-planet / map-settings byte
  offsets beyond autoplace (~55 unmapped bytes in Default, plus the typed tail)
  need more single-setting diff fixtures before the encoder is trustworthy.
  Round-trip tests are the gate.
- **Absent-optional path untested:** the corpus is all-present flags; the `0x00`
  branch needs a dedicated test or a fixture that omits a field.
- **Space-optimized varint:** observed counts (autoplace = 28, prop-expr dict)
  are plain `uint8`, NOT varint. Confirm where Factorio's varint actually applies
  (values > 255) before implementing it, or the encoder may wrongly varint a
  plain count and break round-trip.
- **JSON schemas undefined:** the game's `map-gen-settings.json` /
  `map-settings.json` shapes must be pinned (Appendix A) before JSON export/ZIP
  can claim validity (criterion #4).

## 15. Success criteria

1. **Primary:** all 9 fixtures round-trip at the **payload level** -
   `inflate(encode(decode(s)))` equals `inflate(s)`. **Secondary (caveated):**
   full-string byte-identity with deflate pinned to level 9.
2. A preset built in the UI exports an exchange string the real game accepts.
3. Full multi-planet editing works for all five planets via the control catalog.
4. Presets persist across reloads; ZIP export produces `map-gen-settings.json` /
   `map-settings.json` matching the Appendix A schemas.
5. `vp check` and `vp test` pass clean.

## Appendix A - Game JSON schemas (to pin in Phase 1)

The two files Factorio consumes (recoverable via `factorio
--dump-data` / the `/config` templates and the documented JSON format) must be
captured before JSON export is implemented. Known shape to confirm against a real
dump:

- `map-gen-settings.json`: `autoplace_controls` is **nested per control**
  (`{ "coal": { "frequency": 1, "size": 1, "richness": 1 }, ... }`, snake_case),
  plus `terrain_segmentation`, `water`, `cliff_settings`,
  `property_expression_names`, `starting_points`, `seed`, `width`, `height`,
  `autoplace_settings`, `default_enable_all_autoplace_controls`.
- `map-settings.json`: `pollution`, `enemy_evolution`, `enemy_expansion`,
  `steering`, `unit_group`, `path_finder`, `max_failed_behavior_count`, and
  `difficulty_settings` (where `technology_price_multiplier` lives).

Action: dump both from Factorio 2.1.9 and commit as `test/fixtures/` references,
then write the model->JSON mapping against them.

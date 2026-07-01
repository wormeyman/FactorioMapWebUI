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
- Payload starts with an **8-byte version header**: four `uint16` LE =
  `2.1.9.3`.
- `autoplace_controls` is a **single flat dictionary** keyed by control name,
  NOT nested per planet. Each entry = `uint8` name length + name bytes + three
  `float32` LE (frequency, size, richness). The Default preset has **28
  controls**. Planet association is encoded in the names (see catalog below).
- After autoplace: `property_expression_names`, cliff settings, then
  **MapSettings** (pollution / enemy_evolution / enemy_expansion / unit_group /
  path_finder / steering) encoded as **presence-byte + IEEE `float64` LE**
  optionals (a `01` present-flag precedes each value).
- Payload ends with a **CRC32** checksum of all preceding bytes.

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

Reference data (not user-editable):
- `planets.ts` - planet list + which controls/settings belong to each.
- `controlCatalog.ts` - `name -> { planet, category, label, hasRichness }`.
- `defaults.ts` - the Default preset, derived from the Default fixture.

## 6. Codec (`src/codec/`)

- `mapExchangeString.ts` - `decode` / `encode` orchestration + `>>>`/`<<<`
  envelope + base64.
- `binaryReader.ts` / `binaryWriter.ts` - little-endian primitives, Factorio
  space-optimized varints, length-prefixed strings, presence-byte optionals,
  the property-tree layout.
- `crc32.ts` - CRC32 (zlib/ANSI polynomial) over the payload.
- zlib via **`pako`**.

**Fixture-driven and version-aware.** The codec writes the `2.1.9.3` header;
because 2.1.9 is experimental, the reader tolerates and records the version so a
format shift is detectable rather than silently mis-parsed.

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

- **Round-trip (core):** for each of the 9 fixtures, `encode(decode(s))` must be
  **byte-identical** to `s`. This is the primary guarantee that the game accepts
  our output.
- **Field-location:** decode assertions pinning known preset differences
  (e.g. Rich Resources richness = 2.0 on the six Nauvis resources; Marathon
  `technologyPriceMultiplier` = 4).
- **Model/UI:** unit tests for catalog grouping and store persistence.
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

- **Phase 0 (no fixtures required):** scaffold with `vp create vue`; build the
  Factorio UI kit, settings model + defaults, the full UI wired to the in-memory
  model, JSON export/import, and localStorage presets. Result: a complete,
  usable, Factorio-styled editor - minus the exchange string.
- **Phase 1 (fixture-driven):** the map-exchange codec + ZIP export,
  reverse-engineered and round-trip-tested against the 9 captured fixtures.

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

- **Experimental format drift:** 2.1.9 is experimental; the exchange layout may
  change between patches. Mitigation: version-aware codec, fixtures tagged with
  the exact version.
- **Unconfirmed field offsets:** terrain / per-planet / map-settings byte
  offsets beyond autoplace need more single-setting diff fixtures before the
  encoder is trustworthy. Round-trip tests are the gate.
- **Space-optimized varint edge cases:** dictionary counts and large ints use
  Factorio's variable-length encoding; needs fixture coverage of values > 255.

## 15. Success criteria

1. All 9 fixtures round-trip byte-identically through `encode(decode(s))`.
2. A preset built in the UI exports an exchange string the real game accepts.
3. Full multi-planet editing works for all five planets via the control catalog.
4. Presets persist across reloads; ZIP export produces valid
   `map-gen-settings.json` / `map-settings.json`.
5. `vp check` and `vp test` pass clean.

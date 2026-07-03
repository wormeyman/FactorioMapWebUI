# Factorio Map WebUI - Phase 1c (Tail Typing + JSON/ZIP Export) Design

- **Date:** 2026-07-03
- **Status:** Approved for planning
- **Author:** Eric Johnson (with Claude)
- **Builds on:** `2026-07-01-factorio-map-webui-design.md` (overall design),
  `2026-07-02-factorio-map-webui-phase-1b-field-schema.md` (the declarative
  field-schema engine this phase extends).
- **Target:** Factorio **2.1.9 (experimental)**, map-exchange format tag `2.1.9.3`.

## 1. Summary

Phase 1c closes out the deferred bucket from Phase 1b: type the opaque tail
(cliff block + MapSettings), type the remaining corpus-proven mid-block fields
(`seed`, `starting_area`), resolve the Default cliff anomaly, and ship the JSON
exports (`map-gen-settings.json` + `map-settings.json`) as a downloadable ZIP.
It builds entirely on the Phase 1b declarative field-schema engine
(`src/codec/fieldSchema.ts`: `readFields` / `writeFields` over `{ name, type }`
descriptors) - no new codec architecture, just new `FieldType` kinds and two
richer schemas.

## 2. Byte-layout findings (this is what unblocked the phase)

Cracked 2026-07-03 by programmatic byte-diffing of the 9 built-in fixtures plus
two captured single-setting diff strings.

### Default cliff anomaly - RESOLVED

Exact common-prefix / common-suffix diff of `Default.tail` vs
`Rich Resources.tail`: `commonPrefix = 0`, `commonSuffix = 635`, and the only
differing bytes are:

- Default middle: `05 63 6c 69 66 66` - a length-prefixed string `"cliff"`.
- Rich middle: `00` - a length-prefixed **empty** string `""`.

`641 - 636 = 5 = (6 - 1)`. **The tail opens with a length-prefixed cliff-name
string.** Default carries `"cliff"`, all eight others carry `""`. There is no
conditional/interned emission rule to reverse-engineer: `readString` /
`writeString` round-trips both cases byte-exact for free. Semantically, empty
means "use the prototype default name `cliff`" - a JSON-mapping concern, not an
encoder concern. Pinned by a test: `Default` cliff name `=== "cliff"`, every
other preset `=== ""`.

### Mid-block (55 B) - seed and starting_area pinned

```
opaque(2) = 00 01 | seed u32 @2 | width u32 @6 | height u32 @10 | opaque(24) | starting_area f32 @38 | opaque(13)
```

Fixed widths still sum to 55 (2 + 4 + 4 + 4 + 24 + 4 + 13). Proof:

- **seed = u32 @ mid+2.** Setting the GUI seed to `123456789` (`0x075BCD15`) made
  mid+2 read exactly `15 cd 5b 07`; Default's is `80 da 10 02` (34,527,360, a
  baked random seed - not 0 as earlier guessed).
- **starting_area = f32 @ mid+38** (rest offset 24). Default `00 00 80 3f` (1.0);
  bumped one notch up = `ab aa aa 3f` (1.3333334 = 4/3). This resolves the old
  "float@38 varies 1.0/0.75/3.0" mystery - it was `starting_area`, not terrain
  scale.

The residual `opaque(24)` + `opaque(13)` spans hold `autoplace_settings`
`treat_missing_as_default` flags, `starting_points`, and the
`peaceful_mode` / `no_enemies_mode` bools - all default (false / present) across
the entire corpus, so they stay opaque this phase and JSON emits their known
defaults (see Section 5).

### Tail - structurally legible, no further fixtures needed

After the cliff-name string come the cliff `float32`s (`00 00 20 41` = 10.0
`cliff_elevation_0`, `00 00 20 42` = 40.0 `cliff_elevation_interval`, then
richness/smoothing floats), then MapSettings as an unambiguous run of
**presence-byte optionals** and **counted arrays**, in the field order given by
`map-settings.example.json`:

- `01 <f64>` - present optional f64 (e.g. `01 7b 14 ae 47 e1 7a 94 3f` = `0.02`,
  pollution `diffusion_ratio`).
- `01 <u32>` - present optional u32 (e.g. `01 05 00 00 00` = `5`).
- `<u32 count> <values...>` - counted arrays (path_finder `overload_levels` /
  `overload_multipliers`).

Rail world shows a `01` -> `00` presence-byte flip, so the absent-optional branch
**is** exercised by the corpus. The tail is typed by structural reasoning against
the Default dump and the example.json field order; the round-trip corpus gates
correctness.

## 3. Scope

**In scope:**
1. Extend `FieldType` with `"bool"`, `{ optional: FieldType }`,
   `{ array: FieldType }`; keep `readFields` / `writeFields` the single source of
   truth for both decode and encode.
2. Type `seed` and `starting_area` in `MID_BLOCK_SCHEMA`.
3. New `TAIL_SCHEMA` typing the cliff block + full MapSettings; resolve the cliff
   anomaly as its first (string) field. `DecodedExchange`/`EncodableExchange`
   `tail: Uint8Array` becomes `tail: TailBlock`.
4. Surface `seed`, `startingArea`, `cliffSettings`, and typed `mapSettings` on the
   `Preset` model + `convert.ts`.
5. `src/io/jsonExport.ts` - build `map-gen-settings.json` + `map-settings.json`
   matching the example.json schemas.
6. `src/io/zipExport.ts` - bundle both JSONs + the exchange-string `.txt` via
   **JSZip** (new dependency).
7. UI: `seed` + `starting_area` inputs; wire the existing action-bar
   "Download ZIP" button.

**Out of scope (deferred):**
- Per-field editing of individual MapSettings values in the UI. v1 round-trips
  and exports them faithfully; a dedicated MapSettings editor is a later phase.
- JSON **import** (upload `.json`). Export only this phase (spec Section 8 lists
  import as a separate capability).
- Cracking `peaceful_mode` / `no_enemies_mode` / `starting_points` /
  `autoplace_settings` flags out of the mid-block opaque spans - needs more diff
  fixtures; all are default across the corpus, so deferred without loss.

## 4. Architecture

Unchanged from the layered design. The only new layer touched is `src/io/`
(JSON + ZIP), which reads the typed model and has zero codec dependency beyond
the exchange string it embeds. The codec stays Vue-free and fixture-tested.

```
UI (seed/starting_area inputs, Download ZIP button)
  | reads/writes
Preset model (+ seed, startingArea, cliffSettings, mapSettings)
  | (de)serialized by
Codec: fieldSchema (+ bool/optional/array), MID_BLOCK_SCHEMA, TAIL_SCHEMA
IO: jsonExport (model -> 2 JSON files), zipExport (JSZip bundle)
```

### FieldType extension

```ts
type FieldType =
  | "u8" | "u16" | "u32" | "f32" | "f64" | "string" | "bool"
  | { opaque: number }
  | { optional: FieldType }   // presence u8 (0/1); value follows iff 1
  | { array: FieldType };     // u32 count; then count x value
```

`FieldValue` widens to `number | string | boolean | Uint8Array | null | FieldValue[]`
(optional-absent -> `null`; array -> `FieldValue[]`). Nested-object fields
(cliff, each MapSettings section) are expressed as their own sub-schemas walked by
the same `readFields` / `writeFields`, so there is still exactly one walker pair.

## 5. JSON export fidelity

- `map-settings.json`: **fully faithful** - every field decoded from the typed
  tail.
- `map-gen-settings.json`: faithful for `autoplace_controls`, `seed`, `width`,
  `height`, `starting_area`, `cliff_settings`, `property_expression_names`. The
  still-opaque mid-block fields (`peaceful_mode`, `no_enemies_mode`,
  `starting_points`, `autoplace_settings`) are emitted at their corpus-constant
  defaults (`false` / `[{x:0,y:0}]` / `treat_missing_as_default: true`), which is
  correct for every fixture we have. Documented as a known limitation until those
  offsets are cracked.

## 6. Testing strategy

Byte-exactness is guaranteed by construction (writeFields is the inverse of
readFields) and gated by the **existing 9-fixture payload + string round-trips**,
which must stay green through every task. On top of that, this phase adds
semantic cross-checks the corpus provides for free:

- **Cliff anomaly:** `decode(Default)` cliff name `=== "cliff"`; all others `=== ""`.
- **seed / starting_area offsets:** `decode(seed-123456789).seed === 123456789`;
  `decode(starting-area-diff).startingArea` ~= `1.3333334` (f32 tolerance).
- **MapSettings defaults:** `decode(Default).mapSettings` deep-equals the
  `map-settings.example.json` defaults (float tolerance).
- **MapSettings variation:** `Marathon.difficulty.technologyPriceMultiplier === 4`
  (bytes: `f0 3f` -> `10 40`, 1.0 -> 4.0); Death world's `enemy_evolution` /
  `enemy_expansion` factors differ from Default.
- **JSON export:** generated `map-settings.json` for Default deep-equals the
  example.json defaults; ZIP contains the three expected entries.
- **New FieldType kinds:** unit tests for `optional` (present + absent branches)
  and `array` round-trip in `fieldSchema.spec.ts`.

## 7. Fixtures (committed as tracked ground truth)

`test/fixtures/`: `README.md`, `map-gen-settings.example.json`,
`map-settings.example.json`, `map-gen-settings.default-nauvis.dump.json`,
`seed-123456789.txt`, `starting-area-diff.txt`. `vite.config.ts` already excludes
`test/fixtures/**` from `vp check --fix`, so they stay byte-for-byte as captured.

## 8. Execution shape

One Phase 1c plan with a **codec-first checkpoint**: the codec + model half (tail
typing, seed/starting_area, cliff anomaly, model/convert) reaches a green
round-trip + semantic-test checkpoint before the IO + UI half (JSON, ZIP, inputs,
Download button). One merge at the end, one natural mid-point review. New
dependency: JSZip.

## 9. Risks

- **Tail schema mis-fit:** a wrong field type mid-tail would shift every
  subsequent offset. Mitigation: byte round-trip catches any drift immediately
  (worst case a stubborn region stays an `opaque` span and its JSON fields fall
  back to defaults), and the MapSettings-defaults deep-equal test catches
  semantic mis-parses even where bytes happen to round-trip.
- **JSZip + strict CSP:** JSZip is pure JS (no eval), so unlike the zlib-asm note
  it does not add CSP risk; still, verify the ZIP builds in the browser bundle.
- **Float precision in JSON:** tail f32/f64 values are exact on the wire; JSON
  numbers are f64, so f32 cliff values may render with long mantissas. Emit them
  as-is (the game re-parses to f32); note it so it is not mistaken for a bug.

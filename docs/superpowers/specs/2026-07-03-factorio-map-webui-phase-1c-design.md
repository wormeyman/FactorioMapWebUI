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
  mid+2 read exactly `15 cd 5b 07`; Default's is `80 da 10 02` (`0x0210DA80` =
  34,658,944, a baked random seed - not 0 as earlier guessed). This is the
  preset's baked seed and is distinct from the live dump's `seed: 3394390023`,
  which is a different map instance.
- **starting_area = f32 @ mid+38** (rest offset 24). Default `00 00 80 3f` (1.0);
  bumped one notch up = `ab aa aa 3f` (1.3333334 = 4/3). This resolves the old
  "float@38 varies 1.0/0.75/3.0" mystery - it was `starting_area`, not terrain
  scale.

The residual `opaque(24)` + `opaque(13)` spans hold `autoplace_settings`
`treat_missing_as_default` flags, `starting_points`, and the
`peaceful_mode` / `no_enemies_mode` bools - all default (false / present) across
the entire corpus, so they stay opaque this phase and JSON emits their known
defaults (see Section 5).

### Cliff block

The tail opens with the cliff block:

```
name: string | control: string | elevation_0 f32 | elevation_interval f32 | f32 | richness f32 | 00
```

Verified from Rich Resources tail `[0..18]`: `00`(name len 0) `00`(control len 0)
`00 00 20 41`(10.0) `00 00 20 42`(40.0) `00 00 80 3f`(1.0) `00 00 80 3f`(1.0) `00`.
Both strings are empty across the corpus except Default's `name = "cliff"`. The
live dump's `cliff_settings.control = "nauvis_cliff"`, so `control` is a real
second length-prefixed string (empty on the wire because the presets don't
materialize it). The exact meaning of the two `1.0` floats and the lone `00` byte
at `[18]` is nailed during implementation by round-trip + matching against the
dump's `cliff_settings` values; the JSON `cliff_settings` needs `name`, `control`,
`cliff_elevation_0`, `cliff_elevation_interval`, `cliff_smoothing`, `richness`.

### MapSettings - reverse-engineered wire order (NOT example.json order)

After the cliff block comes MapSettings, a flat run of presence-byte optionals,
bare bools, and counted arrays. **The wire order is Factorio's own C++
serialization order, which does NOT match the field order in
`map-settings.example.json`** - e.g. `pollution.diffusion_ratio` (`0.02`) sits at
tail offset ~22 (near the start) while `difficulty_settings.
technology_price_multiplier` sits at tail offset ~606 (near the end), the reverse
of the example.json layout where `difficulty_settings` is first. The example.json
gives field **names, value types, and default values** - not order. The
implementer derives the wire order byte-by-byte, section by section, gated by the
round-trip corpus and the Default-equals-defaults test (Section 6).

Byte patterns observed:
- `01 <f64>` - present optional f64 (e.g. `01 7b 14 ae 47 e1 7a 94 3f` = `0.02`).
- `01 <u32>` - present optional u32 (e.g. `01 05 00 00 00` = `5`).
- `<u32 count> <values...>` - counted arrays (path_finder `overload_levels` /
  `overload_multipliers`).
- bare bools (`00`/`01`) for `pollution.enabled`, `path_finder.use_path_cache`,
  etc.

**Central RE risk:** a bare bool and an optional's presence byte are both a lone
`00`/`01` and are indistinguishable without knowing which field is at that offset.
Disambiguation therefore depends on the reverse-engineered wire order, not on the
byte pattern alone. Rail world shows a `01` -> `00` flip, confirming the
absent-optional branch is exercised by the corpus. No further fixtures are needed
(byte-exactness is guaranteed regardless), but the tail-typing task is genuine
reverse-engineering, not transcription.

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
(optional-absent -> `null`; array -> `FieldValue[]`).

**No nested-object FieldType is added.** `TAIL_SCHEMA` is a single **flat**
ordered field list whose names are dotted to encode section membership (e.g.
`"pollution.diffusionRatio"`, `"pathFinder.overloadLevels"`). This mirrors the
wire, which is itself flat (presence byte + value, in sequence), so `readFields` /
`writeFields` stay exactly one walker pair with no new recursion. `readFields`
returns a flat `Record<string, FieldValue>`; the nested `Preset.mapSettings` /
`cliffSettings` shape is assembled from the dotted keys in `convert.ts`, not in the
codec. This keeps the codec's "one flat schema, one walker pair" property from
Phase 1b intact.

## 5. JSON export fidelity

- `map-settings.json`: **faithful for every field that types cleanly** - decoded
  from the typed tail. If any tail region resists typing it stays an `opaque` span
  (byte round-trip still holds) and its JSON fields fall back to the example.json
  defaults, same as the mid-block fields below. The goal is zero residual opaque
  MapSettings; the Default-equals-defaults test (Section 6) is the pass/fail gate
  on that goal.
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
  (the sole Rich-vs-Marathon tail diff is the f64 at tail offset ~606, bytes
  `f0 3f` -> `10 40` = 1.0 -> 4.0); `Death world.enemyEvolution.timeFactor` differs
  from Default (Rich-vs-Death tail diffs are localized to the evolution region,
  ~offsets 123-147). Assert the specific decoded fields, not a broad "factors
  differ".
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

- **Tail wire-order reverse-engineering (primary risk):** MapSettings wire order
  is Factorio's C++ order, not example.json order, and bare bools are
  indistinguishable from optional presence bytes at the byte level (Section 2). A
  wrong field type mid-tail shifts every subsequent offset. Mitigation: byte
  round-trip catches any drift immediately (worst case a stubborn region stays an
  `opaque` span and its JSON fields fall back to defaults); the
  Default-equals-example.json-defaults deep-equal test catches semantic
  mis-parses even where bytes happen to round-trip; and the Marathon / Death world
  variation tests pin specific fields. Type the tail section-by-section
  (pollution -> evolution -> expansion -> unit_group -> path_finder -> difficulty
  -> asteroids -> max_failed, per the real byte order), keeping untyped regions as
  `opaque` spans so the round-trip stays green at every step.
- **JSZip + strict CSP:** JSZip is pure JS (no eval), so unlike the zlib-asm note
  it does not add CSP risk; still, verify the ZIP builds in the browser bundle.
- **Float precision in JSON:** tail f32/f64 values are exact on the wire; JSON
  numbers are f64, so f32 cliff values may render with long mantissas. Emit them
  as-is (the game re-parses to f32); note it so it is not mistaken for a bug.

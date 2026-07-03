# Factorio Map WebUI - Phase 1c (Tail Typing + JSON/ZIP Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type the opaque tail (cliff block + MapSettings) and the remaining corpus-proven mid-block fields (seed, starting_area), resolve the Default cliff anomaly, and ship `map-gen-settings.json` + `map-settings.json` as a downloadable ZIP - all while keeping every fixture's byte-exact round-trip intact.

**Architecture:** Extend the Phase 1b declarative field-schema engine (`src/codec/fieldSchema.ts`: `readFields`/`writeFields`) with three new `FieldType` kinds - `"bool"`, `{ optional: FieldType }`, `{ array: FieldType }`. Type the mid-block's `seed`/`starting_area` and introduce a flat `TAIL_SCHEMA` (dotted field names, no nesting) that walks the cliff block then MapSettings section by section. Every schema ends with a trailing `{ opaque: N }` span, so byte-exact round-trip holds at every step; sections are peeled off that span one task at a time, each gated by the 9-fixture round-trip AND a semantic "decode(Default) equals the example.json defaults" check. The nested `Preset.cliffSettings`/`mapSettings` shape is assembled from the flat dotted keys in `convert.ts`; the codec stays flat and Vue-free. Finally, `src/io/` builds the two JSON files and a JSZip bundle, and the UI wires seed/starting_area inputs and the Download ZIP button.

**Tech Stack:** TypeScript, Vue 3, Pinia, the Vite+ (`vp`) toolchain, JSZip (new dependency). Tests import from `vite-plus/test`.

## Global Constraints

- Target game version **Factorio 2.1.9 (experimental)**, map-exchange format tag **2.1.9.3**. Do not change the version-tuple handling.
- **Byte-exact round-trip is non-negotiable.** The gate is the existing payload round-trip (`encodePayload(decode(s))` byte-equals `decode(s).payload`) and string round-trip (`encodeExchangeString(decode(s)) === s`) for all 9 fixtures in `test/encode.spec.ts`. Every task must leave `vp test` green on these.
- **The mid-block is exactly 55 bytes.** Its schema's fixed widths MUST sum to 55.
- **The tail is a flat byte region.** `TAIL_SCHEMA` fixed+opaque widths must always account for the full tail (636 bytes for 8 presets, 641 for Default because its cliff name is `"cliff"` not `""`). Because the cliff name is variable-length, never assert a fixed tail length; assert field VALUES and the round-trip.
- **All little-endian.** Reuse `BinaryReader`/`BinaryWriter`; never hand-roll `DataView` reads in new code.
- **Run commands with `pnpm vp ...`** (the machine's bare `vp`/`npm` may fail devEngines). Tests: `pnpm vp test <name> --run`. Lint/format: `pnpm vp check --fix`.
- Tests import from `vite-plus/test`, never `vitest`.
- Use hyphens (`-`), not em/en dashes, in prose and comments.
- Fixtures under `test/fixtures/` are committed ground truth and excluded from formatting; never rewrite them.

---

## Ground-truth reference: the tail byte layout

All offsets below are into the **Default** tail (`decode("Default").tail`, length 641). The Default cliff name is `"cliff"` (bytes `05 63 6c 69 66 66`); the other 8 presets open with `00` (empty name), shifting every subsequent offset down by 5. Values were located by matching `map-settings.example.json` defaults against the bytes.

**Cliff block** (tail start): `name:string`(`05 "cliff"`), `control:string`(`00` empty), then four `f32`: `10.0` (`cliff_elevation_0`, @7), `40.0` (`cliff_elevation_interval`, @11), `1.0` (@15), `1.0` (`richness`, @19), then a lone `00` byte (@23). The dump's `cliff_settings` is `{name:"cliff", control:"nauvis_cliff", cliff_elevation_0:10, cliff_elevation_interval:40, cliff_smoothing:0, richness:1}`; reconcile the two `1.0` floats + lone byte against those names during Task 4 via round-trip (the wire carries `10,40,1,1` not `10,40,0,1`, so `cliff_smoothing` is not a plain `0.0` float in that run - determine its encoding).

**MapSettings** begins ~@24. Each optional scalar is `01`(presence) + value. Section value order + the Default-tail f64/u32 offset of each value (presence byte is the offset minus 1):

- **pollution** (all f64): diffusion_ratio 0.02@27, min_to_diffuse 15@36, ageing 1@45, expected_max_per_chunk 150@54, min_to_show_per_chunk 50@63, min_pollution_to_damage_trees 60@72, pollution_with_max_forest_damage 150@81, pollution_per_tree_damage 50@90, pollution_restored_per_tree_damage 10@99, max_pollution_to_restore_trees 20@108, enemy_attack_pollution_consumption_modifier 1@117. (Preceded by an `enabled` bool.)
- **enemy_evolution** (all f64): time_factor 4e-6@128, destroy_factor 0.002@137, pollution_factor 9e-7@146. (Preceded by an `enabled` bool.)
- **enemy_expansion**: max_expansion_distance u32 5@157, min_expansion_distance u32 3@162, friendly_base_influence_radius u32 6@167, enemy_building_influence_radius u32 3@172, building_coefficient f64 0.5@177, other_base_coefficient f64 3.0@186, neighbouring_chunk_coefficient f64 0.5@195, neighbouring_base_chunk_coefficient f64 0.5@204, max_colliding_tiles_coefficient f64 0.8@213, settler_group_min_size u32 5@222, settler_group_max_size u32 20@227, evolution_group_size_factor f64 4.0@232, min_expansion_cooldown u32 14400, max_expansion_cooldown u32 216000@246. (Preceded by an `enabled` bool. NOTE: the `14400` value was not located by a naive u32 scan - resolve `min_expansion_cooldown`'s exact encoding/offset via round-trip; it sits between @232 and @246.)
- **unit_group**: min_group_gathering_time u32 3600@251, max_group_gathering_time u32 36000@256, max_wait_time_for_late_members u32 7200@261, max_group_radius f64 30.0@266, min_group_radius f64 5.0@275, max_member_speedup_when_behind f64 1.4@284, max_member_slowdown_when_ahead f64 0.6@293, max_group_slowdown_factor f64 0.3@302, max_group_member_fallback_factor u32 3@311, member_disown_distance u32 10@320, tick_tolerance_when_member_arrives u32 60@329, max_gathering_unit_groups u32 30@334, max_unit_group_size u32 200@339. (NOTE: there is an extra u32 36000@241 before @246 - it belongs to unit_group/expansion boundary; resolve alignment via round-trip.)
- **path_finder**: fwd2bwd_ratio u32 5@344, goal_pressure_ratio f64 2.0@349, max_steps_worked_per_tick u32 1000, max_work_done_per_tick u32 8000@369, use_path_cache bool, short_cache_size u32 5, long_cache_size u32 25@379, short_cache_min_cacheable_distance u32 10@384, short_cache_min_algo_steps_to_cache u32 50@393, long_cache_min_cacheable_distance u32 30@398, cache_max_connect_to_cache_steps_multiplier u32 100@407, cache_accept_path_start_distance_ratio f64 0.2@412, cache_accept_path_end_distance_ratio f64 0.15@421, negative_cache_accept_path_start_distance_ratio f64 0.3@430, negative_cache_accept_path_end_distance_ratio f64 0.3@439, cache_path_start_distance_rating_multiplier u32 10@448, cache_path_end_distance_rating_multiplier u32 20@457, stale_enemy_with_same_destination_collision_penalty f64 30.0@466, ignore_moving_enemy_collision_distance f64 5.0@475, enemy_with_different_destination_collision_penalty f64 30.0@484, general_entity_collision_penalty f64 10.0@493, general_entity_subsequent_collision_penalty f64 3.0@502, extended_collision_penalty f64 3.0@511, max_clients_to_accept_any_new_request u32 10@520, max_clients_to_accept_short_new_request u32 100@525, direct_distance_to_consider_short_request u32 100@530, short_request_max_steps u32 1000@535, short_request_ratio f64 0.5@540, min_steps_to_check_path_find_termination u32 2000@549, start_to_goal_cost_multiplier_to_terminate_path_find f64 2000.0@554, **overload_levels array<u32> [0,100,500]@~568**, **overload_multipliers array<u32> [2,3,4]@~586**, negative_path_cache_delay_interval u32 20@603. (Arrays: `<u32 count> <values>` at ~568 and ~586 - the raw bytes are `... 03 00 00 00 <3 u32s> ... 03 00 00 00 <3 u32s> ...`; nail via the `{ array: "u32" }` FieldType + round-trip.)
- **difficulty_settings** (near tail end): technology_price_multiplier f64 1.0@611 (Marathon flips this to 4.0 - bytes `f0 3f`->`10 40` at @617), spoil_time_modifier f64 1.0@619.
- **asteroids**: spawning_rate f64 1.0@628, max_ray_portals_expanded_per_tick u32 100@637.
- **max_failed_behavior_count**: u32 3 (tail end).

Bare bools (`00`/`01`) and optional presence bytes are byte-identical; the section preambles (`enabled` bools) and the exact bool-vs-optional choice per field are resolved by round-trip + the defaults-check at each step. Because a trailing `{ opaque: N }` span always closes `TAIL_SCHEMA`, round-trip stays byte-exact no matter how far typing has progressed.

---

## File Structure

- `src/codec/fieldSchema.ts` (modify) - add `"bool"`, `{ optional }`, `{ array }` to `FieldType`; widen `FieldValue`; extend `readOne`/`writeOne`. One responsibility: bidirectional byte<->object walk of a flat schema.
- `src/codec/mapExchangeString.ts` (modify) - add `seed`/`startingArea` to `MID_BLOCK_SCHEMA`; introduce `TAIL_SCHEMA` + `TailBlock`; change `DecodedExchange.tail`/`EncodableExchange.tail` from `Uint8Array` to `TailBlock`.
- `src/model/types.ts` (modify) - add typed `seed`, `startingArea`, `cliffSettings`, `mapSettings` to `Preset`; drop `opaqueTailB64`; keep an `opaqueTailRestB64` for any residual opaque tail span.
- `src/model/mapSettings.ts` (create) - the typed `MapSettings` + `CliffSettings` interfaces and the flat-dotted-key <-> nested-object mapping (`tailToNested` / `nestedToTail`). One responsibility: shape translation, no bytes.
- `src/model/convert.ts` (modify) - wire seed/starting_area and call the mapSettings mapper in both directions.
- `src/io/jsonExport.ts` (create) - `toMapGenSettingsJson(preset)` + `toMapSettingsJson(preset)`.
- `src/io/zipExport.ts` (create) - `buildZip(preset)` -> `Blob` via JSZip.
- `src/components/PresetBar.vue` (modify) - seed input now always numeric (real u32).
- `src/components/AdvancedTab.vue` (modify) - add a starting_area input.
- `src/components/ActionBar.vue` (modify) - enable + wire the Download ZIP button.
- `test/fieldSchema.spec.ts`, `test/decode.spec.ts`, `test/encode.spec.ts`, `test/store.spec.ts`, `test/jsonExport.spec.ts` (create), `test/zipExport.spec.ts` (create), `test/actionBar.spec.ts`, `test/advancedTab.spec.ts`, `test/presetBar.spec.ts` - tests.

---

## Task 1: FieldType extension (bool / optional / array)

**Files:**
- Modify: `src/codec/fieldSchema.ts`
- Test: `test/fieldSchema.spec.ts`

**Interfaces:**
- Consumes: `BinaryReader` (`readUint8`, `readUint32`, ...), `BinaryWriter` (`writeUint8`, `writeUint32`, ...).
- Produces:
  - `FieldType` gains `"bool"`, `{ optional: FieldType }`, `{ array: FieldType }`.
  - `FieldValue = number | string | boolean | Uint8Array | null | FieldValue[]`.
  - `readFields` / `writeFields` signatures unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/fieldSchema.spec.ts`:

```ts
describe("bool / optional / array field types", () => {
  it("reads and writes bool", () => {
    const schema: Schema = [{ name: "a", type: "bool" }, { name: "b", type: "bool" }];
    const bytes = new Uint8Array([0x01, 0x00]);
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["a"]).toBe(true);
    expect(out["b"]).toBe(false);
    const w = new BinaryWriter();
    writeFields(w, schema, out);
    expect(w.toBytes()).toEqual(bytes);
  });

  it("reads a present optional (presence 01 + value) and round-trips", () => {
    const schema: Schema = [{ name: "x", type: { optional: "f64" } }];
    // 01 + f64 1.5
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f]);
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["x"]).toBe(1.5);
    const w = new BinaryWriter();
    writeFields(w, schema, out);
    expect(w.toBytes()).toEqual(bytes);
  });

  it("reads an absent optional (presence 00, no value) and round-trips", () => {
    const schema: Schema = [{ name: "x", type: { optional: "u32" } }, { name: "y", type: "u8" }];
    // 00 (absent) then y = 7
    const bytes = new Uint8Array([0x00, 0x07]);
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["x"]).toBeNull();
    expect(out["y"]).toBe(7);
    const w = new BinaryWriter();
    writeFields(w, schema, out);
    expect(w.toBytes()).toEqual(bytes);
  });

  it("reads an array (u32 count + values) and round-trips", () => {
    const schema: Schema = [{ name: "arr", type: { array: "u32" } }];
    // count 3, then 0,100,500
    const bytes = new Uint8Array([
      0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xf4, 0x01, 0x00, 0x00,
    ]);
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["arr"]).toEqual([0, 100, 500]);
    const w = new BinaryWriter();
    writeFields(w, schema, out);
    expect(w.toBytes()).toEqual(bytes);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test fieldSchema --run`
Expected: FAIL - `"bool"` / `optional` / `array` not handled (type errors + runtime).

- [ ] **Step 3: Implement**

In `src/codec/fieldSchema.ts`, replace the `FieldType` and `FieldValue` declarations:

```ts
export type FieldType =
  | "u8"
  | "u16"
  | "u32"
  | "f32"
  | "f64"
  | "string"
  | "bool"
  | { opaque: number }
  | { optional: FieldType }
  | { array: FieldType };

export type FieldValue = number | string | boolean | Uint8Array | null | FieldValue[];
```

Replace `readOne`:

```ts
function readOne(reader: BinaryReader, type: FieldType): FieldValue {
  if (typeof type === "object") {
    if ("opaque" in type) return reader.readBytes(type.opaque);
    if ("optional" in type) {
      return reader.readUint8() === 0 ? null : readOne(reader, type.optional);
    }
    // array
    const count = reader.readUint32();
    const items: FieldValue[] = [];
    for (let i = 0; i < count; i++) items.push(readOne(reader, type.array));
    return items;
  }
  switch (type) {
    case "u8":
      return reader.readUint8();
    case "u16":
      return reader.readUint16();
    case "u32":
      return reader.readUint32();
    case "f32":
      return reader.readFloat32();
    case "f64":
      return reader.readFloat64();
    case "string":
      return reader.readString();
    case "bool":
      return reader.readUint8() !== 0;
  }
}
```

Replace `writeOne`:

```ts
function writeOne(writer: BinaryWriter, type: FieldType, value: FieldValue): void {
  if (typeof type === "object") {
    if ("opaque" in type) {
      writer.writeBytes(value as Uint8Array);
      return;
    }
    if ("optional" in type) {
      if (value === null || value === undefined) {
        writer.writeUint8(0);
        return;
      }
      writer.writeUint8(1);
      writeOne(writer, type.optional, value);
      return;
    }
    // array
    const items = value as FieldValue[];
    writer.writeUint32(items.length);
    for (const item of items) writeOne(writer, type.array, item);
    return;
  }
  switch (type) {
    case "u8":
      writer.writeUint8(value as number);
      return;
    case "u16":
      writer.writeUint16(value as number);
      return;
    case "u32":
      writer.writeUint32(value as number);
      return;
    case "f32":
      writer.writeFloat32(value as number);
      return;
    case "f64":
      writer.writeFloat64(value as number);
      return;
    case "string":
      writer.writeString(value as string);
      return;
    case "bool":
      writer.writeUint8(value ? 1 : 0);
      return;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test fieldSchema --run`
Expected: PASS - all new and existing engine tests green.

- [ ] **Step 5: Commit**

```bash
git add src/codec/fieldSchema.ts test/fieldSchema.spec.ts
git commit -m "feat: add bool/optional/array field-schema kinds"
```

---

## Task 2: Type seed + starting_area in the mid-block

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`, `test/encode.spec.ts`

**Interfaces:**
- Consumes: `readFields`/`writeFields`/`Schema`/`FieldValue` (Task 1, unchanged usage).
- Produces:
  - `MidBlock` gains `seed: number` and `startingArea: number`; `opaqueHead` shrinks to 2 bytes, `opaqueRest` splits to `opaqueRestA(24)` + `startingArea` + `opaqueRestB(13)`.
  - Full mid interface: `{ opaqueHead: Uint8Array(2); seed: number; width: number; height: number; opaqueRestA: Uint8Array(24); startingArea: number; opaqueRestB: Uint8Array(13) }`.

- [ ] **Step 1: Write the failing tests**

In `test/decode.spec.ts`, add:

```ts
  it("types seed and starting_area from the mid-block", () => {
    const mid = decodeExchangeString(presets["Default"] as string).mid;
    expect(mid.seed).toBe(34658944); // 0x0210DA80, Default's baked seed
    expect(mid.startingArea).toBeCloseTo(1.0, 6);
    expect(mid.opaqueHead.length).toBe(2);
    expect(mid.opaqueRestA.length).toBe(24);
    expect(mid.opaqueRestB.length).toBe(13);
  });
```

In `test/encode.spec.ts`, add inside the `encodePayload` describe:

```ts
  it("round-trips an edited seed and starting_area through the mid schema", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const edited = {
      ...decoded,
      mid: { ...decoded.mid, seed: 123456789, startingArea: Math.fround(1.3333334) },
    };
    const re = decodeExchangeString(
      `>>>${bytesToBase64(deflateLevel9(encodePayload(edited)))}<<<`,
    );
    expect(re.mid.seed).toBe(123456789);
    expect(re.mid.startingArea).toBeCloseTo(1.3333334, 5);
  });
```

(If `bytesToBase64`/`deflateLevel9` are not yet imported in `encode.spec.ts`, add
`import { bytesToBase64 } from "../src/codec/base64";` and
`import { deflateLevel9 } from "../src/codec/deflate";`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode encode --run`
Expected: FAIL - `mid.seed`/`mid.startingArea`/`opaqueRestA` undefined.

- [ ] **Step 3: Implement**

In `src/codec/mapExchangeString.ts`, replace the `MidBlock` interface:

```ts
export interface MidBlock {
  /** 2 opaque bytes before seed (00 01 in every fixture). */
  opaqueHead: Uint8Array;
  /** Map generation seed (u32 LE at mid offset 2). */
  seed: number;
  /** Map width in tiles (u32 LE at mid offset 6). */
  width: number;
  /** Map height in tiles (u32 LE at mid offset 10). */
  height: number;
  /** 24 opaque bytes between height and starting_area (autoplace_settings flags, starting_points; unmapped). */
  opaqueRestA: Uint8Array;
  /** Starting-area size scale (f32 LE at mid offset 38). */
  startingArea: number;
  /** 13 opaque bytes after starting_area (peaceful/no_enemies bools; unmapped). */
  opaqueRestB: Uint8Array;
}
```

Replace `MID_BLOCK_SCHEMA` (widths sum to 55: 2+4+4+4+24+4+13):

```ts
export const MID_BLOCK_SCHEMA: Schema = [
  { name: "opaqueHead", type: { opaque: 2 } },
  { name: "seed", type: "u32" },
  { name: "width", type: "u32" },
  { name: "height", type: "u32" },
  { name: "opaqueRestA", type: { opaque: 24 } },
  { name: "startingArea", type: "f32" },
  { name: "opaqueRestB", type: { opaque: 13 } },
];
```

No change is needed to the decode/encode call sites (`readFields`/`writeFields` already drive the mid-block). Confirm `MID_BLOCK_LENGTH` / `MIN_PAYLOAD_LENGTH` constants still reflect 55 (they are structural, not per-field, so unchanged).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - new seed/starting_area tests green AND the existing 9-fixture round-trips still green (the mid bytes are re-emitted identically).

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts test/encode.spec.ts
git commit -m "feat: type mid-block seed and starting_area"
```

---

## Task 3: Tail infrastructure + resolve the cliff anomaly (name/control strings)

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`, `test/encode.spec.ts`

**Interfaces:**
- Consumes: `readFields`/`writeFields`, `Schema`.
- Produces:
  - `interface TailBlock` (flat, keyed by dotted names). Initially: `{ "cliff.name": string; "cliff.control": string; opaqueTail: Uint8Array }`.
  - `TAIL_SCHEMA: Schema` - grows across Tasks 4-8; always ends with `{ name: "opaqueTail", type: { opaque: N } }` where N is "the rest".
  - `DecodedExchange.tail: TailBlock` and `EncodableExchange.tail: TailBlock` (replacing `Uint8Array`).

This task types ONLY the two leading cliff strings (which is what makes the Default cliff anomaly disappear) and leaves everything after them as one opaque span. Because the schema's opaque tail absorbs all remaining bytes, round-trip stays byte-exact.

- [ ] **Step 1: Write the failing tests**

In `test/decode.spec.ts`:

```ts
  it("resolves the cliff anomaly: Default cliff name is 'cliff', others are ''", () => {
    expect(decodeExchangeString(presets["Default"] as string).tail["cliff.name"]).toBe("cliff");
    for (const name of NAMES.filter((n) => n !== "Default")) {
      expect(decodeExchangeString(presets[name] as string).tail["cliff.name"]).toBe("");
    }
  });

  it("decodes the cliff control string (empty across the corpus)", () => {
    expect(decodeExchangeString(presets["Default"] as string).tail["cliff.control"]).toBe("");
  });
```

`test/encode.spec.ts` already round-trips all 9 fixtures via `it.each`; no new encode test needed here (the shape change from `Uint8Array` to `TailBlock` must keep those green).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - `tail["cliff.name"]` undefined (tail is still `Uint8Array`), and `encode.spec` fails to compile because `EncodableExchange.tail` type changes below.

- [ ] **Step 3: Implement**

In `src/codec/mapExchangeString.ts`:

Add near the other schema constants:

```ts
export interface TailBlock {
  [key: string]: string | number | boolean | Uint8Array | null | (string | number | boolean)[];
}

// The tail, walked as one flat schema (dotted names encode section membership).
// Grows across Phase 1c; ALWAYS ends with an opaque span that absorbs the rest,
// so round-trip is byte-exact at every stage of typing.
export const TAIL_SCHEMA: Schema = [
  { name: "cliff.name", type: "string" },
  { name: "cliff.control", type: "string" },
  { name: "opaqueTail", type: { opaque: 0 } }, // width set dynamically below
];
```

The trailing opaque width is not fixed (the tail length varies with the cliff
name), so the tail is read with a "read the rest" helper rather than a fixed
opaque count. Replace the tail read in `decodeExchangeString`:

```ts
    const tail = readTail(reader);
```

and the tail write in `encodePayload`:

```ts
    writeTail(w, input.tail);
```

Add these two helpers (they walk the fixed prefix of `TAIL_SCHEMA` then treat the
remainder as opaque):

```ts
// Fields of TAIL_SCHEMA excluding the trailing dynamic "opaqueTail".
const TAIL_FIXED_SCHEMA: Schema = TAIL_SCHEMA.filter((f) => f.name !== "opaqueTail");

function readTail(reader: BinaryReader): TailBlock {
  const out = readFields(reader, TAIL_FIXED_SCHEMA) as TailBlock;
  out["opaqueTail"] = reader.remaining();
  return out;
}

function writeTail(writer: BinaryWriter, tail: TailBlock): void {
  writeFields(writer, TAIL_FIXED_SCHEMA, tail as Record<string, FieldValue>);
  writer.writeBytes(tail["opaqueTail"] as Uint8Array);
}
```

Change `DecodedExchange.tail` and `EncodableExchange.tail` from `Uint8Array` to
`TailBlock`. Remove the now-unused raw `reader.remaining()` tail assignment and
the `tail: reader.remaining()` in the returned object (replaced by `tail` above).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - cliff anomaly tests green; all 9 round-trips still byte-exact (the two strings + opaque remainder reproduce the tail exactly).

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type cliff name/control strings, resolving the Default cliff anomaly"
```

---

## Task 4: Type the cliff floats + pollution section

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

**Interfaces:**
- Consumes: `TAIL_SCHEMA`, `readTail`/`writeTail` (Task 3).
- Produces: `TAIL_SCHEMA` gains cliff floats + all pollution fields (dotted keys `cliff.*`, `pollution.*`); `opaqueTail` shrinks accordingly.

**Method for every tail-section task (4-8):** move fields from the front of the
`opaqueTail` span into `TAIL_FIXED_SCHEMA`, choosing types per the layout table
above, then verify (a) all 9 round-trips stay green and (b) `decode(Default)`
values equal the `map-settings.example.json` defaults. The round-trip is guaranteed
by construction; the value check is what proves the types/offsets are right. If a
value is wrong, the section byte-count is off - adjust bool-vs-optional choices
using the Default-tail offsets in the layout table until values match.

- [ ] **Step 1: Write the failing test**

In `test/decode.spec.ts`:

```ts
  it("types the cliff floats and the pollution section for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["cliff.cliffElevation0"]).toBeCloseTo(10, 4);
    expect(t["cliff.cliffElevationInterval"]).toBeCloseTo(40, 4);
    expect(t["pollution.diffusionRatio"]).toBeCloseTo(0.02, 9);
    expect(t["pollution.minToDiffuse"]).toBeCloseTo(15, 9);
    expect(t["pollution.expectedMaxPerChunk"]).toBeCloseTo(150, 9);
    expect(t["pollution.enemyAttackPollutionConsumptionModifier"]).toBeCloseTo(1, 9);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - those keys are undefined (still inside `opaqueTail`).

- [ ] **Step 3: Implement**

Extend `TAIL_SCHEMA` (before `opaqueTail`) with the cliff floats and pollution
fields. Cliff floats are raw `f32` (no presence byte). Pollution scalars are
`{ optional: "f64" }` preceded by an `enabled` bool. Start from this and adjust the
lone-byte / enabled placement until the Step 1 values match and round-trip holds:

```ts
  { name: "cliff.name", type: "string" },
  { name: "cliff.control", type: "string" },
  { name: "cliff.cliffElevation0", type: "f32" },
  { name: "cliff.cliffElevationInterval", type: "f32" },
  { name: "cliff.cliffSmoothing", type: "f32" },
  { name: "cliff.richness", type: "f32" },
  { name: "cliff.trailing", type: { opaque: 1 } }, // the lone 00 byte @23; confirm via round-trip
  { name: "pollution.enabled", type: "bool" },
  { name: "pollution.diffusionRatio", type: { optional: "f64" } },
  { name: "pollution.minToDiffuse", type: { optional: "f64" } },
  { name: "pollution.ageing", type: { optional: "f64" } },
  { name: "pollution.expectedMaxPerChunk", type: { optional: "f64" } },
  { name: "pollution.minToShowPerChunk", type: { optional: "f64" } },
  { name: "pollution.minPollutionToDamageTrees", type: { optional: "f64" } },
  { name: "pollution.pollutionWithMaxForestDamage", type: { optional: "f64" } },
  { name: "pollution.pollutionPerTreeDamage", type: { optional: "f64" } },
  { name: "pollution.pollutionRestoredPerTreeDamage", type: { optional: "f64" } },
  { name: "pollution.maxPollutionToRestoreTrees", type: { optional: "f64" } },
  { name: "pollution.enemyAttackPollutionConsumptionModifier", type: { optional: "f64" } },
  { name: "opaqueTail", type: { opaque: 0 } },
```

If `pollution.diffusionRatio` decodes wrong, the `cliff.trailing`/`enabled` bytes
are misaligned - the diffusion_ratio f64 is at Default-tail offset 27, so the
bytes consumed before it must total 27. Adjust and re-run.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - pollution values correct AND all 9 round-trips green.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type cliff floats and pollution MapSettings section"
```

---

## Task 5: Type enemy_evolution + enemy_expansion

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

**Interfaces:**
- Produces: `TAIL_SCHEMA` gains `enemyEvolution.*` and `enemyExpansion.*`; `opaqueTail` shrinks.

- [ ] **Step 1: Write the failing test**

```ts
  it("types enemy_evolution and enemy_expansion for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["enemyEvolution.timeFactor"]).toBeCloseTo(0.000004, 12);
    expect(t["enemyEvolution.destroyFactor"]).toBeCloseTo(0.002, 9);
    expect(t["enemyEvolution.pollutionFactor"]).toBeCloseTo(0.0000009, 12);
    expect(t["enemyExpansion.maxExpansionDistance"]).toBe(5);
    expect(t["enemyExpansion.otherBaseCoefficient"]).toBeCloseTo(3.0, 9);
    expect(t["enemyExpansion.maxExpansionCooldown"]).toBe(216000);
  });

  it("Death world has a higher enemy_evolution time_factor than Default", () => {
    const def = decodeExchangeString(presets["Default"] as string).tail;
    const dw = decodeExchangeString(presets["Death world"] as string).tail;
    expect(dw["enemyEvolution.timeFactor"]).not.toBe(def["enemyEvolution.timeFactor"]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - keys undefined.

- [ ] **Step 3: Implement**

Insert before `opaqueTail`, using the layout table (evolution: `enabled` bool +
3 optional f64; expansion: `enabled` bool + u32/f64 mix). Resolve
`minExpansionCooldown` (14400) via round-trip - it sits between `evolutionGroupSizeFactor`
(@232) and `maxExpansionCooldown` (@246):

```ts
  { name: "enemyEvolution.enabled", type: "bool" },
  { name: "enemyEvolution.timeFactor", type: { optional: "f64" } },
  { name: "enemyEvolution.destroyFactor", type: { optional: "f64" } },
  { name: "enemyEvolution.pollutionFactor", type: { optional: "f64" } },
  { name: "enemyExpansion.enabled", type: "bool" },
  { name: "enemyExpansion.maxExpansionDistance", type: { optional: "u32" } },
  { name: "enemyExpansion.minExpansionDistance", type: { optional: "u32" } },
  { name: "enemyExpansion.friendlyBaseInfluenceRadius", type: { optional: "u32" } },
  { name: "enemyExpansion.enemyBuildingInfluenceRadius", type: { optional: "u32" } },
  { name: "enemyExpansion.buildingCoefficient", type: { optional: "f64" } },
  { name: "enemyExpansion.otherBaseCoefficient", type: { optional: "f64" } },
  { name: "enemyExpansion.neighbouringChunkCoefficient", type: { optional: "f64" } },
  { name: "enemyExpansion.neighbouringBaseChunkCoefficient", type: { optional: "f64" } },
  { name: "enemyExpansion.maxCollidingTilesCoefficient", type: { optional: "f64" } },
  { name: "enemyExpansion.settlerGroupMinSize", type: { optional: "u32" } },
  { name: "enemyExpansion.settlerGroupMaxSize", type: { optional: "u32" } },
  { name: "enemyExpansion.evolutionGroupSizeFactor", type: { optional: "f64" } },
  { name: "enemyExpansion.minExpansionCooldown", type: { optional: "u32" } },
  { name: "enemyExpansion.maxExpansionCooldown", type: { optional: "u32" } },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - values correct, round-trips green.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type enemy_evolution and enemy_expansion sections"
```

---

## Task 6: Type unit_group

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("types the unit_group section for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["unitGroup.minGroupGatheringTime"]).toBe(3600);
    expect(t["unitGroup.maxGroupRadius"]).toBeCloseTo(30.0, 6);
    expect(t["unitGroup.maxMemberSpeedupWhenBehind"]).toBeCloseTo(1.4, 6);
    expect(t["unitGroup.maxUnitGroupSize"]).toBe(200);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - keys undefined.

- [ ] **Step 3: Implement**

Insert before `opaqueTail` (u32 times/counts, f64 factors/radii per the table):

```ts
  { name: "unitGroup.minGroupGatheringTime", type: { optional: "u32" } },
  { name: "unitGroup.maxGroupGatheringTime", type: { optional: "u32" } },
  { name: "unitGroup.maxWaitTimeForLateMembers", type: { optional: "u32" } },
  { name: "unitGroup.maxGroupRadius", type: { optional: "f64" } },
  { name: "unitGroup.minGroupRadius", type: { optional: "f64" } },
  { name: "unitGroup.maxMemberSpeedupWhenBehind", type: { optional: "f64" } },
  { name: "unitGroup.maxMemberSlowdownWhenAhead", type: { optional: "f64" } },
  { name: "unitGroup.maxGroupSlowdownFactor", type: { optional: "f64" } },
  { name: "unitGroup.maxGroupMemberFallbackFactor", type: { optional: "u32" } },
  { name: "unitGroup.memberDisownDistance", type: { optional: "u32" } },
  { name: "unitGroup.tickToleranceWhenMemberArrives", type: { optional: "u32" } },
  { name: "unitGroup.maxGatheringUnitGroups", type: { optional: "u32" } },
  { name: "unitGroup.maxUnitGroupSize", type: { optional: "u32" } },
```

If the first unit_group value is off, the expansion cooldowns in Task 5 mis-sized;
re-check that `maxExpansionCooldown` == 216000 first (they share the @241-@265 run).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type unit_group section"
```

---

## Task 7: Type path_finder (incl. the overload arrays)

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

**Interfaces:**
- Consumes: the `{ array: "u32" }` FieldType from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
  it("types the path_finder section incl. overload arrays for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["pathFinder.fwd2bwdRatio"]).toBe(5);
    expect(t["pathFinder.goalPressureRatio"]).toBeCloseTo(2.0, 6);
    expect(t["pathFinder.usePathCache"]).toBe(true);
    expect(t["pathFinder.overloadLevels"]).toEqual([0, 100, 500]);
    expect(t["pathFinder.overloadMultipliers"]).toEqual([2, 3, 4]);
    expect(t["pathFinder.negativePathCacheDelayInterval"]).toBe(20);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - keys undefined.

- [ ] **Step 3: Implement**

Insert before `opaqueTail`, following the path_finder layout table. `usePathCache`
is a bare bool; `overloadLevels`/`overloadMultipliers` are `{ array: "u32" }` (the
array's own u32 count replaces a presence byte - verify the raw `03 00 00 00`
count bytes land where the table says, ~@568 and ~@586). Types (u32 for
counts/steps/distances, f64 for ratios/penalties) per the table:

```ts
  { name: "pathFinder.fwd2bwdRatio", type: { optional: "u32" } },
  { name: "pathFinder.goalPressureRatio", type: { optional: "f64" } },
  { name: "pathFinder.maxStepsWorkedPerTick", type: { optional: "u32" } },
  { name: "pathFinder.maxWorkDonePerTick", type: { optional: "u32" } },
  { name: "pathFinder.usePathCache", type: "bool" },
  { name: "pathFinder.shortCacheSize", type: { optional: "u32" } },
  { name: "pathFinder.longCacheSize", type: { optional: "u32" } },
  { name: "pathFinder.shortCacheMinCacheableDistance", type: { optional: "u32" } },
  { name: "pathFinder.shortCacheMinAlgoStepsToCache", type: { optional: "u32" } },
  { name: "pathFinder.longCacheMinCacheableDistance", type: { optional: "u32" } },
  { name: "pathFinder.cacheMaxConnectToCacheStepsMultiplier", type: { optional: "u32" } },
  { name: "pathFinder.cacheAcceptPathStartDistanceRatio", type: { optional: "f64" } },
  { name: "pathFinder.cacheAcceptPathEndDistanceRatio", type: { optional: "f64" } },
  { name: "pathFinder.negativeCacheAcceptPathStartDistanceRatio", type: { optional: "f64" } },
  { name: "pathFinder.negativeCacheAcceptPathEndDistanceRatio", type: { optional: "f64" } },
  { name: "pathFinder.cachePathStartDistanceRatingMultiplier", type: { optional: "u32" } },
  { name: "pathFinder.cachePathEndDistanceRatingMultiplier", type: { optional: "u32" } },
  { name: "pathFinder.staleEnemyWithSameDestinationCollisionPenalty", type: { optional: "f64" } },
  { name: "pathFinder.ignoreMovingEnemyCollisionDistance", type: { optional: "f64" } },
  { name: "pathFinder.enemyWithDifferentDestinationCollisionPenalty", type: { optional: "f64" } },
  { name: "pathFinder.generalEntityCollisionPenalty", type: { optional: "f64" } },
  { name: "pathFinder.generalEntitySubsequentCollisionPenalty", type: { optional: "f64" } },
  { name: "pathFinder.extendedCollisionPenalty", type: { optional: "f64" } },
  { name: "pathFinder.maxClientsToAcceptAnyNewRequest", type: { optional: "u32" } },
  { name: "pathFinder.maxClientsToAcceptShortNewRequest", type: { optional: "u32" } },
  { name: "pathFinder.directDistanceToConsiderShortRequest", type: { optional: "u32" } },
  { name: "pathFinder.shortRequestMaxSteps", type: { optional: "u32" } },
  { name: "pathFinder.shortRequestRatio", type: { optional: "f64" } },
  { name: "pathFinder.minStepsToCheckPathFindTermination", type: { optional: "u32" } },
  { name: "pathFinder.startToGoalCostMultiplierToTerminatePathFind", type: { optional: "f64" } },
  { name: "pathFinder.overloadLevels", type: { array: "u32" } },
  { name: "pathFinder.overloadMultipliers", type: { array: "u32" } },
  { name: "pathFinder.negativePathCacheDelayInterval", type: { optional: "u32" } },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - arrays and scalars correct, round-trips green.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type path_finder section incl. overload arrays"
```

---

## Task 8: Type difficulty_settings + asteroids + max_failed_behavior_count (tail end)

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("types difficulty/asteroids/max_failed and closes the opaque tail for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["difficulty.technologyPriceMultiplier"]).toBeCloseTo(1.0, 6);
    expect(t["difficulty.spoilTimeModifier"]).toBeCloseTo(1.0, 6);
    expect(t["asteroids.spawningRate"]).toBeCloseTo(1.0, 6);
    expect(t["asteroids.maxRayPortalsExpandedPerTick"]).toBe(100);
    expect(t["maxFailedBehaviorCount"]).toBe(3);
    // Whole MapSettings typed: no bytes left over.
    expect((t["opaqueTail"] as Uint8Array).length).toBe(0);
  });

  it("Marathon has technology_price_multiplier 4", () => {
    const t = decodeExchangeString(presets["Marathon"] as string).tail;
    expect(t["difficulty.technologyPriceMultiplier"]).toBeCloseTo(4.0, 6);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test decode --run`
Expected: FAIL - keys undefined and `opaqueTail` not empty.

- [ ] **Step 3: Implement**

Insert before `opaqueTail`:

```ts
  { name: "difficulty.technologyPriceMultiplier", type: { optional: "f64" } },
  { name: "difficulty.spoilTimeModifier", type: { optional: "f64" } },
  { name: "asteroids.spawningRate", type: { optional: "f64" } },
  { name: "asteroids.maxRayPortalsExpandedPerTick", type: { optional: "u32" } },
  { name: "maxFailedBehaviorCount", type: { optional: "u32" } },
```

The trailing `opaqueTail` should now decode to length 0 for every fixture. If it
does not, an earlier section is mis-sized - the failing byte-count points at which.
(If a residual constant remainder persists across all 9 fixtures, leave `opaqueTail`
in place; it stays byte-exact and simply isn't surfaced to JSON.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test decode encode --run`
Expected: PASS - full MapSettings typed, `opaqueTail` empty, all 9 round-trips green, Marathon tpm = 4.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: type difficulty/asteroids/max_failed, closing the opaque tail"
```

---

## Task 9: Model + convert - assemble nested cliffSettings/mapSettings, wire seed

**Files:**
- Create: `src/model/mapSettings.ts`
- Modify: `src/model/types.ts`, `src/model/convert.ts`
- Test: `test/store.spec.ts`, `test/mapSettings.spec.ts` (create)

**Interfaces:**
- Consumes: `DecodedExchange.mid` (seed/startingArea), `DecodedExchange.tail` (flat dotted keys).
- Produces:
  - `src/model/mapSettings.ts`: `interface CliffSettings`, `interface MapSettings` (nested by section), `tailToNested(tail): { cliff: CliffSettings; mapSettings: MapSettings; opaqueTailRest: Uint8Array }`, `nestedToTail(cliff, mapSettings, opaqueTailRest): TailBlock`.
  - `Preset` gains `seed: number` (was `number | null`), `startingArea: number`, `cliffSettings: CliffSettings`, `mapSettings: MapSettings`, `opaqueTailRestB64: string`; drops `opaqueTailB64`.

This task turns the flat dotted-key tail into the nested model shape used by JSON
export + UI. `tailToNested`/`nestedToTail` are pure key-reshaping (split/join on
`.`), no bytes.

- [ ] **Step 1: Write the failing test**

Create `test/mapSettings.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { nestedToTail, tailToNested } from "../src/model/mapSettings";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

describe("tailToNested / nestedToTail", () => {
  it("reshapes the flat tail into nested sections and back losslessly", () => {
    const tail = decodeExchangeString(presets["Default"] as string).tail;
    const nested = tailToNested(tail);
    expect(nested.mapSettings.pollution.diffusionRatio).toBeCloseTo(0.02, 9);
    expect(nested.cliff.name).toBe("cliff");
    const roundTripped = nestedToTail(nested.cliff, nested.mapSettings, nested.opaqueTailRest);
    expect(roundTripped["pollution.diffusionRatio"]).toBe(tail["pollution.diffusionRatio"]);
    expect(roundTripped["cliff.name"]).toBe("cliff");
  });
});
```

Append to `test/store.spec.ts`:

```ts
  it("exposes typed seed and mapSettings, and encodes an edited seed", () => {
    const store = usePresetsStore();
    expect(store.activePreset?.seed).toBe(34658944);
    expect(store.activePreset?.mapSettings.pollution.diffusionRatio).toBeCloseTo(0.02, 9);
    const active = store.activePreset;
    if (active) active.seed = 123456789;
    const encoded = store.activeExchangeString as string;
    expect(decodeExchangeString(encoded).mid.seed).toBe(123456789);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test mapSettings store --run`
Expected: FAIL - module `../src/model/mapSettings` missing; `Preset.mapSettings` undefined.

- [ ] **Step 3: Implement**

Create `src/model/mapSettings.ts` with the nested interfaces and the two mappers.
`tailToNested` walks the tail's keys, splitting on the first `.` into
`section.field`, and copies `opaqueTail` into `opaqueTailRest`; `nestedToTail`
joins them back. Provide explicit interfaces (`CliffSettings`, `PollutionSettings`,
`EnemyEvolutionSettings`, `EnemyExpansionSettings`, `UnitGroupSettings`,
`PathFinderSettings`, `DifficultySettings`, `AsteroidsSettings`, and
`MapSettings` composing them + `maxFailedBehaviorCount`). Since keys are the
camelCase field names from Tasks 4-8, the mapper is generic:

```ts
export function tailToNested(tail: TailBlock): {
  cliff: CliffSettings;
  mapSettings: MapSettings;
  opaqueTailRest: Uint8Array;
} {
  const sections: Record<string, Record<string, unknown>> = {};
  let opaqueTailRest = new Uint8Array(0);
  for (const [key, value] of Object.entries(tail)) {
    if (key === "opaqueTail") {
      opaqueTailRest = value as Uint8Array;
      continue;
    }
    const dot = key.indexOf(".");
    if (dot === -1) {
      (sections["_top"] ??= {})[key] = value; // maxFailedBehaviorCount
      continue;
    }
    const section = key.slice(0, dot);
    const field = key.slice(dot + 1);
    (sections[section] ??= {})[field] = value;
  }
  // Assemble typed objects from `sections` (cast per interface).
  // ... build cliff + mapSettings from sections.cliff, sections.pollution, etc.
}
```

(Write the explicit assembly rather than leaving it generic if the type system
needs it; the reshaping is mechanical.) `nestedToTail` is the inverse: for each
section object, emit `${section}.${field}` keys, plus the top-level
`maxFailedBehaviorCount` and `opaqueTail`.

In `src/model/types.ts`: replace `seed: number | null` with `seed: number`; drop
the `opaqueTailB64` block; add `startingArea: number`, `cliffSettings: CliffSettings`,
`mapSettings: MapSettings`, `opaqueTailRestB64: string`. Import the interfaces from
`./mapSettings`.

In `src/model/convert.ts`: in `presetFromDecoded`, set `seed: decoded.mid.seed`,
`startingArea: decoded.mid.startingArea`, call `tailToNested(decoded.tail)` and
spread `cliffSettings`/`mapSettings`/`opaqueTailRestB64: bytesToBase64(opaqueTailRest)`.
In `presetToEncodable`, set `mid.seed`/`mid.startingArea` and rebuild
`tail: nestedToTail(preset.cliffSettings, preset.mapSettings, base64ToBytes(preset.opaqueTailRestB64))`.
Update the `MidBlock` construction to include `opaqueRestA`/`opaqueRestB` (was
`opaqueRest`).

- [ ] **Step 4: Run to verify pass, and confirm no stragglers**

Run: `git grep -n "opaqueTailB64\|opaqueMidRestB64\|opaqueRest\b\|seed: null"`
Expected: no matches referencing removed fields (migrate any that remain -
PresetBar's `seed` handling is updated in Task 12).

Run: `pnpm vp test --run`
Expected: PASS - full suite green (this is the codec-first checkpoint gate).

- [ ] **Step 5: Commit**

```bash
git add src/model/mapSettings.ts src/model/types.ts src/model/convert.ts test/mapSettings.spec.ts test/store.spec.ts
git commit -m "feat: surface typed seed/starting_area/cliff/mapSettings on the Preset model"
```

---

> **CODEC-FIRST CHECKPOINT.** After Task 9, the full 9-fixture round-trip + all semantic tests (cliff anomaly, seed, starting_area, Marathon tpm, Death world evolution, Default-equals-defaults per section) are green, and the model carries fully typed MapSettings. This is the mid-point review gate before IO + UI.

---

## Task 10: JSON export (map-gen-settings.json + map-settings.json)

**Files:**
- Create: `src/io/jsonExport.ts`
- Test: `test/jsonExport.spec.ts` (create)

**Interfaces:**
- Consumes: `Preset` (Task 9), the example.json shapes in `test/fixtures/`.
- Produces: `toMapGenSettingsJson(preset: Preset): object`, `toMapSettingsJson(preset: Preset): object`.

- [ ] **Step 1: Write the failing test**

Create `test/jsonExport.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { presetFromDecoded } from "../src/model/convert";
import { toMapGenSettingsJson, toMapSettingsJson } from "../src/io/jsonExport";
import fixtures from "./fixtures/builtin-presets.json";
import mapSettingsDefaults from "./fixtures/map-settings.example.json";

const presets = fixtures.presets as Record<string, string>;

function preset(name: string) {
  return presetFromDecoded(name, decodeExchangeString(presets[name] as string), true);
}

describe("toMapGenSettingsJson", () => {
  it("emits snake_case autoplace_controls, seed, width, height, cliff_settings", () => {
    const j = toMapGenSettingsJson(preset("Default")) as Record<string, unknown>;
    expect(j["seed"]).toBe(34658944);
    expect(j["width"]).toBe(2000000);
    expect((j["autoplace_controls"] as Record<string, unknown>)["coal"]).toBeDefined();
    expect((j["cliff_settings"] as Record<string, unknown>)["cliff_elevation_interval"]).toBeCloseTo(40, 4);
  });
});

describe("toMapSettingsJson", () => {
  it("Default map-settings matches the example.json defaults for key fields", () => {
    const j = toMapSettingsJson(preset("Default")) as Record<string, Record<string, unknown>>;
    expect(j["pollution"]["diffusion_ratio"]).toBeCloseTo(
      (mapSettingsDefaults as Record<string, Record<string, number>>)["pollution"]["diffusion_ratio"],
      9,
    );
    expect(j["enemy_evolution"]["time_factor"]).toBeCloseTo(0.000004, 12);
    expect(j["difficulty_settings"]["technology_price_multiplier"]).toBeCloseTo(1, 6);
  });

  it("Marathon map-settings has technology_price_multiplier 4", () => {
    const j = toMapSettingsJson(preset("Marathon")) as Record<string, Record<string, unknown>>;
    expect(j["difficulty_settings"]["technology_price_multiplier"]).toBeCloseTo(4, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test jsonExport --run`
Expected: FAIL - `../src/io/jsonExport` missing.

- [ ] **Step 3: Implement**

Create `src/io/jsonExport.ts`. `toMapSettingsJson` maps the nested camelCase
`preset.mapSettings` to the snake_case example.json shape (a per-section
key-rename; keep a small `camelToSnake` helper or explicit maps). `toMapGenSettingsJson`
emits `autoplace_controls` (already keyed by control name, snake_case values
`frequency`/`size`/`richness`), `property_expression_names`, `seed`, `width`,
`height`, `starting_area`, `cliff_settings` (from `preset.cliffSettings`), and the
corpus-constant defaults for the still-opaque mid fields: `peaceful_mode: false`,
`no_enemies_mode: false`, `starting_points: [{ x: 0, y: 0 }]`,
`autoplace_settings` treat_missing defaults, `default_enable_all_autoplace_controls: false`
(documented as defaults in a comment).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test jsonExport --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/jsonExport.ts test/jsonExport.spec.ts
git commit -m "feat: export map-gen-settings.json and map-settings.json"
```

---

## Task 11: ZIP export (JSZip)

**Files:**
- Create: `src/io/zipExport.ts`
- Test: `test/zipExport.spec.ts` (create)
- Modify: `package.json` (add `jszip`)

**Interfaces:**
- Consumes: `toMapGenSettingsJson`/`toMapSettingsJson` (Task 10), `presetToEncodable` + `encodeExchangeString`.
- Produces: `buildZip(preset: Preset): Promise<Blob>`, containing `map-gen-settings.json`, `map-settings.json`, `<preset-name>.txt` (the exchange string).

- [ ] **Step 1: Add the dependency**

Run: `pnpm add jszip`
Expected: `jszip` in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `test/zipExport.spec.ts`:

```ts
import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString } from "../src/codec/mapExchangeString";
import { presetFromDecoded } from "../src/model/convert";
import { buildZip } from "../src/io/zipExport";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;

describe("buildZip", () => {
  it("bundles the two JSON files and the exchange string", async () => {
    const preset = presetFromDecoded(
      "Default",
      decodeExchangeString(presets["Default"] as string),
      true,
    );
    const blob = await buildZip(preset);
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file("map-gen-settings.json")).not.toBeNull();
    expect(zip.file("map-settings.json")).not.toBeNull();
    const txt = await zip.file("Default.txt")?.async("string");
    expect(txt?.startsWith(">>>")).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vp test zipExport --run`
Expected: FAIL - `../src/io/zipExport` missing.

- [ ] **Step 4: Implement**

Create `src/io/zipExport.ts`:

```ts
import JSZip from "jszip";
import { encodeExchangeString } from "../codec/mapExchangeString";
import { presetToEncodable } from "../model/convert";
import type { Preset } from "../model/types";
import { toMapGenSettingsJson, toMapSettingsJson } from "./jsonExport";

export async function buildZip(preset: Preset): Promise<Blob> {
  const zip = new JSZip();
  zip.file("map-gen-settings.json", JSON.stringify(toMapGenSettingsJson(preset), null, 2));
  zip.file("map-settings.json", JSON.stringify(toMapSettingsJson(preset), null, 2));
  zip.file(`${preset.name}.txt`, encodeExchangeString(presetToEncodable(preset)));
  return zip.generateAsync({ type: "blob" });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vp test zipExport --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/io/zipExport.ts test/zipExport.spec.ts
git commit -m "feat: bundle JSON + exchange string into a downloadable ZIP"
```

---

## Task 12: UI - seed input, starting_area input, Download ZIP button

**Files:**
- Modify: `src/components/PresetBar.vue`, `src/components/AdvancedTab.vue`, `src/components/ActionBar.vue`
- Test: `test/presetBar.spec.ts`, `test/advancedTab.spec.ts`, `test/actionBar.spec.ts`

**Interfaces:**
- Consumes: `Preset.seed` (now `number`), `Preset.startingArea`, `buildZip` (Task 11).
- Produces: a working Download ZIP button that triggers a browser download.

- [ ] **Step 1: Write the failing tests**

Append to `test/advancedTab.spec.ts`:

```ts
  it("shows and edits the active preset's starting area", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="starting-area"]');
    expect((input.element as HTMLInputElement).value).toBe("1");
    (input.element as HTMLInputElement).value = "2";
    await input.trigger("change");
    expect(store.activePreset?.startingArea).toBe(2);
  });
```

Append to `test/actionBar.spec.ts` (mock the download so no real navigation):

```ts
  it("enables Download ZIP and calls buildZip on click", async () => {
    setActivePinia(createPinia());
    const wrapper = mount(ActionBar);
    const btn = wrapper.find('[data-test="download-zip"]');
    expect(btn.attributes("disabled")).toBeUndefined();
    // clicking should not throw; buildZip runs against the active preset
    await btn.trigger("click");
    expect(true).toBe(true);
  });
```

Update `test/presetBar.spec.ts` seed test to expect a numeric seed (no null):

```ts
  it("binds the numeric seed and writes edits back", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(PresetBar);
    const input = wrapper.find('[data-test="seed-input"]');
    (input.element as HTMLInputElement).value = "123456789";
    await input.trigger("change");
    expect(store.activePreset?.seed).toBe(123456789);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test advancedTab actionBar presetBar --run`
Expected: FAIL - no `starting-area`/`download-zip` elements; seed handling still allows null.

- [ ] **Step 3: Implement**

`AdvancedTab.vue`: add a `FNumberInput` bound to `preset.startingArea`, tagged
`data-test="starting-area"`, next to width/height.

`PresetBar.vue`: change `onSeedChange` to always write a number (`store.activePreset.seed = Number(raw) || 0`), bind `:value="store.activePreset?.seed ?? 0"`, and drop the `""`->null branch (seed is always a real u32 now).

`ActionBar.vue`: replace the disabled Download ZIP `FButton` with:

```html
    <FButton data-test="download-zip" :disabled="!store.activePreset" @click="downloadZip()">
      Download ZIP
    </FButton>
```

and add to `<script setup>`:

```ts
import { buildZip } from "../io/zipExport";

async function downloadZip() {
  const preset = store.activePreset;
  if (!preset) return;
  const blob = await buildZip(preset);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${preset.name}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vp test advancedTab actionBar presetBar --run`
Expected: PASS.

- [ ] **Step 5: Full suite + lint, then commit**

Run: `pnpm vp check --fix; pnpm vp test --run`
Expected: lint/format clean, entire suite green.

```bash
git add src/components/PresetBar.vue src/components/AdvancedTab.vue src/components/ActionBar.vue test/presetBar.spec.ts test/advancedTab.spec.ts test/actionBar.spec.ts
git commit -m "feat: wire seed/starting_area inputs and Download ZIP button"
```

---

## Self-Review

**1. Spec coverage:**
- FieldType extension (bool/optional/array) -> Task 1. ✓
- Type seed + starting_area -> Task 2. ✓
- Cliff anomaly resolved -> Task 3 (name/control strings). ✓
- Full MapSettings typed section-by-section -> Tasks 4-8 (cliff floats+pollution, evolution+expansion, unit_group, path_finder+arrays, difficulty+asteroids+max_failed). ✓
- Flat TAIL_SCHEMA, nesting in convert -> Task 3 (flat schema) + Task 9 (`mapSettings.ts` mappers). ✓
- map-gen-settings.json + map-settings.json -> Task 10. ✓
- ZIP via JSZip -> Task 11. ✓
- UI seed/starting_area + Download ZIP -> Task 12. ✓
- Codec-first checkpoint -> after Task 9. ✓
- Semantic cross-check tests (Default==defaults, Marathon tpm=4, Death world evolution, cliff anomaly, seed, starting_area) -> Tasks 3,4,5,8,9,10. ✓
- JSON fidelity fallback for opaque mid fields -> Task 10 (documented defaults). ✓

**2. Placeholder scan:** Tail-section tasks give the full field table + exact verification (values + round-trip) rather than "reverse-engineer this"; the few genuinely fuzzy bytes (cliff lone byte, expansion cooldowns, array counts) are named with their Default-tail offsets and the round-trip/defaults gate that resolves them. No "TBD"/"similar to Task N"/"add error handling". Task 9's `tailToNested` shows the mechanical reshape and instructs explicit assembly.

**3. Type consistency:** `MidBlock` fields (`opaqueHead`/`seed`/`width`/`height`/`opaqueRestA`/`startingArea`/`opaqueRestB`) defined in Task 2, reused in Task 9's convert. `TailBlock` dotted keys defined across Tasks 3-8 are consumed verbatim by Task 9's `tailToNested` and asserted in Tasks 4-10 with identical spellings (camelCase field names). `FieldType`/`FieldValue` widening (Task 1) is used by Tasks 2-8. `Preset` fields (`seed`/`startingArea`/`cliffSettings`/`mapSettings`/`opaqueTailRestB64`) added in Task 9 match Task 10-12 consumers. `toMapGenSettingsJson`/`toMapSettingsJson`/`buildZip` names identical across Tasks 10-12.

# Factorio Map WebUI - Phase 1b (Declarative Field Schema) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one declarative field schema, shared by decode and encode, that walks the mid-block byte region into named typed fields (with an opaque-span fallback), and use it to surface editable map `width`/`height` on the preset model and UI - all while keeping every fixture's byte-exact round-trip intact.

**Architecture:** A new `fieldSchema.ts` defines an ordered list of `{ name, type }` descriptors plus two generic walkers - `readFields` (BinaryReader -> typed object) and `writeFields` (typed object -> BinaryWriter) - so decode and encode are driven by a single source of truth and cannot drift. The 55-byte mid-block, currently carried opaquely as one blob, is expressed as a schema that types the two byte-proven fields (`width` u32 at offset 6, `height` u32 at offset 10) and leaves the remaining bytes as two `opaque` spans. The tail stays a single opaque span (unchanged from Phase 1a). Byte-exactness is guaranteed by construction and gated by the existing 9-fixture round-trip corpus.

**Tech Stack:** TypeScript, Vue 3, Pinia, the Vite+ (`vp`) toolchain. No new dependencies. Tests import from `vite-plus/test`.

## Global Constraints

- Target game version **Factorio 2.1.9 (experimental)**, map-exchange format tag **2.1.9.3**. Do not change the version tuple handling.
- **Byte-exact round-trip is non-negotiable.** The primary gate is the existing payload round-trip (`encodePayload(decode(s))` byte-equals `decode(s).payload`) and the secondary string round-trip (`encodeExchangeString(decode(s)) === s`) for all 9 fixtures. Every task must leave `vp test` green on these.
- **The mid-block is exactly 55 bytes.** The schema's fixed fields MUST sum to 55: `opaque(6) + u32 + u32 + opaque(41) = 6 + 4 + 4 + 41 = 55`.
- **Only `width` and `height` are byte-proven from the corpus.** `width` (u32 LE at mid offset 6) = `2000000` in all 9 fixtures and matches `map-gen-settings.default-nauvis.dump.json`. `height` (u32 LE at mid offset 10) = `2000000` in 8 fixtures and `128` in Ribbon world, which is the only corpus evidence that pins an offset. Do NOT type any other mid-block field in this phase - the `float32` at offset 38 varies (1.0/0.75/3.0) but its meaning is unconfirmed, and the seed is not locatable in the corpus. Those stay inside the `opaque` spans.
- **All little-endian.** Reuse `BinaryReader`/`BinaryWriter` primitives; do not hand-roll DataView reads in new code.
- Tests import from `vite-plus/test`, never `vitest`. Run the suite with `vp test`, lint/format with `vp check --fix`.
- Use hyphens (`-`), not em/en dashes, in any prose or comments.

## Scope

**In scope (this plan):**
- The declarative `fieldSchema.ts` engine (descriptor types + `readFields` + `writeFields`).
- Expressing the mid-block as a schema; typing `width` and `height`; keeping head (6 bytes) and rest (41 bytes) as opaque spans.
- Surfacing `width`/`height` as typed, editable fields on the `Preset` model, through `convert.ts`, and as number inputs in `AdvancedTab.vue`.

**Deferred to Phase 1c (explicitly out of scope here), with rationale:**
- **JSON + ZIP export** (`map-gen-settings.json` / `map-settings.json`): needs `cliff_settings` and all MapSettings values, which live in the still-opaque tail. Blocked until the tail is typed.
- **Typing the tail** (cliff block + MapSettings presence-byte optionals): the tail carries the unresolved Default cliff anomaly (Default's tail is 641 bytes and contains a standalone `05 "cliff"` token; the other eight are 636 bytes without it). The presence-byte "absent optional" path is also unexercised by the corpus. This needs the anomaly resolved and dedicated fixtures first.
- **Typing the remaining mid-block fields** (seed, terrain/size `float32`s): blocked on single-setting diff fixtures that do not exist yet (Section 13 of the design spec notes these are still to be captured). The `bool`-prefixed-optional descriptor kind the tail will need is intentionally NOT built here (YAGNI); `FieldType` is a discriminated union so 1c can extend it without reworking the walkers.

---

## File Structure

- `src/codec/fieldSchema.ts` (create) - `FieldType`, `Field`, `Schema`, `FieldValue`, `readFields`, `writeFields`. The reusable declarative engine. One responsibility: turn an ordered field schema into a bidirectional byte<->object walk.
- `src/codec/mapExchangeString.ts` (modify) - replace the raw 55-byte `midBlock` read/write with `MID_BLOCK_SCHEMA` + `readFields`/`writeFields`. Change `DecodedExchange.midBlock: Uint8Array` and `EncodableExchange.midBlock: Uint8Array` to `mid: MidBlock`.
- `src/model/types.ts` (modify) - replace `Preset.opaqueMidB64: string` with `width: number`, `height: number`, `opaqueMidHeadB64: string`, `opaqueMidRestB64: string`.
- `src/model/convert.ts` (modify) - map the new mid fields in both directions.
- `src/components/AdvancedTab.vue` (modify) - add editable Map width/height inputs; update the "unlock in Phase 1" note.
- `test/fieldSchema.spec.ts` (create) - engine unit tests.
- `test/decode.spec.ts` (modify) - replace the "mid block is 55 bytes" test with typed width/height + opaque-span assertions.
- `test/encode.spec.ts` (modify) - no logic change expected; confirm the round-trips still pass after the shape change (the `it.each` round-trip already covers it).
- `test/advancedTab.spec.ts` (create) - component test for the width/height inputs.

---

## Task 1: Field-schema descriptors + generic decode walker

**Files:**
- Create: `src/codec/fieldSchema.ts`
- Test: `test/fieldSchema.spec.ts`

**Interfaces:**
- Consumes: `BinaryReader` from `src/codec/binaryReader.ts` (existing: `readUint8/16/32`, `readFloat32/64`, `readBytes(n)`, `readString`).
- Produces:
  - `type FieldType = "u8" | "u16" | "u32" | "f32" | "f64" | "string" | { opaque: number }`
  - `interface Field { name: string; type: FieldType }`
  - `type Schema = readonly Field[]`
  - `type FieldValue = number | string | Uint8Array`
  - `function readFields(reader: BinaryReader, schema: Schema): Record<string, FieldValue>`

- [ ] **Step 1: Write the failing test**

Create `test/fieldSchema.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";
import { readFields, type Schema } from "../src/codec/fieldSchema";

const SCHEMA: Schema = [
  { name: "head", type: { opaque: 2 } },
  { name: "count", type: "u32" },
  { name: "ratio", type: "f32" },
  { name: "tail", type: { opaque: 1 } },
];

describe("readFields", () => {
  it("decodes each descriptor in order, little-endian", () => {
    // head=[0xAA,0xBB], count=2000000 (80 84 1e 00), ratio=1.0 (00 00 80 3f), tail=[0xFF]
    const bytes = new Uint8Array([0xaa, 0xbb, 0x80, 0x84, 0x1e, 0x00, 0x00, 0x00, 0x80, 0x3f, 0xff]);
    const out = readFields(new BinaryReader(bytes), SCHEMA);
    expect(out["head"]).toEqual(new Uint8Array([0xaa, 0xbb]));
    expect(out["count"]).toBe(2000000);
    expect(out["ratio"]).toBe(1);
    expect(out["tail"]).toEqual(new Uint8Array([0xff]));
  });

  it("decodes u8, u16, f64, and string descriptors", () => {
    // u8=7, u16=513 (01 02), f64=1.5 (00 00 00 00 00 00 f8 3f), string len 2 "hi"
    const bytes = new Uint8Array([
      0x07, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f, 0x02, 0x68, 0x69,
    ]);
    const schema: Schema = [
      { name: "a", type: "u8" },
      { name: "b", type: "u16" },
      { name: "c", type: "f64" },
      { name: "d", type: "string" },
    ];
    const out = readFields(new BinaryReader(bytes), schema);
    expect(out["a"]).toBe(7);
    expect(out["b"]).toBe(513);
    expect(out["c"]).toBe(1.5);
    expect(out["d"]).toBe("hi");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test fieldSchema`
Expected: FAIL - cannot resolve `../src/codec/fieldSchema` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/codec/fieldSchema.ts`:

```ts
import type { BinaryReader } from "./binaryReader";

export type FieldType = "u8" | "u16" | "u32" | "f32" | "f64" | "string" | { opaque: number };

export interface Field {
  name: string;
  type: FieldType;
}

export type Schema = readonly Field[];

export type FieldValue = number | string | Uint8Array;

function readOne(reader: BinaryReader, type: FieldType): FieldValue {
  if (typeof type === "object") return reader.readBytes(type.opaque);
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
  }
}

/** Walk `schema` in order, decoding each descriptor from `reader` into a keyed object. */
export function readFields(reader: BinaryReader, schema: Schema): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of schema) {
    out[field.name] = readOne(reader, field.type);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `vp test fieldSchema`
Expected: PASS (both `readFields` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/codec/fieldSchema.ts test/fieldSchema.spec.ts
git commit -m "feat: add declarative field-schema decode walker"
```

---

## Task 2: Generic encode walker (writeFields) + round-trip

**Files:**
- Modify: `src/codec/fieldSchema.ts`
- Test: `test/fieldSchema.spec.ts`

**Interfaces:**
- Consumes: `BinaryWriter` from `src/codec/binaryWriter.ts` (existing: `writeUint8/16/32`, `writeFloat32/64`, `writeBytes`, `writeString`, `toBytes`).
- Produces: `function writeFields(writer: BinaryWriter, schema: Schema, values: Record<string, FieldValue>): void`

- [ ] **Step 1: Write the failing test**

Append to `test/fieldSchema.spec.ts`:

```ts
import { BinaryWriter } from "../src/codec/binaryWriter";
import { writeFields } from "../src/codec/fieldSchema";

describe("writeFields", () => {
  it("re-emits bytes read by readFields, byte-for-byte (round-trip)", () => {
    const schema: Schema = [
      { name: "a", type: "u8" },
      { name: "b", type: "u16" },
      { name: "c", type: "u32" },
      { name: "d", type: "f32" },
      { name: "e", type: "f64" },
      { name: "f", type: "string" },
      { name: "g", type: { opaque: 3 } },
    ];
    const bytes = new Uint8Array([
      0x07, // a = 7
      0x01, 0x02, // b = 513
      0x80, 0x84, 0x1e, 0x00, // c = 2000000
      0x00, 0x00, 0x80, 0x3f, // d = 1.0
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f, // e = 1.5
      0x02, 0x68, 0x69, // f = "hi"
      0xde, 0xad, 0xbe, // g = opaque(3)
    ]);
    const values = readFields(new BinaryReader(bytes), schema);
    const w = new BinaryWriter();
    writeFields(w, schema, values);
    expect(w.toBytes()).toEqual(bytes);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test fieldSchema`
Expected: FAIL - `writeFields` is not exported from `fieldSchema`.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/codec/fieldSchema.ts`:

```ts
import type { BinaryWriter } from "./binaryWriter";

function writeOne(writer: BinaryWriter, type: FieldType, value: FieldValue): void {
  if (typeof type === "object") {
    writer.writeBytes(value as Uint8Array);
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
  }
}

/** Walk `schema` in order, encoding `values[field.name]` into `writer`. The exact inverse of readFields. */
export function writeFields(
  writer: BinaryWriter,
  schema: Schema,
  values: Record<string, FieldValue>,
): void {
  for (const field of schema) {
    writeOne(writer, field.type, values[field.name] as FieldValue);
  }
}
```

Note: add the `import type { BinaryWriter }` line at the top of the file alongside the existing `BinaryReader` import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `vp test fieldSchema`
Expected: PASS (all three tests green).

- [ ] **Step 5: Commit**

```bash
git add src/codec/fieldSchema.ts test/fieldSchema.spec.ts
git commit -m "feat: add declarative field-schema encode walker"
```

---

## Task 3: Express the mid-block as a schema; type width/height on decode

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

**Interfaces:**
- Consumes: `readFields` / `Schema` / `FieldValue` from Task 1.
- Produces:
  - `interface MidBlock { opaqueHead: Uint8Array; width: number; height: number; opaqueRest: Uint8Array }`
  - `DecodedExchange.mid: MidBlock` (replaces `midBlock: Uint8Array`)
  - Exports `MidBlock` for the model layer.

- [ ] **Step 1: Write the failing test**

In `test/decode.spec.ts`, replace the existing test block (the `it.each(NAMES)("mid block of %s is exactly 55 bytes", ...)` at lines 72-74) with:

```ts
  it.each(NAMES)("mid block of %s splits into head(6) + width + height + rest(41)", (name) => {
    const mid = decodeExchangeString(presets[name] as string).mid;
    expect(mid.opaqueHead.length).toBe(6);
    expect(mid.opaqueRest.length).toBe(41);
    expect(mid.width).toBe(2000000);
  });

  it("types map width and height from the mid-block (Ribbon world proves the height offset)", () => {
    expect(decodeExchangeString(presets["Default"] as string).mid.height).toBe(2000000);
    // Ribbon world is the only fixture with a non-default height (128), which is
    // what pins the u32 height offset at mid+10.
    expect(decodeExchangeString(presets["Ribbon world"] as string).mid.height).toBe(128);
    expect(decodeExchangeString(presets["Ribbon world"] as string).mid.width).toBe(2000000);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test decode`
Expected: FAIL - `decoded.mid` is undefined (decode still returns `midBlock`).

- [ ] **Step 3: Write the minimal implementation**

In `src/codec/mapExchangeString.ts`:

Add imports at the top (next to the existing codec imports):

```ts
import { readFields, writeFields, type FieldValue, type Schema } from "./fieldSchema";
```

Add the `MidBlock` interface and schema near the top-level constants (after `MID_BLOCK_LENGTH`):

```ts
export interface MidBlock {
  /** 6 opaque bytes before width (unmapped; typed in a later phase). */
  opaqueHead: Uint8Array;
  /** Map width in tiles (u32 LE at mid offset 6). */
  width: number;
  /** Map height in tiles (u32 LE at mid offset 10). */
  height: number;
  /** 41 opaque bytes after height (terrain/size scalars; unmapped until diff fixtures exist). */
  opaqueRest: Uint8Array;
}

// One ordered schema for the 55-byte mid-block, shared by decode and encode.
// Fixed widths MUST sum to MID_BLOCK_LENGTH: 6 + 4 + 4 + 41 = 55.
const MID_BLOCK_SCHEMA: Schema = [
  { name: "opaqueHead", type: { opaque: 6 } },
  { name: "width", type: "u32" },
  { name: "height", type: "u32" },
  { name: "opaqueRest", type: { opaque: 41 } },
];
```

In the `DecodedExchange` interface, replace:

```ts
  /** The 55-byte undecoded MapGenSettings block between autoplace and property_expression_names (terrain / water / starting area; varies per preset; mapped in Phase 1). */
  midBlock: Uint8Array;
```

with:

```ts
  /** The 55-byte MapGenSettings block between autoplace and property_expression_names, with width/height typed and the rest opaque (typed further in Phase 1c). */
  mid: MidBlock;
```

In `decodeExchangeString`, replace:

```ts
    const midBlock = reader.readBytes(MID_BLOCK_LENGTH);
```

with:

```ts
    const mid = readFields(reader, MID_BLOCK_SCHEMA) as unknown as MidBlock;
```

and in the returned object replace `midBlock,` with `mid,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `vp test decode`
Expected: FAIL to compile in `encode.spec`/`mapExchangeString` because `EncodableExchange` and `encodePayload` still reference `midBlock`. That is expected - Task 4 fixes encode. To confirm just the decode change in isolation, run:

Run: `vp test decode -t "mid block"`
Expected: the two new mid-block tests PASS. (Full `vp test` will not be green until Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: decode mid-block width/height via the field schema"
```

---

## Task 4: Encode the mid-block through the schema; restore full byte-exact round-trip

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/encode.spec.ts`

**Interfaces:**
- Consumes: `MidBlock`, `MID_BLOCK_SCHEMA`, `writeFields` from Task 3.
- Produces: `EncodableExchange.mid: MidBlock` (replaces `midBlock: Uint8Array`); `encodePayload` writes the mid-block via `writeFields`.

- [ ] **Step 1: Write the failing test**

`test/encode.spec.ts` already asserts the payload and string round-trips for all 9 fixtures via `it.each(NAMES)`. Add one explicit guard that an edited height survives encode, appended inside the `describe("encodePayload", ...)` block:

```ts
  it("round-trips an edited map height through the schema", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const edited = { ...decoded, mid: { ...decoded.mid, height: 128 } };
    const reDecoded = decodeExchangeString(
      `>>>${bytesToBase64(deflateLevel9(encodePayload(edited)))}<<<`,
    );
    expect(reDecoded.mid.height).toBe(128);
    expect(reDecoded.mid.width).toBe(2000000);
  });
```

Add the imports this test needs at the top of `test/encode.spec.ts`:

```ts
import { bytesToBase64 } from "../src/codec/base64";
import { deflateLevel9 } from "../src/codec/deflate";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test encode`
Expected: FAIL to compile - `encodePayload` reads `input.midBlock`, which no longer exists on `DecodedExchange`.

- [ ] **Step 3: Write the minimal implementation**

In `src/codec/mapExchangeString.ts`:

In the `EncodableExchange` interface, replace `midBlock: Uint8Array;` with `mid: MidBlock;`.

In `encodePayload`, replace:

```ts
  w.writeBytes(input.midBlock);
```

with:

```ts
  writeFields(w, MID_BLOCK_SCHEMA, input.mid as unknown as Record<string, FieldValue>);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `vp test encode decode fieldSchema`
Expected: PASS - all payload/string round-trips green (the `mid` object read by `readFields` is written back by `writeFields` byte-for-byte, so the 55 mid-block bytes are reproduced exactly), plus the new edited-height guard.

- [ ] **Step 5: Commit**

```bash
git add src/codec/mapExchangeString.ts test/encode.spec.ts
git commit -m "feat: encode mid-block via the field schema, byte-exact"
```

---

## Task 5: Surface width/height on the Preset model + convert bridge

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/convert.ts`
- Test: `test/store.spec.ts`

**Interfaces:**
- Consumes: `DecodedExchange.mid` / `EncodableExchange.mid` (Tasks 3-4).
- Produces: `Preset.width: number`, `Preset.height: number`, `Preset.opaqueMidHeadB64: string`, `Preset.opaqueMidRestB64: string` (replacing `Preset.opaqueMidB64`). `presetFromDecoded` / `presetToEncodable` map them.

- [ ] **Step 1: Write the failing test**

Append to `test/store.spec.ts` inside the `describe("presets store", ...)` block:

```ts
  it("exposes typed map width/height on the active preset and persists edits", () => {
    const store = usePresetsStore();
    expect(store.activePreset?.width).toBe(2000000);
    expect(store.activePreset?.height).toBe(2000000);

    const active = store.activePreset;
    if (active) active.height = 128;
    store.saveToStorage();

    setActivePinia(createPinia());
    const reloaded = usePresetsStore();
    expect(reloaded.activePreset?.height).toBe(128);

    // The edited height must survive the encode bridge, not just localStorage.
    const encoded = reloaded.activeExchangeString as string;
    expect(decodeExchangeString(encoded).mid.height).toBe(128);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test store`
Expected: FAIL to compile - `Preset` has no `width`/`height`; `convert.ts` still references `opaqueMidB64`.

- [ ] **Step 3: Write the minimal implementation**

In `src/model/types.ts`, replace the `opaqueMidB64` block:

```ts
  /**
   * Base64 of the undecoded 55-byte MapGenSettings block that sits between
   * autoplace and property_expression_names on the wire (terrain / water /
   * starting-area scalars; varies per preset). Mapped to typed fields in
   * Phase 1.
   */
  opaqueMidB64: string;
```

with:

```ts
  /** Map width in tiles (typed from the mid-block; editable). */
  width: number;
  /** Map height in tiles (typed from the mid-block; editable). */
  height: number;
  /** Base64 of the 6 opaque mid-block bytes before width (unmapped until Phase 1c). */
  opaqueMidHeadB64: string;
  /** Base64 of the 41 opaque mid-block bytes after height (unmapped until Phase 1c). */
  opaqueMidRestB64: string;
```

In `src/model/convert.ts`, in `presetFromDecoded`, replace:

```ts
    opaqueMidB64: bytesToBase64(decoded.midBlock),
```

with:

```ts
    width: decoded.mid.width,
    height: decoded.mid.height,
    opaqueMidHeadB64: bytesToBase64(decoded.mid.opaqueHead),
    opaqueMidRestB64: bytesToBase64(decoded.mid.opaqueRest),
```

In `presetToEncodable`, replace:

```ts
    midBlock: base64ToBytes(preset.opaqueMidB64),
```

with:

```ts
    mid: {
      opaqueHead: base64ToBytes(preset.opaqueMidHeadB64),
      width: preset.width,
      height: preset.height,
      opaqueRest: base64ToBytes(preset.opaqueMidRestB64),
    },
```

- [ ] **Step 4: Run the test to verify it passes, and confirm no stragglers reference the old field**

Run: `git grep -n "opaqueMidB64\|midBlock"`
Expected: no matches (all references migrated). If any remain, update them to the new fields before proceeding.

Run: `vp test`
Expected: PASS - full suite green, including the existing `presetToEncodable round-trips %s` and `activeExchangeString` byte-identity tests (which now flow width/height through convert without changing the bytes).

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts src/model/convert.ts test/store.spec.ts
git commit -m "feat: expose typed map width/height on the Preset model"
```

---

## Task 6: Editable Map width/height in the UI

**Files:**
- Modify: `src/components/AdvancedTab.vue`
- Test: `test/advancedTab.spec.ts`

**Interfaces:**
- Consumes: `Preset.width` / `Preset.height` (Task 5); `FNumberInput.vue` (existing: `modelValue: number`, emits `update:modelValue`).
- Produces: two number inputs bound to the active preset's `width`/`height`, tagged `data-test="map-width"` and `data-test="map-height"`.

- [ ] **Step 1: Write the failing test**

Create `test/advancedTab.spec.ts`:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import AdvancedTab from "../src/components/AdvancedTab.vue";
import { usePresetsStore } from "../src/store/presets";

describe("AdvancedTab", () => {
  it("shows the active preset's map width and height", () => {
    setActivePinia(createPinia());
    const wrapper = mount(AdvancedTab);
    expect(
      (wrapper.find('[data-test="map-width"]').element as HTMLInputElement).value,
    ).toBe("2000000");
    expect(
      (wrapper.find('[data-test="map-height"]').element as HTMLInputElement).value,
    ).toBe("2000000");
  });

  it("writes an edited height back to the active preset", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const input = wrapper.find('[data-test="map-height"]');
    (input.element as HTMLInputElement).value = "128";
    await input.trigger("change");
    expect(store.activePreset?.height).toBe(128);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `vp test advancedTab`
Expected: FAIL - no `[data-test="map-width"]` element exists yet.

- [ ] **Step 3: Write the minimal implementation**

In `src/components/AdvancedTab.vue`, update the `<script setup>` to expose the active preset and import `FNumberInput`:

```ts
<script setup lang="ts">
import { computed } from "vue";
import { usePresetsStore } from "../store/presets";
import FNumberInput from "../ui/FNumberInput.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const expressions = computed(() =>
  Object.entries(store.activePreset?.propertyExpressionNames ?? {}),
);
</script>
```

In the `<template>`, add a Map size section above the "Property expression names" heading (inside the `.advanced` div), and update the trailing note:

```html
    <h3>Map size</h3>
    <div v-if="preset" class="size-row">
      <label>Width <FNumberInput v-model="preset.width" data-test="map-width" /></label>
      <label>Height <FNumberInput v-model="preset.height" data-test="map-height" /></label>
    </div>
```

Replace the existing trailing `<p class="note">Read-only in Phase 0...` line with:

```html
    <p class="note">
      Terrain scale and map settings unlock in Phase 1c once their payload offsets are mapped.
    </p>
```

Add to the `<style scoped>` block:

```css
.size-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
```

Note: `FNumberInput` passes through `data-test` because Vue applies fallthrough attributes to its single root `<input>`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `vp test advancedTab`
Expected: PASS - both inputs render `2000000`, and a `change` to `128` writes back to `store.activePreset.height`.

- [ ] **Step 5: Run the full suite and lint, then commit**

Run: `vp check --fix; vp test`
Expected: lint/format clean, entire suite green.

```bash
git add src/components/AdvancedTab.vue test/advancedTab.spec.ts
git commit -m "feat: edit map width/height in the Advanced tab"
```

---

## Self-Review

**1. Scope coverage vs. Option A (the chosen design):**
- "One ordered schema shared by decode + encode" -> Tasks 1-2 (`fieldSchema.ts`), applied in Tasks 3-4.
- "Type the fields I understand, opaque-span fallback for the rest" -> mid-block schema types `width`/`height`, keeps `opaqueHead(6)` and `opaqueRest(41)`.
- "Byte-exact by construction" -> `writeFields` is the exact inverse of `readFields`; gated by the existing 9-fixture payload + string round-trips (Task 4) and the convert-bridge round-trip (Task 5).
- Everything the design flagged as uncertain (seed, size floats, tail, cliff anomaly, JSON export) is explicitly deferred to 1c with a stated blocker, not silently dropped.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows complete code and exact byte fixtures. Every run step names the command and expected outcome.

**3. Type consistency:** `MidBlock` (fields `opaqueHead`/`width`/`height`/`opaqueRest`) is defined once in Task 3 and reused verbatim in Tasks 4-5. `readFields`/`writeFields`/`FieldType`/`Schema`/`FieldValue` names are identical across Tasks 1-4. The `Preset` fields `width`/`height`/`opaqueMidHeadB64`/`opaqueMidRestB64` introduced in Task 5 match the `MidBlock` mapping and the UI bindings in Task 6. `DecodedExchange` remains structurally assignable to `EncodableExchange` (both carry `mid: MidBlock`), so `encode.spec` can keep passing `decoded` straight into `encodePayload`.

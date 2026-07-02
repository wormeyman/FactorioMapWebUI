# Factorio Map WebUI - Phase 1a (Encoder + Round-Trip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the map-exchange-string **encoder** so a preset edited in the tool exports a string the real Factorio 2.1.9 game accepts, and every fixture round-trips byte-for-byte at both the payload level (primary) and the full-string level (secondary).

**Architecture:** The encoder is the exact inverse of the Phase 0 decoder. It writes the payload (version, flag, code-point-sorted autoplace dict, opaque 55-byte mid-block, `property_expression_names` dict, opaque tail, CRC32), then deflates at zlib level 9 and wraps the `>>> base64 <<<` envelope. The 55-byte mid-block and the tail are carried as opaque base64 on the `Preset` model (a Phase 0 decision), so the encoder re-emits them verbatim and needs no field mapping of those regions. Byte-identical string output requires a deflate stream that matches the game's zlib@9; pako and fflate diverge, so this phase swaps compression to `zlib-asm` (an asm.js port of madler zlib), which was verified during planning to reproduce all 9 fixtures byte-for-byte for both deflate and inflate.

**Tech Stack:** TypeScript, Vue 3, Pinia, the Vite+ (`vp`) toolchain, `zlib-asm` (new), tests import from `vite-plus/test`.

## Global Constraints

- Target game version **Factorio 2.1.9 (experimental)**, map-exchange format tag **2.1.9.3**. The encoder writes the version tuple `[2, 1, 9, 3]` from `preset.formatVersion`; do not hardcode past the model.
- **Byte-exact deflate is required** (secondary success criterion). Use `zlib-asm/browser` at **level 9** only. Do not reintroduce `pako` or `fflate` for compression - both were verified during planning to diverge from the game's `78 da` stream on all 9 fixtures.
- **`autoplace_controls` keys MUST be emitted in code-point (ordinal) sort order** on encode, regardless of the object's insertion order (spec Sections 4 and 5). `-` (0x2d) sorts before `_` (0x5f); JS default `Array.prototype.sort()` on these ASCII names is code-point order, so plain `.sort()` is correct.
- **Flag byte is `0x00`** in every known fixture and is not carried on the model; the encoder writes the constant `0`.
- **Mid-block is exactly 55 bytes** (`MID_BLOCK_LENGTH`), carried opaquely as `preset.opaqueMidB64`; the encoder re-emits it verbatim.
- **Length-prefixed strings use a `uint8` length** (matches `BinaryReader.readString`); this is the format's convention for autoplace names and `property_expression_names` keys/values.
- **CRC32** uses the zlib/ANSI polynomial (already implemented in `src/codec/crc32.ts`), written as a `uint32` LE over all preceding payload bytes.
- **Envelope is a single line** (no base64 line-wrapping): `>>>` + `bytesToBase64(deflateLevel9(payload))` + `<<<`. The captured fixtures contain no interior newlines.
- Tests import from `vite-plus/test`, never `vitest`. Run the suite with `vp test`, lint/format with `vp check --fix`.
- Use hyphens (`-`), not em/en dashes, in any prose or comments.
- **Out of scope for Phase 1a** (deferred to a later plan): mapping the mid-block/tail into typed fields, resolving the Default cliff anomaly, JSON/ZIP export, and the presence-byte "absent optional" decode path (that path lives in the still-opaque tail).

---

## File Structure

- `src/codec/zlib-asm.d.ts` (create) - ambient type declaration for the `zlib-asm/browser` subpath (the package ships no types for it).
- `src/codec/deflate.ts` (modify) - swap `pako` for `zlib-asm/browser` for both `inflate` and `deflateLevel9`. Public signatures unchanged.
- `src/codec/binaryWriter.ts` (create) - `BinaryWriter`, the little-endian inverse of `BinaryReader`.
- `src/codec/mapExchangeString.ts` (modify) - add `EncodableExchange`, `encodePayload`, and `encodeExchangeString`.
- `src/model/convert.ts` (modify) - add `presetToEncodable`, the `Preset` -> `EncodableExchange` bridge.
- `src/store/presets.ts` (modify) - add an `activeExchangeString` getter.
- `src/components/ActionBar.vue` (modify) - add a "Copy string" button wired to the getter.
- `package.json` (modify) - remove `pako`, add `zlib-asm`.
- Tests (create): `test/binaryWriter.spec.ts`, `test/encode.spec.ts`. Tests (modify): `test/deflate.spec.ts` (flip the fidelity gate), `test/store.spec.ts` (export getter).

---

## Task 1: Byte-exact deflate via `zlib-asm`

Swap the compressor so `deflateLevel9` reproduces the game's stream byte-for-byte, and flip the Phase 0 compressor-fidelity gate from expected-fail to a hard assertion.

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/codec/zlib-asm.d.ts`
- Modify: `src/codec/deflate.ts`
- Modify: `test/deflate.spec.ts:34-37` (the `it.fails.each` fidelity block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `inflate(bytes: Uint8Array): Uint8Array` and `deflateLevel9(bytes: Uint8Array): Uint8Array` from `src/codec/deflate.ts` - same signatures as Phase 0, now byte-exact. All later tasks depend on `deflateLevel9` matching zlib@9.

- [ ] **Step 1: Install `zlib-asm`, remove `pako`**

Run:
```
pnpm remove pako && pnpm add zlib-asm@^1.0.7
```
Expected: `package.json` `dependencies` no longer lists `pako` and now lists `zlib-asm`. (`@types/pako` was already removed in Phase 0.)

- [ ] **Step 2: Add the ambient type declaration**

Create `src/codec/zlib-asm.d.ts`:
```ts
// The zlib-asm package ships no types for its browser subpath entry, which
// exposes only the pure (Buffer/stream-free) deflate/inflate. Both return a
// Uint8Array. Verified during Phase 1a planning to match the game's zlib@9
// byte-for-byte on all 9 fixtures.
declare module "zlib-asm/browser" {
  export function deflate(input: Uint8Array, level?: number, chunkSize?: number): Uint8Array;
  export function inflate(input: Uint8Array, chunkSize?: number): Uint8Array;
}
```

- [ ] **Step 3: Flip the fidelity test to a hard assertion (write the now-passing test)**

In `test/deflate.spec.ts`, replace the `it.fails.each` block (lines 29-37, the comment plus the test) with:
```ts
  // COMPRESSOR-FIDELITY GATE (spec Sections 6 and 10): deflateLevel9 must
  // reproduce the game's zlib@9 stream byte-for-byte, or byte-identical STRING
  // export is off the table. pako and fflate diverge; zlib-asm matches. If this
  // regresses, the compressor changed - do not weaken it, fix the compressor.
  it.each(NAMES)("level 9 reproduces the compressed bytes of %s", (name) => {
    const compressed = compressedBytesOf(presets[name] as string);
    expect(deflateLevel9(inflate(compressed))).toEqual(compressed);
  });
```

- [ ] **Step 4: Run the fidelity test - it must still FAIL (pako is unchanged)**

Run: `vp test deflate -t "reproduces the compressed bytes"`
Expected: FAIL on all 9 (pako diverges). This confirms the test is real before the fix.

- [ ] **Step 5: Swap the compressor implementation**

Replace the entire contents of `src/codec/deflate.ts` with:
```ts
import { deflate as zlibDeflate, inflate as zlibInflate } from "zlib-asm/browser";

export function inflate(bytes: Uint8Array): Uint8Array {
  return zlibInflate(bytes);
}

/**
 * zlib deflate pinned to level 9 (Z_BEST_COMPRESSION) to match the `78 da`
 * streams Factorio emits. Backed by zlib-asm (an asm.js port of madler zlib):
 * verified to reproduce all 9 fixtures byte-for-byte, where pako/fflate diverge.
 * Do not change the level or the library: byte-identical string export depends
 * on it (spec Section 6).
 */
export function deflateLevel9(bytes: Uint8Array): Uint8Array {
  return zlibDeflate(bytes, 9);
}
```

- [ ] **Step 6: Run the fidelity + existing deflate tests - now PASS**

Run: `vp test deflate`
Expected: PASS, including the 9 "reproduces the compressed bytes" cases and the existing "78 da header" + inflate-size cases.

- [ ] **Step 7: Run the full suite (decode still green through the new inflate)**

Run: `vp test`
Expected: PASS. `test/decode.spec.ts` re-deflates tampered payloads through `deflateLevel9` and inflates fixtures through `inflate`; both must still work.

- [ ] **Step 8: Gate the browser bundle**

Run: `vp build`
Expected: SUCCESS. `zlib-asm`'s asm.js module contains a `require("fs")`/`require("path")` guarded by an `ENVIRONMENT_IS_NODE` check that never executes in the browser. Vite/rolldown externalizes those builtins with a shim that only throws if accessed, so the build should succeed (a warning about externalized `fs`/`path` is acceptable).

If and only if `vp build` hard-errors on resolving `fs`/`path`, add this stub to `vite.config.ts` inside the `defineConfig` object and re-run:
```ts
  resolve: {
    alias: {
      // zlib-asm's Node memory-init fallback (dead code in the browser build)
      fs: new URL("./src/codec/empty-stub.ts", import.meta.url).pathname,
      path: new URL("./src/codec/empty-stub.ts", import.meta.url).pathname,
    },
  },
```
and create `src/codec/empty-stub.ts` with `export default {};`.

- [ ] **Step 9: Lint and commit**

Run: `vp check --fix`
Then:
```
git add -A
git commit -m "feat: byte-exact deflate via zlib-asm; enable compressor-fidelity gate"
```

---

## Task 2: `BinaryWriter`

The little-endian inverse of `BinaryReader` (`src/codec/binaryReader.ts`), used to assemble the payload.

**Files:**
- Create: `src/codec/binaryWriter.ts`
- Test: `test/binaryWriter.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class BinaryWriter` with `writeUint8(v: number)`, `writeUint16(v: number)`, `writeUint32(v: number)`, `writeFloat32(v: number)`, `writeFloat64(v: number)`, `writeBytes(b: Uint8Array)`, `writeString(s: string)`, `toBytes(): Uint8Array`, and a `length` getter. `writeString` writes a `uint8` length prefix then UTF-8 bytes. Task 3 uses all of these.

- [ ] **Step 1: Write the failing test**

Create `test/binaryWriter.spec.ts`:
```ts
import { describe, expect, it } from "vite-plus/test";
import { BinaryReader } from "../src/codec/binaryReader";
import { BinaryWriter } from "../src/codec/binaryWriter";

describe("BinaryWriter", () => {
  it("writes little-endian primitives that BinaryReader reads back", () => {
    const w = new BinaryWriter();
    w.writeUint8(0xab);
    w.writeUint16(0x1234);
    w.writeUint32(0xdeadbeef);
    w.writeFloat32(1.5);
    w.writeFloat64(2.25);
    const r = new BinaryReader(w.toBytes());
    expect(r.readUint8()).toBe(0xab);
    expect(r.readUint16()).toBe(0x1234);
    expect(r.readUint32()).toBe(0xdeadbeef);
    expect(r.readFloat32()).toBe(1.5);
    expect(r.readFloat64()).toBe(2.25);
  });

  it("writes uint16 in little-endian byte order", () => {
    const w = new BinaryWriter();
    w.writeUint16(0x1234);
    expect([...w.toBytes()]).toEqual([0x34, 0x12]);
  });

  it("writes a uint8-length-prefixed UTF-8 string, including the empty string", () => {
    const w = new BinaryWriter();
    w.writeString("coal");
    w.writeString("");
    expect([...w.toBytes()]).toEqual([4, 0x63, 0x6f, 0x61, 0x6c, 0]);
    const r = new BinaryReader(w.toBytes());
    expect(r.readString()).toBe("coal");
    expect(r.readString()).toBe("");
  });

  it("appends raw bytes verbatim and tracks length", () => {
    const w = new BinaryWriter();
    w.writeUint8(1);
    w.writeBytes(new Uint8Array([9, 8, 7]));
    expect(w.length).toBe(4);
    expect([...w.toBytes()]).toEqual([1, 9, 8, 7]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test binaryWriter`
Expected: FAIL - `BinaryWriter` not found / not a constructor.

- [ ] **Step 3: Write the implementation**

Create `src/codec/binaryWriter.ts`:
```ts
const utf8 = new TextEncoder();

/** Sequential little-endian writer; the inverse of BinaryReader. */
export class BinaryWriter {
  private readonly bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));

  get length(): number {
    return this.bytes.length;
  }

  private pushScratch(n: number): void {
    for (let i = 0; i < n; i++) {
      this.bytes.push(this.scratch.getUint8(i));
    }
  }

  writeUint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeUint16(value: number): void {
    this.scratch.setUint16(0, value, true);
    this.pushScratch(2);
  }

  writeUint32(value: number): void {
    this.scratch.setUint32(0, value >>> 0, true);
    this.pushScratch(4);
  }

  writeFloat32(value: number): void {
    this.scratch.setFloat32(0, value, true);
    this.pushScratch(4);
  }

  writeFloat64(value: number): void {
    this.scratch.setFloat64(0, value, true);
    this.pushScratch(8);
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.bytes.push(byte);
    }
  }

  writeString(value: string): void {
    const encoded = utf8.encode(value);
    this.writeUint8(encoded.length);
    this.writeBytes(encoded);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test binaryWriter`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Lint and commit**

Run: `vp check --fix`
Then:
```
git add src/codec/binaryWriter.ts test/binaryWriter.spec.ts
git commit -m "feat: add little-endian BinaryWriter"
```

---

## Task 3: Payload encoder (`encodePayload`)

Assemble the uncompressed payload (through the CRC) as the exact inverse of the decoder, with autoplace keys sorted.

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/encode.spec.ts` (create)

**Interfaces:**
- Consumes: `BinaryWriter` (Task 2); `crc32` from `src/codec/crc32.ts`; the existing `AutoplaceSetting`, `FormatVersion`, `decodeExchangeString`, and `DecodedExchange` from `src/codec/mapExchangeString.ts`.
- Produces: `interface EncodableExchange { version: FormatVersion; flagByte: number; autoplaceControls: Record<string, AutoplaceSetting>; midBlock: Uint8Array; propertyExpressionNames: Record<string, string>; tail: Uint8Array; }` and `encodePayload(input: EncodableExchange): Uint8Array` (returns the full payload including the trailing CRC). Note `DecodedExchange` is structurally assignable to `EncodableExchange` (it has all six fields plus extras), so a decoded fixture can be passed directly. Tasks 4 and 5 consume both.

- [ ] **Step 1: Write the failing test**

Create `test/encode.spec.ts`:
```ts
import { describe, expect, it } from "vite-plus/test";
import { decodeExchangeString, encodePayload } from "../src/codec/mapExchangeString";
import fixtures from "./fixtures/builtin-presets.json";

const presets = fixtures.presets as Record<string, string>;
const NAMES = Object.keys(presets);

describe("encodePayload", () => {
  it.each(NAMES)("rebuilds the %s payload byte-for-byte (primary round-trip)", (name) => {
    const decoded = decodeExchangeString(presets[name] as string);
    expect(encodePayload(decoded)).toEqual(decoded.payload);
  });

  it("emits autoplace keys in code-point order regardless of insertion order", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    // Reinsert the controls in reverse order; the encoder must still sort them.
    const shuffled = Object.fromEntries(Object.entries(decoded.autoplaceControls).reverse());
    const scrambled = { ...decoded, autoplaceControls: shuffled };
    expect(encodePayload(scrambled)).toEqual(decoded.payload);
  });

  it("round-trips the empty and the populated property_expression_names dict", () => {
    for (const name of ["Default", "Lakes", "Ribbon world"]) {
      const decoded = decodeExchangeString(presets[name] as string);
      expect(encodePayload(decoded)).toEqual(decoded.payload);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test encode`
Expected: FAIL - `encodePayload` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/codec/mapExchangeString.ts`, add these imports at the top (alongside the existing ones):
```ts
import { BinaryWriter } from "./binaryWriter";
```
Then append to the file:
```ts
export interface EncodableExchange {
  version: FormatVersion;
  flagByte: number;
  autoplaceControls: Record<string, AutoplaceSetting>;
  midBlock: Uint8Array;
  propertyExpressionNames: Record<string, string>;
  tail: Uint8Array;
}

/**
 * Assemble the uncompressed payload (through the trailing CRC) as the exact
 * inverse of decodeExchangeString. Autoplace keys are emitted in code-point
 * order (spec Sections 4 and 5); the mid-block and tail are re-emitted verbatim.
 */
export function encodePayload(input: EncodableExchange): Uint8Array {
  const w = new BinaryWriter();
  for (const part of input.version) {
    w.writeUint16(part);
  }
  w.writeUint8(input.flagByte);

  const controlNames = Object.keys(input.autoplaceControls).sort();
  w.writeUint8(controlNames.length);
  for (const name of controlNames) {
    const control = input.autoplaceControls[name] as AutoplaceSetting;
    w.writeString(name);
    w.writeFloat32(control.frequency);
    w.writeFloat32(control.size);
    w.writeFloat32(control.richness);
  }

  w.writeBytes(input.midBlock);

  const propertyKeys = Object.keys(input.propertyExpressionNames);
  w.writeUint8(propertyKeys.length);
  for (const key of propertyKeys) {
    w.writeString(key);
    w.writeString(input.propertyExpressionNames[key] as string);
  }

  w.writeBytes(input.tail);

  const body = w.toBytes();
  const payload = new Uint8Array(body.length + 4);
  payload.set(body, 0);
  new DataView(payload.buffer).setUint32(body.length, crc32(body), true);
  return payload;
}
```
(`crc32` is already imported at the top of the file from Phase 0.)

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test encode`
Expected: PASS - all 9 payload rebuilds plus the sort and dict tests.

- [ ] **Step 5: Lint and commit**

Run: `vp check --fix`
Then:
```
git add src/codec/mapExchangeString.ts test/encode.spec.ts
git commit -m "feat: encode map-exchange payload (inverse of decode, sorted autoplace)"
```

---

## Task 4: Exchange-string encoder (`encodeExchangeString`) + string round-trip

Wrap `encodePayload` with deflate + base64 + envelope and prove full-string byte-identity.

**Files:**
- Modify: `src/codec/mapExchangeString.ts`
- Test: `test/encode.spec.ts` (extend)

**Interfaces:**
- Consumes: `encodePayload` and `EncodableExchange` (Task 3); `deflateLevel9` from `src/codec/deflate.ts` (Task 1); `bytesToBase64` from `src/codec/base64.ts`.
- Produces: `encodeExchangeString(input: EncodableExchange): string` - the full `>>> ... <<<` string. Tasks 5 and 6 consume it.

- [ ] **Step 1: Write the failing test**

Append to `test/encode.spec.ts` a new block (add `encodeExchangeString` to the import from `../src/codec/mapExchangeString`):
```ts
describe("encodeExchangeString", () => {
  it.each(NAMES)("re-emits the exact %s string (secondary round-trip)", (name) => {
    const original = presets[name] as string;
    const decoded = decodeExchangeString(original);
    expect(encodeExchangeString(decoded)).toBe(original);
  });

  it("produces a single-line >>> ... <<< envelope with no interior whitespace", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const out = encodeExchangeString(decoded);
    expect(out.startsWith(">>>")).toBe(true);
    expect(out.endsWith("<<<")).toBe(true);
    expect(/\s/.test(out.slice(3, -3))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test encode -t "encodeExchangeString"`
Expected: FAIL - `encodeExchangeString` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/codec/mapExchangeString.ts`, add to the imports:
```ts
import { bytesToBase64 } from "./base64";
import { deflateLevel9 } from "./deflate";
```
(the file already imports `base64ToBytes`, `inflate`, `crc32`; add the two names above.) Then append:
```ts
/**
 * Encode a full map-exchange string: payload -> zlib deflate@9 -> base64,
 * wrapped in the >>> <<< envelope on a single line (the game ignores interior
 * whitespace on import, and the captured fixtures carry none).
 */
export function encodeExchangeString(input: EncodableExchange): string {
  const compressed = deflateLevel9(encodePayload(input));
  return `>>>${bytesToBase64(compressed)}<<<`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test encode`
Expected: PASS - all 9 strings re-emitted exactly, plus the envelope-shape test.

- [ ] **Step 5: Lint and commit**

Run: `vp check --fix`
Then:
```
git add src/codec/mapExchangeString.ts test/encode.spec.ts
git commit -m "feat: encode full map-exchange string with byte-identical round-trip"
```

---

## Task 5: Model bridge (`presetToEncodable`) + float32 precision test

Convert a `Preset` (the UI/store shape, with opaque base64 blocks) into an `EncodableExchange`, and pin the documented float32 rounding behavior.

**Files:**
- Modify: `src/model/convert.ts`
- Test: `test/encode.spec.ts` (extend)

**Interfaces:**
- Consumes: `Preset` from `src/model/types.ts`; `EncodableExchange` from `src/codec/mapExchangeString.ts` (Task 3); `base64ToBytes` from `src/codec/base64.ts`.
- Produces: `presetToEncodable(preset: Preset): EncodableExchange`. Task 6 consumes it.

- [ ] **Step 1: Write the failing test**

Append to `test/encode.spec.ts` (add imports: `presetFromDecoded` and `presetToEncodable` from `../src/model/convert`):
```ts
describe("presetToEncodable", () => {
  it.each(NAMES)("round-trips %s through the full Preset model path", (name) => {
    const original = presets[name] as string;
    const decoded = decodeExchangeString(original);
    const preset = presetFromDecoded(name, decoded);
    expect(encodeExchangeString(presetToEncodable(preset))).toBe(original);
  });

  it("rounds a non-float32-representable richness on encode (documented, not a bug)", () => {
    const decoded = decodeExchangeString(presets["Default"] as string);
    const preset = presetFromDecoded("edited", decoded);
    (preset.autoplaceControls["coal"] as { richness: number }).richness = 1.3;
    const reDecoded = decodeExchangeString(encodeExchangeString(presetToEncodable(preset)));
    // 1.3 is not exactly representable as float32; it round-trips to fround(1.3).
    expect(reDecoded.autoplaceControls["coal"]?.richness).toBe(Math.fround(1.3));
    expect(reDecoded.autoplaceControls["coal"]?.richness).not.toBe(1.3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test encode -t "presetToEncodable"`
Expected: FAIL - `presetToEncodable` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/model/convert.ts`, add to the imports:
```ts
import { base64ToBytes } from "../codec/base64";
import type { EncodableExchange } from "../codec/mapExchangeString";
```
(the file already imports `bytesToBase64`; keep it.) Then append:
```ts
/**
 * Bridge a Preset back to the encoder's input. The flag byte is a constant 0
 * (never observed otherwise); the mid-block and tail are decoded from their
 * opaque base64 carriers and re-emitted verbatim.
 */
export function presetToEncodable(preset: Preset): EncodableExchange {
  return {
    version: preset.formatVersion,
    flagByte: 0,
    autoplaceControls: preset.autoplaceControls,
    midBlock: base64ToBytes(preset.opaqueMidB64),
    propertyExpressionNames: preset.propertyExpressionNames,
    tail: base64ToBytes(preset.opaqueTailB64),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test encode`
Expected: PASS - all 9 model-path round-trips plus the float32 precision test.

- [ ] **Step 5: Lint and commit**

Run: `vp check --fix`
Then:
```
git add src/model/convert.ts test/encode.spec.ts
git commit -m "feat: bridge Preset to encoder input; pin float32 rounding behavior"
```

---

## Task 6: Store export getter + "Copy string" UI button

Expose the active preset's exchange string from the store and add a Copy button to the action bar.

**Files:**
- Modify: `src/store/presets.ts`
- Modify: `src/components/ActionBar.vue`
- Test: `test/store.spec.ts` (extend)

**Interfaces:**
- Consumes: `encodeExchangeString` (Task 4); `presetToEncodable` (Task 5); the existing `usePresetsStore`.
- Produces: an `activeExchangeString` getter on the presets store returning `string | null`; a `data-test="copy-string"` button in `ActionBar.vue`.

- [ ] **Step 1: Write the failing test**

`test/store.spec.ts` already has a `beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); })` and imports `usePresetsStore`. Change its line 3 import from `import { ExchangeStringError } from "../src/codec/mapExchangeString";` to `import { decodeExchangeString, ExchangeStringError } from "../src/codec/mapExchangeString";`, then append this test inside the existing `describe("presets store", ...)` block:
```ts
  it("exposes an activeExchangeString that decodes back to the active preset", () => {
    const store = usePresetsStore();
    const active = store.activePreset;
    expect(active).toBeDefined();
    const encoded = store.activeExchangeString;
    expect(encoded).not.toBeNull();
    const decoded = decodeExchangeString(encoded as string);
    expect(Object.keys(decoded.autoplaceControls)).toEqual(
      Object.keys((active as NonNullable<typeof active>).autoplaceControls).sort(),
    );
    expect(decoded.version).toEqual([2, 1, 9, 3]);
  });
```
(If `test/store.spec.ts` does not already import `usePresetsStore` and set up Pinia with `setActivePinia(createPinia())` in a `beforeEach`, add that setup mirroring the existing tests in the file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test store -t "activeExchangeString"`
Expected: FAIL - `activeExchangeString` is `undefined`.

- [ ] **Step 3: Implement the store getter**

In `src/store/presets.ts`, add these imports:
```ts
import { encodeExchangeString } from "../codec/mapExchangeString";
import { presetToEncodable } from "../model/convert";
```
Then add a getter next to `activePreset` in the `getters` block:
```ts
    activeExchangeString(): string | null {
      const active = this.activePreset;
      return active ? encodeExchangeString(presetToEncodable(active)) : null;
    },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test store`
Expected: PASS.

- [ ] **Step 5: Wire the Copy button in the action bar**

In `src/components/ActionBar.vue`, add a Copy button before the `Duplicate` button and a handler. Replace the `<script setup>` block and the button row as follows.

Script:
```ts
<script setup lang="ts">
import { usePresetsStore } from "../store/presets";
import FButton from "../ui/FButton.vue";

const store = usePresetsStore();
const emit = defineEmits<{ "import-requested": [] }>();

async function copyString() {
  const text = store.activeExchangeString;
  if (text && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}
</script>
```
Add this button immediately after the `open-import` button (before `<span class="spacer" />`):
```html
    <FButton data-test="copy-string" :disabled="!store.activeExchangeString" @click="copyString()">
      Copy string
    </FButton>
```
Leave the disabled "Download ZIP" button as-is (still deferred), but update its title to `"ZIP export lands in a later phase"`.

- [ ] **Step 6: Add a render test for the button**

Create `test/actionBar.spec.ts` (ActionBar has no existing test file; `test/ui-kit.spec.ts` covers only the `F*` kit):
```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import ActionBar from "../src/components/ActionBar.vue";

describe("ActionBar", () => {
  it("renders an enabled Copy string button when a preset is active", () => {
    setActivePinia(createPinia());
    const wrapper = mount(ActionBar);
    const button = wrapper.find('[data-test="copy-string"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run tests and lint**

Run: `vp test` then `vp check --fix`
Expected: full suite PASS.

- [ ] **Step 8: Commit**

```
git add src/store/presets.ts src/components/ActionBar.vue test/store.spec.ts test/actionBar.spec.ts
git commit -m "feat: export active preset as exchange string with a Copy button"
```

---

## Final verification

- [ ] Run the whole suite: `vp test` - expected all green, no `it.fails`/`skip` remaining for the compressor gate.
- [ ] Run `vp check` (no `--fix`) - expected clean.
- [ ] Run `vp build` - expected success (browser bundle includes zlib-asm).
- [ ] Manual smoke via `vp dev`: select a preset, edit an autoplace value, click "Copy string", paste into a decoder (or re-import via "Import string") and confirm it round-trips. Optionally paste into the real Factorio 2.1.9 map-generator import to confirm the game accepts it (success criterion #2).

## Spec coverage check (Phase 1a slice)

- Success criterion #1 (payload-level round-trip, primary): Task 3.
- Success criterion #1 secondary (full-string byte-identity, deflate pinned to level 9): Tasks 1 + 4.
- Success criterion #2 (game accepts an exported string): Tasks 4-6 + final manual smoke.
- Compressor-fidelity gate (spec Sections 6, 10): Task 1.
- Autoplace code-point ordinal sort on encode (spec Sections 4, 5): Task 3.
- float32 precision (spec Section 10): Task 5.
- Copy exchange string in the UI (spec Section 8, "copy exchange string"): Task 6.

**Deferred to a later plan (not in this slice, by decision):** ZIP + JSON export, mid-block/tail field mapping, Default cliff-anomaly resolution, the presence-byte absent-optional decode path, and Appendix A JSON schema capture. The absent-optional test from spec Section 10 is deferred because that branch lives entirely in the still-opaque tail; there is no presence-byte logic in this slice to exercise.

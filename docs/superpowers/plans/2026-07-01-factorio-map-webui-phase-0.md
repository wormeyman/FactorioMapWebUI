# Factorio Map WebUI - Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, Factorio-styled, multi-planet map-generation-preset editor: fixture-driven codec **decode**, the settings model derived from the fixtures, a Factorio UI kit, the full editor, and localStorage presets. No encode/export (that is Phase 1, a separate plan).

**Architecture:** Layered per the spec (`docs/superpowers/specs/2026-07-01-factorio-map-webui-design.md`): a plain-TypeScript codec with zero Vue dependency (envelope -> base64 -> zlib inflate -> CRC-verified binary payload), a typed settings model whose reference data (control catalog, built-in presets) is pinned to the 9 committed fixtures, a Pinia store persisted to localStorage, and Vue 3 components styled to match `webmapgenerator.png`. Bytes the decoder does not yet understand (terrain/cliff/map-settings tail) are carried opaquely in the model so Phase 1 encode can round-trip them.

**Tech Stack:** Vite+ (`vp` CLI v0.2.1, `vite-plus` package), Vue 3 + TypeScript SFCs, Pinia, pako (zlib), pnpm, Node 24.18.0.

## Global Constraints

- Target game version: Factorio **2.1.9 (experimental)**, exchange format tag **`2.1.9.3`** (four `uint16` LE).
- Package manager: **pnpm**. Node pinned to **`24.18.0`** via `.node-version`.
- Toolchain: **Vite+** only - `vp install`, `vp dev`, `vp check --fix`, `vp test`, `vp build`. Config via `defineConfig` from `'vite-plus'`. Tests import from **`'vite-plus/test'`**, never `'vitest'`.
- Compression is **zlib level 9** (`78 da` header). Never use `CompressionStream`.
- All multi-byte integers/floats in the payload are **little-endian**.
- Observed dictionary counts (autoplace = 28, property_expression_names) are **plain `uint8`, NOT varint**. Do not varint-encode or varint-decode any count in Phase 0.
- Autoplace keys serialize in **ordinal (code-point) sort order**; the model may hold them in any order.
- The codec must have **zero Vue/Pinia imports**.
- In all files use hyphens (`-`), never em dashes (user rule).
- Fixtures in `test/fixtures/builtin-presets.json` are read-only ground truth; never regenerate or reformat them.
- Every task ends with `vp check --fix` clean and `vp test` green before its commit.

## File structure (end state of Phase 0)

```
FactorioMapWebUI/
  .node-version                  # 24.18.0
  index.html
  package.json                   # vp scripts, pnpm
  vite.config.ts                 # defineConfig from 'vite-plus'
  tsconfig.json (+ scaffold companions)
  src/
    main.ts
    App.vue                      # layout grid, planet selection state
    ui/                          # Task 9: factorio.css + FPanel FButton FSlider
                                 #   FCheckbox FDropdown FNumberInput FTabs
    components/                  # Tasks 10-11: PresetBar, ControlRow, ControlTable,
                                 #   ResourcesTab, TerrainTab, EnemyTab, AdvancedTab,
                                 #   PreviewPanel, ActionBar, ImportPanel
    model/
      types.ts                   # Preset, AutoplaceSetting
      planets.ts                 # PLANETS, PLANET_LABELS
      controlCatalog.ts          # 28 controls -> planet/category/label/hasRichness
      convert.ts                 # presetFromDecoded()
      builtins.ts                # 9 built-in presets decoded from fixtures (defaults source)
    codec/
      base64.ts                  # bytesToBase64 / base64ToBytes
      crc32.ts
      binaryReader.ts
      deflate.ts                 # pako wrappers, level 9 pinned
      mapExchangeString.ts       # decodeExchangeString + errors
    store/
      presets.ts                 # Pinia + localStorage
  test/
    fixtures/builtin-presets.json   # existing, untouched
    fixtures.spec.ts
    crc32.spec.ts
    base64.spec.ts
    binaryReader.spec.ts
    deflate.spec.ts
    decode.spec.ts
    catalog.spec.ts
    builtins.spec.ts
    store.spec.ts
    ui-kit.spec.ts
    app.spec.ts
```

Out of scope for this plan (Phase 1 plan, written after this one lands): encoder + binaryWriter + stringDict cliff rule, payload/string round-trip tests, the Default cliff-anomaly re-capture, absent-optional and float32-rounding tests, JSON/ZIP export, JSON import, Appendix A schema dumps, seed wiring into the payload, Cloudflare Pages deploy.

---

### Task 1: Scaffold via `vp create vue` and convert to the Vite+ toolchain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json` (+ any `tsconfig.*.json` the template emits), `index.html`, `env.d.ts`, `src/main.ts`, `src/App.vue`, `.node-version`, `test/fixtures.spec.ts`
- Modify: `.gitignore` (merge template entries into the existing file)
- Test: `test/fixtures.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a repo where `vp install`, `vp check --fix`, `vp test`, `vp dev`, `vp build` all work; `test/*.spec.ts` files run under `vp test` with a `happy-dom` environment; later tasks assume `pako`, `@types/pako`, `pinia`, `@vue/test-utils` are installed.

- [ ] **Step 1: Scaffold into a scratch subdirectory**

The repo root is non-empty (docs/, test/, webmapgenerator.png), so scaffold to `.scaffold/` and merge:

```fish
cd /Users/ericjohnson/GitHub/FactorioMapWebUI
vp create vue --directory .scaffold --package-manager pnpm --no-git --no-agent --no-interactive -- --typescript --pinia --bare
```

`vp create vue` shells out to `create-vue`. If the `--typescript --pinia --bare` template options are rejected, run `vp create vue --directory .scaffold -- --help` and use the current flag names for: TypeScript on, Pinia on, no router, no vitest/eslint/prettier (Vite+ replaces them), minimal/bare example code. Interactive fallback is fine; select those same answers.

- [ ] **Step 2: Merge the scaffold into the repo root**

```fish
cp -R .scaffold/src .scaffold/index.html .scaffold/package.json .scaffold/env.d.ts .
cp .scaffold/tsconfig*.json .
cat .scaffold/.gitignore >> .gitignore
rm -rf .scaffold
```

Then deduplicate `.gitignore` by hand (it must ignore `node_modules/`, `dist/`, `*.local`, editor cruft). If the template emitted files not listed above (e.g. `public/`), copy them too - `ls -A .scaffold` first.

- [ ] **Step 3: Convert package.json to Vite+**

Edit `package.json` so the tool sections look exactly like this (keep the template's `name`/`version` lines; versions below are minimums - let pnpm resolve latest):

```json
{
  "name": "factorio-map-webui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vp dev",
    "build": "vp build",
    "test": "vp test",
    "check": "vp check --fix"
  },
  "engines": { "node": ">=24.18.0" }
}
```

Then replace the dependency set:

```fish
pnpm remove vite vitest eslint prettier vue-tsc 2>/dev/null; true
pnpm add vue pinia pako
pnpm add -D vite-plus @vitejs/plugin-vue @types/pako @vue/test-utils happy-dom typescript
```

(Only remove packages that are actually present; `pnpm remove` on a missing package errors, hence the `; true`.)

- [ ] **Step 4: Pin Node and write vite.config.ts**

```fish
echo 24.18.0 > .node-version
```

Replace `vite.config.ts` with:

```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
  },
})
```

If `vp test` later complains about the `test` key location, consult `vp test --help` / https://viteplus.dev docs and move it where Vite+ expects; the requirement is: spec files under `test/` run with a `happy-dom` DOM.

Also confirm the app tsconfig has `"resolveJsonModule": true` (add it to `compilerOptions` if the template base does not provide it) - Task 7 imports `test/fixtures/builtin-presets.json` from `src/`. Make sure the tsconfig that covers `test/` includes `test/**/*` in its `include`.

- [ ] **Step 5: Write the first (permanent) test - fixture sanity**

Create `test/fixtures.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import fixtures from './fixtures/builtin-presets.json'

describe('builtin-presets fixture file', () => {
  it('contains all 9 built-in presets wrapped in >>> <<<', () => {
    const presets = fixtures.presets as Record<string, string>
    expect(Object.keys(presets)).toEqual([
      'Default',
      'Rich Resources',
      'Marathon',
      'Death world',
      'Death world marathon',
      'Rail world',
      'Ribbon world',
      'Lakes',
      'Island',
    ])
    for (const s of Object.values(presets)) {
      expect(s.startsWith('>>>')).toBe(true)
      expect(s.endsWith('<<<')).toBe(true)
    }
  })
})
```

- [ ] **Step 6: Install, check, test, build**

```fish
vp install
vp check --fix
vp test
vp build
```

Expected: all succeed; `vp test` reports 1 passed file. Fix any scaffold leftovers `vp check` flags (delete template example components/stores you do not need - keep `src/App.vue` minimal, it is rewritten in Task 10).

- [ ] **Step 7: Set up git hooks (vp config + vp staged)**

Per the spec, pre-commit runs `vp check --fix` on staged files via `vp staged`. Run `vp config --help` and `vp staged --help`; wire the hook the way the CLI documents (vp v0.2.1). If no built-in hook installer exists, write `.git/hooks/pre-commit`:

```sh
#!/bin/sh
exec vp staged
```

and `chmod +x .git/hooks/pre-commit`. Verify: stage a file with bad formatting, run `git commit`, confirm the hook runs.

- [ ] **Step 8: Commit**

```fish
git add -A
git commit -m "feat: scaffold Vue 3 app on the Vite+ toolchain"
```

---

### Task 2: codec/base64.ts + codec/crc32.ts

**Files:**
- Create: `src/codec/base64.ts`, `src/codec/crc32.ts`
- Test: `test/base64.spec.ts`, `test/crc32.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `base64ToBytes(b64: string): Uint8Array`, `bytesToBase64(bytes: Uint8Array): string`, `crc32(bytes: Uint8Array): number` (unsigned 32-bit, zlib/ANSI polynomial `0xedb88320`).

- [ ] **Step 1: Write the failing tests**

`test/crc32.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { crc32 } from '../src/codec/crc32'

describe('crc32', () => {
  it('matches the standard check value for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789')
    expect(crc32(bytes)).toBe(0xcbf43926)
  })

  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('is unsigned even when the top bit is set', () => {
    const bytes = new TextEncoder().encode('a')
    expect(crc32(bytes)).toBe(0xe8b7be43)
    expect(crc32(bytes)).toBeGreaterThan(0)
  })
})
```

`test/base64.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { base64ToBytes, bytesToBase64 } from '../src/codec/base64'

describe('base64', () => {
  it('round-trips arbitrary bytes including 0x00 and 0xff', () => {
    const bytes = new Uint8Array([0, 1, 2, 0x78, 0xda, 0xff, 254, 127])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('decodes a known vector', () => {
    expect(base64ToBytes('eNo=')).toEqual(new Uint8Array([0x78, 0xda]))
  })

  it('throws on invalid base64', () => {
    expect(() => base64ToBytes('!!!not base64!!!')).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/codec/crc32` / `../src/codec/base64`.

- [ ] **Step 3: Implement**

`src/codec/crc32.ts`:

```ts
const TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  TABLE[n] = c >>> 0
}

/** CRC32 (zlib/ANSI polynomial), returned as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
```

`src/codec/base64.ts`:

```ts
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS (crc32 x3, base64 x3).

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/codec test
git commit -m "feat: add crc32 and base64 codec primitives"
```

---

### Task 3: codec/binaryReader.ts

**Files:**
- Create: `src/codec/binaryReader.ts`
- Test: `test/binaryReader.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class BinaryReader` with `constructor(bytes: Uint8Array)`, `position: number`, `length: number`, `readUint8(): number`, `readUint16(): number` (LE), `readUint32(): number` (LE), `readFloat32(): number` (LE), `readFloat64(): number` (LE), `readBytes(n: number): Uint8Array`, `readString(): string` (uint8 length prefix + UTF-8 bytes), `remaining(): Uint8Array`. All reads past the end throw `RangeError`.

Note: BinaryWriter, presence-byte optionals, and the space-optimized varint are deliberately absent - they are encoder concerns proven in Phase 1 against fixtures (Global Constraints: no varint in Phase 0).

- [ ] **Step 1: Write the failing test**

`test/binaryReader.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { BinaryReader } from '../src/codec/binaryReader'

describe('BinaryReader', () => {
  it('reads little-endian primitives in sequence', () => {
    // u8=0x2a, u16=0x0102, u32=0x01020304, f32=1.5, f64=2.5
    const r = new BinaryReader(
      new Uint8Array([
        0x2a, 0x02, 0x01, 0x04, 0x03, 0x02, 0x01, 0x00, 0x00, 0xc0, 0x3f, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x40,
      ]),
    )
    expect(r.readUint8()).toBe(0x2a)
    expect(r.readUint16()).toBe(0x0102)
    expect(r.readUint32()).toBe(0x01020304)
    expect(r.readFloat32()).toBe(1.5)
    expect(r.readFloat64()).toBe(2.5)
    expect(r.position).toBe(19)
    expect(r.remaining()).toEqual(new Uint8Array(0))
  })

  it('reads a uint8-length-prefixed UTF-8 string', () => {
    const r = new BinaryReader(new Uint8Array([4, 0x63, 0x6f, 0x61, 0x6c, 0xff]))
    expect(r.readString()).toBe('coal')
    expect(r.remaining()).toEqual(new Uint8Array([0xff]))
  })

  it('works on a subarray view with a non-zero byteOffset', () => {
    const backing = new Uint8Array([9, 9, 9, 0x01, 0x00])
    const r = new BinaryReader(backing.subarray(3))
    expect(r.readUint16()).toBe(1)
  })

  it('throws RangeError when reading past the end', () => {
    const r = new BinaryReader(new Uint8Array([1]))
    r.readUint8()
    expect(() => r.readUint8()).toThrow(RangeError)
    expect(() => new BinaryReader(new Uint8Array([2, 0x61])).readString()).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/codec/binaryReader`.

- [ ] **Step 3: Implement**

`src/codec/binaryReader.ts`:

```ts
const utf8 = new TextDecoder()

/** Sequential little-endian reader over a Uint8Array (handles subarray views). */
export class BinaryReader {
  private readonly bytes: Uint8Array
  private readonly view: DataView
  private offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get position(): number {
    return this.offset
  }

  get length(): number {
    return this.bytes.length
  }

  private advance(n: number): number {
    if (this.offset + n > this.bytes.length) {
      throw new RangeError(
        `read of ${n} bytes at offset ${this.offset} exceeds payload length ${this.bytes.length}`,
      )
    }
    const at = this.offset
    this.offset += n
    return at
  }

  readUint8(): number {
    return this.view.getUint8(this.advance(1))
  }

  readUint16(): number {
    return this.view.getUint16(this.advance(2), true)
  }

  readUint32(): number {
    return this.view.getUint32(this.advance(4), true)
  }

  readFloat32(): number {
    return this.view.getFloat32(this.advance(4), true)
  }

  readFloat64(): number {
    return this.view.getFloat64(this.advance(8), true)
  }

  readBytes(n: number): Uint8Array {
    const at = this.advance(n)
    return this.bytes.subarray(at, at + n)
  }

  readString(): string {
    const length = this.readUint8()
    return utf8.decode(this.readBytes(length))
  }

  remaining(): Uint8Array {
    return this.bytes.subarray(this.offset)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test`
Expected: PASS (4 tests).

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/codec/binaryReader.ts test/binaryReader.spec.ts
git commit -m "feat: add little-endian BinaryReader"
```

---

### Task 4: codec/deflate.ts + compressor-fidelity gate

**Files:**
- Create: `src/codec/deflate.ts`
- Test: `test/deflate.spec.ts`

**Interfaces:**
- Consumes: `base64ToBytes` (Task 2).
- Produces: `inflate(bytes: Uint8Array): Uint8Array`, `deflateLevel9(bytes: Uint8Array): Uint8Array` (zlib stream, `78 da` header).

The pako-vs-zlib@9 fidelity test is spec'd as "very early Phase 1"; it is pulled into Phase 0 because it only needs decode-side infrastructure and it de-risks the whole encode phase. If it fails, the payload-level guarantee still stands (spec Section 6).

- [ ] **Step 1: Write the failing tests**

`test/deflate.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { base64ToBytes } from '../src/codec/base64'
import { deflateLevel9, inflate } from '../src/codec/deflate'
import fixtures from './fixtures/builtin-presets.json'

const presets = fixtures.presets as Record<string, string>
const NAMES = Object.keys(presets)

function compressedBytesOf(exchangeString: string): Uint8Array {
  const compact = exchangeString.replaceAll(/\s+/g, '')
  return base64ToBytes(compact.slice(3, -3))
}

describe('deflate', () => {
  it('round-trips bytes through deflateLevel9 + inflate with a 78 da header', () => {
    const payload = new TextEncoder().encode('factorio '.repeat(50))
    const compressed = deflateLevel9(payload)
    expect(compressed[0]).toBe(0x78)
    expect(compressed[1]).toBe(0xda)
    expect(inflate(compressed)).toEqual(payload)
  })

  it.each(NAMES)('inflates the %s fixture to the recorded size', (name) => {
    const status = (fixtures._decodeStatus as Record<string, string>)[name] as string
    const expectedSize = Number(/\((\d+) bytes/.exec(status)?.[1])
    expect(inflate(compressedBytesOf(presets[name] as string)).length).toBe(expectedSize)
  })

  // COMPRESSOR-FIDELITY GATE (spec Sections 6 and 10): if this fails, pako@9
  // diverges from the game's zlib@9 stream. Byte-identical STRING export is
  // then off the table with pako; the payload-level round-trip remains the
  // primary guarantee. On failure: do NOT delete - change to it.fails(...) and
  // record the divergence in the Phase 1 plan.
  it.each(NAMES)('pako level 9 reproduces the compressed bytes of %s', (name) => {
    const compressed = compressedBytesOf(presets[name] as string)
    expect(deflateLevel9(inflate(compressed))).toEqual(compressed)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/codec/deflate`.

- [ ] **Step 3: Implement**

`src/codec/deflate.ts`:

```ts
import pako from 'pako'

export function inflate(bytes: Uint8Array): Uint8Array {
  return pako.inflate(bytes)
}

/**
 * zlib deflate pinned to level 9 (Z_BEST_COMPRESSION) to match the `78 da`
 * streams Factorio emits. Do not change the level: byte-identical string
 * export depends on it (spec Section 6).
 */
export function deflateLevel9(bytes: Uint8Array): Uint8Array {
  return pako.deflate(bytes, { level: 9 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS - 1 + 9 + 9 tests. The 9 fidelity tests are expected to pass (native zlib@9 already verified byte-identity per spec Section 10); if any fail, follow the comment in the test: switch that case to `it.fails`, keep going, and note it for Phase 1.

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/codec/deflate.ts test/deflate.spec.ts
git commit -m "feat: add pako zlib wrappers and compressor-fidelity gate"
```

---

### Task 5: codec/mapExchangeString.ts - decode

**Files:**
- Create: `src/codec/mapExchangeString.ts`
- Test: `test/decode.spec.ts`

**Interfaces:**
- Consumes: `base64ToBytes`, `bytesToBase64` (Task 2), `BinaryReader` (Task 3), `inflate`, `deflateLevel9` (Task 4), `crc32` (Task 2).
- Produces:

```ts
export interface AutoplaceSetting {
  frequency: number
  size: number
  richness: number
}

export type FormatVersion = [number, number, number, number]

export interface DecodedExchange {
  version: FormatVersion
  flagByte: number
  autoplaceControls: Record<string, AutoplaceSetting>
  /** The 55-byte undecoded MapGenSettings block between autoplace and property_expression_names (terrain / water / starting area; varies per preset; mapped in Phase 1). */
  midBlock: Uint8Array
  propertyExpressionNames: Record<string, string>
  /** Payload bytes after property_expression_names, excluding the trailing CRC. Undecoded until Phase 1. */
  tail: Uint8Array
  crc: number
  /** The full inflated payload (including CRC), for round-trip tests. */
  payload: Uint8Array
}

export class ExchangeStringError extends Error {}

export function decodeExchangeString(input: string): DecodedExchange
```

Payload layout being implemented (spec Section 4, as corrected 2026-07-01): `[u16 x4 version][u8 flag][u8 count + autoplace entries][55-byte mid block][u8 count + string-dict entries][tail...][u32 CRC LE over everything before it]`. Autoplace entry = `readString()` + 3x `float32` (frequency, size, richness). String-dict entry = `readString()` key + `readString()` value. The 55-byte mid block is undecoded MapGenSettings scalars, carried opaquely; its length is empirical for format 2.1.9.3, verified on all 9 fixtures (the property dict parses to plausible expression names on every fixture only at this offset).

- [ ] **Step 1: Write the failing tests**

`test/decode.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { bytesToBase64 } from '../src/codec/base64'
import { deflateLevel9 } from '../src/codec/deflate'
import {
  decodeExchangeString,
  ExchangeStringError,
} from '../src/codec/mapExchangeString'
import fixtures from './fixtures/builtin-presets.json'

const presets = fixtures.presets as Record<string, string>
const NAMES = Object.keys(presets)

describe('decodeExchangeString', () => {
  it.each(NAMES)('decodes %s as format 2.1.9.3 with a valid CRC', (name) => {
    const decoded = decodeExchangeString(presets[name] as string)
    expect(decoded.version).toEqual([2, 1, 9, 3])
    expect(decoded.flagByte).toBe(0)
  })

  it.each(NAMES)('payload size of %s matches the recorded _decodeStatus', (name) => {
    const status = (fixtures._decodeStatus as Record<string, string>)[name] as string
    const expectedSize = Number(/\((\d+) bytes/.exec(status)?.[1])
    expect(decodeExchangeString(presets[name] as string).payload.length).toBe(expectedSize)
  })

  it('ignores whitespace/newlines inside the base64 body', () => {
    const wrapped = presets['Default'] as string
    const compact = wrapped.replaceAll(/\s+/g, '')
    const rewrapped = `>>>\n${compact.slice(3, -3).replaceAll(/(.{57})/g, '$1\n')}\n<<<`
    expect(decodeExchangeString(rewrapped).payload).toEqual(
      decodeExchangeString(wrapped).payload,
    )
  })

  it('reads 28 autoplace controls from Default, in ordinal key order', () => {
    const controls = decodeExchangeString(presets['Default'] as string).autoplaceControls
    const keys = Object.keys(controls)
    expect(keys).toHaveLength(28)
    // Wire order is ordinal (code-point) sorted; JS default sort is code-unit
    // order, identical for these ASCII names ('-' 0x2d sorts before '_' 0x5f).
    expect(keys).toEqual([...keys].sort())
    expect(keys).toContain('coal')
    expect(keys).toContain('vulcanus_coal')
    expect(keys).toContain('aquilo_crude_oil')
    expect(controls['coal']).toEqual({ frequency: 1, size: 1, richness: 1 })
  })

  it('Rich Resources differs from Default exactly by richness 2.0 on the six nauvis resources', () => {
    const def = decodeExchangeString(presets['Default'] as string).autoplaceControls
    const rich = decodeExchangeString(presets['Rich Resources'] as string).autoplaceControls
    expect(Object.keys(rich)).toEqual(Object.keys(def))
    const changed: string[] = []
    for (const [name, value] of Object.entries(rich)) {
      const base = def[name] as (typeof rich)[string]
      if (
        value.frequency !== base.frequency ||
        value.size !== base.size ||
        value.richness !== base.richness
      ) {
        changed.push(name)
        expect(value.frequency).toBe(base.frequency)
        expect(value.size).toBe(base.size)
        expect(value.richness).toBe(2)
      }
    }
    expect(changed.sort()).toEqual([
      'coal',
      'copper-ore',
      'crude-oil',
      'iron-ore',
      'stone',
      'uranium-ore',
    ])
  })

  it.each(NAMES)('mid block of %s is exactly 55 bytes', (name) => {
    expect(decodeExchangeString(presets[name] as string).midBlock.length).toBe(55)
  })

  it('property_expression_names is empty in Default and pinned in Lakes, Island, Ribbon world', () => {
    expect(
      decodeExchangeString(presets['Default'] as string).propertyExpressionNames,
    ).toEqual({})
    const lakesKeys = [
      'aux',
      'cliff_elevation',
      'cliffiness',
      'elevation',
      'moisture',
      'trees_forest_path_cutout',
    ]
    expect(
      Object.keys(decodeExchangeString(presets['Lakes'] as string).propertyExpressionNames),
    ).toEqual(lakesKeys)
    expect(
      Object.keys(decodeExchangeString(presets['Island'] as string).propertyExpressionNames),
    ).toEqual(lakesKeys)
    expect(
      Object.keys(
        decodeExchangeString(presets['Ribbon world'] as string).propertyExpressionNames,
      ),
    ).toEqual(['elevation', 'trees_forest_path_cutout'])
  })

  it.each(NAMES)('tail of %s is non-empty (terrain/cliff/map settings live there)', (name) => {
    expect(decodeExchangeString(presets[name] as string).tail.length).toBeGreaterThan(0)
  })

  it('rejects a missing envelope', () => {
    expect(() => decodeExchangeString('eNqLjgUAARUAuQ==')).toThrow(ExchangeStringError)
    expect(() => decodeExchangeString('>>>eNqLjgUAARUAuQ==')).toThrow(ExchangeStringError)
  })

  it('rejects invalid base64 and invalid zlib streams', () => {
    expect(() => decodeExchangeString('>>>!!!!<<<')).toThrow(ExchangeStringError)
    expect(() => decodeExchangeString('>>>AAAAAAAA<<<')).toThrow(ExchangeStringError)
  })

  it('rejects a payload whose CRC does not match', () => {
    const good = decodeExchangeString(presets['Default'] as string)
    const corrupted = good.payload.slice()
    corrupted[20] = (corrupted[20] as number) ^ 0xff
    const tampered = `>>>${bytesToBase64(deflateLevel9(corrupted))}<<<`
    expect(() => decodeExchangeString(tampered)).toThrow(/CRC/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/codec/mapExchangeString`.

- [ ] **Step 3: Implement**

`src/codec/mapExchangeString.ts`:

```ts
import { base64ToBytes } from './base64'
import { BinaryReader } from './binaryReader'
import { crc32 } from './crc32'
import { inflate } from './deflate'

export interface AutoplaceSetting {
  frequency: number
  size: number
  richness: number
}

export type FormatVersion = [number, number, number, number]

export interface DecodedExchange {
  version: FormatVersion
  flagByte: number
  autoplaceControls: Record<string, AutoplaceSetting>
  /** The 55-byte undecoded MapGenSettings block between autoplace and property_expression_names (terrain / water / starting area; varies per preset; mapped in Phase 1). */
  midBlock: Uint8Array
  propertyExpressionNames: Record<string, string>
  /** Payload bytes after property_expression_names, excluding the trailing CRC. Undecoded until Phase 1. */
  tail: Uint8Array
  crc: number
  /** The full inflated payload (including CRC), for round-trip tests. */
  payload: Uint8Array
}

export class ExchangeStringError extends Error {}

// version (8) + flag (1) + count (1) + mid block (55) + count (1) + CRC (4)
const MIN_PAYLOAD_LENGTH = 70

// Undecoded MapGenSettings block between autoplace and property_expression_names.
// Empirical for format 2.1.9.3, verified on all 9 fixtures (Phase 1 maps its fields).
const MID_BLOCK_LENGTH = 55

export function decodeExchangeString(input: string): DecodedExchange {
  const compact = input.replaceAll(/\s+/g, '')
  if (!compact.startsWith('>>>') || !compact.endsWith('<<<') || compact.length < 7) {
    throw new ExchangeStringError('not a map exchange string (missing >>> <<< envelope)')
  }

  let compressed: Uint8Array
  try {
    compressed = base64ToBytes(compact.slice(3, -3))
  } catch {
    throw new ExchangeStringError('envelope body is not valid base64')
  }

  let payload: Uint8Array
  try {
    payload = inflate(compressed)
  } catch {
    throw new ExchangeStringError('body is not a valid zlib stream')
  }
  if (payload.length < MIN_PAYLOAD_LENGTH) {
    throw new ExchangeStringError(`payload too short (${payload.length} bytes)`)
  }

  const crcOffset = payload.length - 4
  const storedCrc = new DataView(
    payload.buffer,
    payload.byteOffset + crcOffset,
    4,
  ).getUint32(0, true)
  const computedCrc = crc32(payload.subarray(0, crcOffset))
  if (storedCrc !== computedCrc) {
    throw new ExchangeStringError(
      `CRC mismatch: stored ${storedCrc.toString(16)}, computed ${computedCrc.toString(16)}`,
    )
  }

  try {
    const reader = new BinaryReader(payload.subarray(0, crcOffset))
    const version: FormatVersion = [
      reader.readUint16(),
      reader.readUint16(),
      reader.readUint16(),
      reader.readUint16(),
    ]
    const flagByte = reader.readUint8()

    const autoplaceControls: Record<string, AutoplaceSetting> = {}
    const autoplaceCount = reader.readUint8()
    for (let i = 0; i < autoplaceCount; i++) {
      const name = reader.readString()
      autoplaceControls[name] = {
        frequency: reader.readFloat32(),
        size: reader.readFloat32(),
        richness: reader.readFloat32(),
      }
    }

    const midBlock = reader.readBytes(MID_BLOCK_LENGTH)

    const propertyExpressionNames: Record<string, string> = {}
    const propertyCount = reader.readUint8()
    for (let i = 0; i < propertyCount; i++) {
      const key = reader.readString()
      propertyExpressionNames[key] = reader.readString()
    }

    return {
      version,
      flagByte,
      autoplaceControls,
      midBlock,
      propertyExpressionNames,
      tail: reader.remaining(),
      crc: storedCrc,
      payload,
    }
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ExchangeStringError(`payload truncated: ${error.message}`)
    }
    throw error
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS - every decode test green against all 9 fixtures. The layout (including the 55-byte mid block) was re-verified against all 9 fixtures on 2026-07-01, so a failure means an implementation bug: suspect your transcription first, and if a layout-level test still fails after a faithful transcription, stop and report rather than adjusting the layout.

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/codec/mapExchangeString.ts test/decode.spec.ts
git commit -m "feat: decode map exchange strings (envelope, CRC, autoplace, property dict)"
```

---

### Task 6: Model - types, planets, control catalog

**Files:**
- Create: `src/model/types.ts`, `src/model/planets.ts`, `src/model/controlCatalog.ts`
- Test: `test/catalog.spec.ts`

**Interfaces:**
- Consumes: `AutoplaceSetting`, `FormatVersion` (Task 5, re-exported through types), `decodeExchangeString` (tests only).
- Produces:

```ts
// types.ts
export type { AutoplaceSetting, FormatVersion } from '../codec/mapExchangeString'
export interface Preset { ... }               // full shape in Step 3

// planets.ts
export const PLANETS: readonly ['nauvis', 'vulcanus', 'gleba', 'fulgora', 'aquilo']
export type Planet = (typeof PLANETS)[number]
export const PLANET_LABELS: Record<Planet, string>

// controlCatalog.ts
export type ControlCategory = 'resource' | 'terrain' | 'enemy'
export interface ControlEntry {
  planet: Planet
  category: ControlCategory
  label: string
  hasRichness: boolean
}
export const CONTROL_CATALOG: Record<string, ControlEntry>  // exactly 28 keys
export function controlsFor(planet: Planet, category: ControlCategory): string[]
```

- [ ] **Step 1: Write the failing test**

`test/catalog.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { decodeExchangeString } from '../src/codec/mapExchangeString'
import { CONTROL_CATALOG, controlsFor } from '../src/model/controlCatalog'
import { PLANETS } from '../src/model/planets'
import fixtures from './fixtures/builtin-presets.json'

const presets = fixtures.presets as Record<string, string>

describe('control catalog', () => {
  it('covers exactly the 28 controls present in the Default fixture', () => {
    const fixtureKeys = Object.keys(
      decodeExchangeString(presets['Default'] as string).autoplaceControls,
    ).sort()
    expect(Object.keys(CONTROL_CATALOG).sort()).toEqual(fixtureKeys)
  })

  it('assigns every control to a known planet', () => {
    for (const entry of Object.values(CONTROL_CATALOG)) {
      expect(PLANETS).toContain(entry.planet)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('groups nauvis resources correctly', () => {
    expect(controlsFor('nauvis', 'resource').sort()).toEqual([
      'coal',
      'copper-ore',
      'crude-oil',
      'iron-ore',
      'stone',
      'uranium-ore',
    ])
  })

  it('every planet has at least one resource control', () => {
    for (const planet of PLANETS) {
      expect(controlsFor(planet, 'resource').length).toBeGreaterThan(0)
    }
  })

  it('resources have richness; terrain and enemy controls do not', () => {
    for (const [name, entry] of Object.entries(CONTROL_CATALOG)) {
      expect(entry.hasRichness, name).toBe(entry.category === 'resource')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/model/controlCatalog`.

- [ ] **Step 3: Implement**

`src/model/planets.ts`:

```ts
export const PLANETS = ['nauvis', 'vulcanus', 'gleba', 'fulgora', 'aquilo'] as const

export type Planet = (typeof PLANETS)[number]

export const PLANET_LABELS: Record<Planet, string> = {
  nauvis: 'Nauvis',
  vulcanus: 'Vulcanus',
  gleba: 'Gleba',
  fulgora: 'Fulgora',
  aquilo: 'Aquilo',
}
```

`src/model/types.ts`:

```ts
import type { AutoplaceSetting, FormatVersion } from '../codec/mapExchangeString'

export type { AutoplaceSetting, FormatVersion }

export interface Preset {
  name: string
  builtin: boolean
  /** null = "Random each new map". Not codec-wired until Phase 1 maps the seed offset. */
  seed: number | null
  randomEachMap: boolean
  autoplaceControls: Record<string, AutoplaceSetting>
  /**
   * Base64 of the undecoded 55-byte MapGenSettings block that sits between
   * autoplace and property_expression_names on the wire (terrain / water /
   * starting-area scalars; varies per preset). Mapped to typed fields in
   * Phase 1.
   */
  opaqueMidB64: string
  propertyExpressionNames: Record<string, string>
  /**
   * Base64 of the undecoded payload bytes after property_expression_names
   * (cliffs, MapSettings, difficulty).
   * Carried opaquely so the Phase 1 encoder can round-trip before those
   * fields are individually mapped. Replaced by typed fields in Phase 1.
   */
  opaqueTailB64: string
  formatVersion: FormatVersion
}
```

`src/model/controlCatalog.ts` (planet/category assignments from spec Section 4's catalog table):

```ts
import type { Planet } from './planets'

export type ControlCategory = 'resource' | 'terrain' | 'enemy'

export interface ControlEntry {
  planet: Planet
  category: ControlCategory
  label: string
  hasRichness: boolean
}

function resource(planet: Planet, label: string): ControlEntry {
  return { planet, category: 'resource', label, hasRichness: true }
}

function terrain(planet: Planet, label: string): ControlEntry {
  return { planet, category: 'terrain', label, hasRichness: false }
}

function enemy(planet: Planet, label: string): ControlEntry {
  return { planet, category: 'enemy', label, hasRichness: false }
}

/** All 28 autoplace controls of Factorio 2.1.9 Space Age, keyed by wire name. */
export const CONTROL_CATALOG: Record<string, ControlEntry> = {
  // Nauvis (unprefixed names)
  'coal': resource('nauvis', 'Coal'),
  'copper-ore': resource('nauvis', 'Copper ore'),
  'crude-oil': resource('nauvis', 'Crude oil'),
  'iron-ore': resource('nauvis', 'Iron ore'),
  'stone': resource('nauvis', 'Stone'),
  'uranium-ore': resource('nauvis', 'Uranium ore'),
  'enemy-base': enemy('nauvis', 'Enemy bases'),
  'trees': terrain('nauvis', 'Trees'),
  'water': terrain('nauvis', 'Water'),
  'rocks': terrain('nauvis', 'Rocks'),
  'nauvis_cliff': terrain('nauvis', 'Cliffs'),
  'starting_area_moisture': terrain('nauvis', 'Starting area moisture'),
  // Vulcanus
  'vulcanus_coal': resource('vulcanus', 'Coal'),
  'calcite': resource('vulcanus', 'Calcite'),
  'sulfuric_acid_geyser': resource('vulcanus', 'Sulfuric acid geyser'),
  'tungsten_ore': resource('vulcanus', 'Tungsten ore'),
  'vulcanus_volcanism': terrain('vulcanus', 'Volcanism'),
  // Gleba
  'gleba_stone': resource('gleba', 'Stone'),
  'gleba_water': terrain('gleba', 'Water'),
  'gleba_plants': terrain('gleba', 'Plants'),
  'gleba_cliff': terrain('gleba', 'Cliffs'),
  'gleba_enemy_base': enemy('gleba', 'Enemy bases'),
  // Fulgora
  'scrap': resource('fulgora', 'Scrap'),
  'lithium_brine': resource('fulgora', 'Lithium brine'),
  'fulgora_cliff': terrain('fulgora', 'Cliffs'),
  'fulgora_islands': terrain('fulgora', 'Islands'),
  // Aquilo
  'aquilo_crude_oil': resource('aquilo', 'Crude oil'),
  'fluorine_vent': resource('aquilo', 'Fluorine vent'),
}

export function controlsFor(planet: Planet, category: ControlCategory): string[] {
  return Object.entries(CONTROL_CATALOG)
    .filter(([, entry]) => entry.planet === planet && entry.category === category)
    .map(([name]) => name)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test`
Expected: PASS. The first test is the load-bearing one: catalog keys must equal the fixture's 28 decoded keys exactly. If it fails, trust the fixture and fix the catalog spelling - never the other way around.

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/model test/catalog.spec.ts
git commit -m "feat: add settings model types, planets, and autoplace control catalog"
```

---

### Task 7: Built-in presets derived from fixtures (defaults source)

**Files:**
- Create: `src/model/convert.ts`, `src/model/builtins.ts`
- Test: `test/builtins.spec.ts`

**Interfaces:**
- Consumes: `decodeExchangeString`, `DecodedExchange` (Task 5), `bytesToBase64` (Task 2), `Preset` (Task 6).
- Produces:
  - `presetFromDecoded(name: string, decoded: DecodedExchange, builtin?: boolean): Preset`
  - `getBuiltinPresets(): Preset[]` (all 9, decode memoized, callers must not mutate)
  - `getBuiltinPreset(name: string): Preset` (deep clone, safe to mutate; throws on unknown name)
  - `BUILTIN_NAMES: string[]`

Design note: `defaults.ts` from the spec is realized as `getBuiltinPreset('Default')` - the Default preset IS the decoded Default fixture, byte-derived at runtime instead of hand-transcribed. This sidesteps transcription drift and keeps the cliff-anomaly bytes (spec Section 4) intact inside `opaqueTailB64` until Phase 1 resolves them. `src` imports the fixture JSON from `test/fixtures/` deliberately: one source of truth, and Vite bundles JSON imports fine (~8 KB).

- [ ] **Step 1: Write the failing test**

`test/builtins.spec.ts`:

```ts
import { describe, expect, it } from 'vite-plus/test'
import { BUILTIN_NAMES, getBuiltinPreset, getBuiltinPresets } from '../src/model/builtins'
import fixtures from './fixtures/builtin-presets.json'

describe('builtin presets', () => {
  it('exposes all 9 fixtures as presets, in fixture order', () => {
    expect(BUILTIN_NAMES).toEqual(Object.keys(fixtures.presets))
    expect(getBuiltinPresets().map((p) => p.name)).toEqual(BUILTIN_NAMES)
    for (const preset of getBuiltinPresets()) {
      expect(preset.builtin).toBe(true)
      expect(preset.formatVersion).toEqual([2, 1, 9, 3])
      expect(Object.keys(preset.autoplaceControls)).toHaveLength(28)
      expect(preset.opaqueMidB64.length).toBeGreaterThan(0)
      expect(preset.opaqueTailB64.length).toBeGreaterThan(0)
    }
  })

  it('Default preset has all controls at 1.0 frequency/size/richness', () => {
    const preset = getBuiltinPreset('Default')
    for (const value of Object.values(preset.autoplaceControls)) {
      expect(value.frequency).toBe(1)
      expect(value.size).toBe(1)
    }
  })

  it('Rich Resources preset carries richness 2 on nauvis coal', () => {
    expect(getBuiltinPreset('Rich Resources').autoplaceControls['coal']?.richness).toBe(2)
  })

  it('getBuiltinPreset returns an independent deep clone', () => {
    const a = getBuiltinPreset('Default')
    const coal = a.autoplaceControls['coal']
    if (coal) coal.frequency = 99
    expect(getBuiltinPreset('Default').autoplaceControls['coal']?.frequency).toBe(1)
  })

  it('throws on an unknown builtin name', () => {
    expect(() => getBuiltinPreset('Nope')).toThrow(/unknown builtin/i)
  })
})
```

Note on the "all controls at 1.0" test: richness is intentionally not asserted globally - only frequency/size - because some non-resource controls may not carry meaningful richness. If frequency/size are not all 1.0 in the decoded Default fixture, weaken the assertion to match the actual decoded values (the fixture is ground truth) and note what differed in the commit message.

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/model/builtins`.

- [ ] **Step 3: Implement**

`src/model/convert.ts`:

```ts
import { bytesToBase64 } from '../codec/base64'
import type { DecodedExchange } from '../codec/mapExchangeString'
import type { Preset } from './types'

export function presetFromDecoded(
  name: string,
  decoded: DecodedExchange,
  builtin = false,
): Preset {
  return {
    name,
    builtin,
    seed: null,
    randomEachMap: true,
    autoplaceControls: structuredClone(decoded.autoplaceControls),
    opaqueMidB64: bytesToBase64(decoded.midBlock),
    propertyExpressionNames: structuredClone(decoded.propertyExpressionNames),
    opaqueTailB64: bytesToBase64(decoded.tail),
    formatVersion: [...decoded.version],
  }
}
```

`src/model/builtins.ts`:

```ts
import { decodeExchangeString } from '../codec/mapExchangeString'
import fixtures from '../../test/fixtures/builtin-presets.json'
import { presetFromDecoded } from './convert'
import type { Preset } from './types'

const exchangeStrings = fixtures.presets as Record<string, string>

export const BUILTIN_NAMES: string[] = Object.keys(exchangeStrings)

let cache: Preset[] | undefined

/** All 9 built-in presets, decoded once from the committed fixtures. Do not mutate. */
export function getBuiltinPresets(): Preset[] {
  cache ??= Object.entries(exchangeStrings).map(([name, s]) =>
    presetFromDecoded(name, decodeExchangeString(s), true),
  )
  return cache
}

/** A deep clone of one built-in preset, safe to mutate (the app's `defaults` source). */
export function getBuiltinPreset(name: string): Preset {
  const preset = getBuiltinPresets().find((p) => p.name === name)
  if (!preset) {
    throw new Error(`unknown builtin preset: ${name}`)
  }
  return structuredClone(preset)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test`
Expected: PASS. If TypeScript rejects the JSON import, add `"resolveJsonModule": true` to the app tsconfig (see Task 1 Step 4).

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/model test/builtins.spec.ts
git commit -m "feat: derive the 9 built-in presets (incl. Default) from fixtures"
```

---

### Task 8: Pinia preset store with localStorage persistence

**Files:**
- Create: `src/store/presets.ts`
- Test: `test/store.spec.ts`

**Interfaces:**
- Consumes: `getBuiltinPreset`, `BUILTIN_NAMES` (Task 7), `presetFromDecoded` (Task 7), `decodeExchangeString`, `ExchangeStringError` (Task 5), `Preset` (Task 6).
- Produces: `usePresetsStore` with state `{ userPresets: Preset[]; activeName: string | null }`, getter `activePreset: Preset | undefined`, actions `selectPreset(name: string): void`, `createFromBuiltin(builtinName: string, newName: string): void`, `importExchangeString(name: string, exchangeString: string): void` (throws `ExchangeStringError` on bad input), `duplicateActive(): void`, `deleteActive(): void`, `saveToStorage(): void`. Also `STORAGE_KEY = 'factorio-map-webui.presets.v1'`.

Persistence contract: edits to the active preset are in-memory; `saveToStorage()` (the Save button) persists, and structural actions (create/import/duplicate/delete) persist immediately. First launch with empty storage seeds one user preset cloned from Default named `My preset`.

- [ ] **Step 1: Write the failing test**

`test/store.spec.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { ExchangeStringError } from '../src/codec/mapExchangeString'
import { STORAGE_KEY, usePresetsStore } from '../src/store/presets'
import fixtures from './fixtures/builtin-presets.json'

const presets = fixtures.presets as Record<string, string>

describe('presets store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('seeds a "My preset" clone of Default on first launch', () => {
    const store = usePresetsStore()
    expect(store.userPresets.map((p) => p.name)).toEqual(['My preset'])
    expect(store.activePreset?.autoplaceControls['coal']?.frequency).toBe(1)
    expect(store.activePreset?.builtin).toBe(false)
  })

  it('creates a preset from a builtin and makes it active', () => {
    const store = usePresetsStore()
    store.createFromBuiltin('Rich Resources', 'richer')
    expect(store.activeName).toBe('richer')
    expect(store.activePreset?.autoplaceControls['coal']?.richness).toBe(2)
  })

  it('deduplicates preset names', () => {
    const store = usePresetsStore()
    store.createFromBuiltin('Default', 'My preset')
    expect(store.activeName).toBe('My preset (2)')
  })

  it('persists on save and restores across a fresh pinia', () => {
    const store = usePresetsStore()
    const coal = store.activePreset?.autoplaceControls['coal']
    if (coal) coal.frequency = 3
    store.saveToStorage()

    setActivePinia(createPinia())
    const reloaded = usePresetsStore()
    expect(reloaded.activePreset?.autoplaceControls['coal']?.frequency).toBe(3)
  })

  it('imports a valid exchange string as a new preset', () => {
    const store = usePresetsStore()
    store.importExchangeString('imported', presets['Marathon'] as string)
    expect(store.activeName).toBe('imported')
    expect(store.activePreset?.formatVersion).toEqual([2, 1, 9, 3])
  })

  it('propagates ExchangeStringError on invalid import and leaves state unchanged', () => {
    const store = usePresetsStore()
    expect(() => store.importExchangeString('bad', 'garbage')).toThrow(ExchangeStringError)
    expect(store.userPresets).toHaveLength(1)
  })

  it('duplicate and delete work and persist', () => {
    const store = usePresetsStore()
    store.duplicateActive()
    expect(store.activeName).toBe('My preset (copy)')
    store.deleteActive()
    expect(store.activeName).toBe('My preset')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).userPresets).toHaveLength(1)
  })

  it('survives corrupted localStorage by reseeding', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const store = usePresetsStore()
    expect(store.userPresets).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test`
Expected: FAIL - cannot resolve `../src/store/presets`.

- [ ] **Step 3: Implement**

`src/store/presets.ts`:

```ts
import { defineStore } from 'pinia'
import { decodeExchangeString } from '../codec/mapExchangeString'
import { getBuiltinPreset } from '../model/builtins'
import { presetFromDecoded } from '../model/convert'
import type { Preset } from '../model/types'

export const STORAGE_KEY = 'factorio-map-webui.presets.v1'

interface PersistedState {
  version: 1
  userPresets: Preset[]
  activeName: string | null
}

function loadPersisted(): PersistedState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedState
    if (parsed.version !== 1 || !Array.isArray(parsed.userPresets)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function seedState(): { userPresets: Preset[]; activeName: string | null } {
  const first = getBuiltinPreset('Default')
  first.name = 'My preset'
  first.builtin = false
  return { userPresets: [first], activeName: first.name }
}

export const usePresetsStore = defineStore('presets', {
  state: () => {
    const persisted = loadPersisted()
    if (persisted) {
      return { userPresets: persisted.userPresets, activeName: persisted.activeName }
    }
    return seedState()
  },

  getters: {
    activePreset(state): Preset | undefined {
      return state.userPresets.find((p) => p.name === state.activeName)
    },
  },

  actions: {
    uniqueName(base: string): string {
      const trimmed = base.trim() || 'Preset'
      if (!this.userPresets.some((p) => p.name === trimmed)) return trimmed
      let i = 2
      while (this.userPresets.some((p) => p.name === `${trimmed} (${i})`)) i++
      return `${trimmed} (${i})`
    },

    selectPreset(name: string) {
      if (this.userPresets.some((p) => p.name === name)) {
        this.activeName = name
      }
    },

    createFromBuiltin(builtinName: string, newName: string) {
      const preset = getBuiltinPreset(builtinName)
      preset.name = this.uniqueName(newName)
      preset.builtin = false
      this.userPresets.push(preset)
      this.activeName = preset.name
      this.saveToStorage()
    },

    importExchangeString(name: string, exchangeString: string) {
      const decoded = decodeExchangeString(exchangeString)
      const preset = presetFromDecoded(this.uniqueName(name), decoded)
      this.userPresets.push(preset)
      this.activeName = preset.name
      this.saveToStorage()
    },

    duplicateActive() {
      const active = this.activePreset
      if (!active) return
      const copy = structuredClone(toRawPreset(active))
      copy.name = this.uniqueName(`${active.name} (copy)`)
      this.userPresets.push(copy)
      this.activeName = copy.name
      this.saveToStorage()
    },

    deleteActive() {
      const index = this.userPresets.findIndex((p) => p.name === this.activeName)
      if (index === -1) return
      this.userPresets.splice(index, 1)
      this.activeName = this.userPresets[0]?.name ?? null
      this.saveToStorage()
    },

    saveToStorage() {
      const persisted: PersistedState = {
        version: 1,
        userPresets: this.userPresets,
        activeName: this.activeName,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    },
  },
})

/** structuredClone cannot clone Vue reactive proxies; strip via JSON. Presets are JSON-safe by design. */
function toRawPreset(preset: Preset): Preset {
  return JSON.parse(JSON.stringify(preset)) as Preset
}
```

Note the `toRawPreset` helper: store state is reactive, and `structuredClone` throws on proxies. The Preset type is JSON-safe by construction (`opaqueTailB64` is a string), so the JSON round-trip is lossless. Given that, you can simplify `duplicateActive` to use `toRawPreset` directly - which the code above does.

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test`
Expected: PASS (8 tests). If `localStorage` is undefined, the happy-dom test environment is not active - fix `vite.config.ts` (Task 1 Step 4) rather than stubbing globals.

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/store test/store.spec.ts
git commit -m "feat: add pinia preset store with localStorage persistence"
```

---

### Task 9: Factorio UI kit

**Files:**
- Create: `src/ui/factorio.css`, `src/ui/FPanel.vue`, `src/ui/FButton.vue`, `src/ui/FSlider.vue`, `src/ui/FNumberInput.vue`, `src/ui/FCheckbox.vue`, `src/ui/FDropdown.vue`, `src/ui/FTabs.vue`
- Test: `test/ui-kit.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure presentational kit).
- Produces (props/emit contracts used by Tasks 10-11):
  - `FPanel`: props `{ title?: string }`, default slot.
  - `FButton`: props `{ variant?: 'default' | 'confirm' | 'danger' | 'tool'; disabled?: boolean }`, emits `click`, default slot.
  - `FSlider`: props `{ modelValue: number; min?: number; max?: number; step?: number }` (defaults 0 / 6 / 0.05), emits `update:modelValue` with a number.
  - `FNumberInput`: props `{ modelValue: number }`, emits `update:modelValue` with a finite number (ignores NaN).
  - `FCheckbox`: props `{ modelValue: boolean; label?: string }`, emits `update:modelValue`.
  - `FDropdown`: props `{ modelValue: string; options: { value: string; label: string }[] }`, emits `update:modelValue`.
  - `FTabs`: props `{ modelValue: string; tabs: string[] }`, emits `update:modelValue`.

Style target is `webmapgenerator.png`: near-black page, dark gray beveled panels, orange accent for active tab / primary button / slider thumb, warm off-white text, green Save, red Delete, gray inset value boxes.

- [ ] **Step 1: Write the failing tests**

`test/ui-kit.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vite-plus/test'
import FButton from '../src/ui/FButton.vue'
import FCheckbox from '../src/ui/FCheckbox.vue'
import FDropdown from '../src/ui/FDropdown.vue'
import FNumberInput from '../src/ui/FNumberInput.vue'
import FSlider from '../src/ui/FSlider.vue'
import FTabs from '../src/ui/FTabs.vue'

describe('Factorio UI kit', () => {
  it('FSlider emits numeric update:modelValue', async () => {
    const w = mount(FSlider, { props: { modelValue: 1 } })
    await w.find('input').setValue('2.5')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([2.5])
  })

  it('FNumberInput emits numbers and ignores non-numeric input', async () => {
    const w = mount(FNumberInput, { props: { modelValue: 1 } })
    await w.find('input').setValue('4')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([4])
    await w.find('input').setValue('')
    expect(w.emitted('update:modelValue')).toHaveLength(1)
  })

  it('FCheckbox toggles', async () => {
    const w = mount(FCheckbox, { props: { modelValue: false, label: 'Auto-refresh' } })
    expect(w.text()).toContain('Auto-refresh')
    await w.find('input').setValue(true)
    expect(w.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('FDropdown renders options and emits selection', async () => {
    const w = mount(FDropdown, {
      props: {
        modelValue: 'nauvis',
        options: [
          { value: 'nauvis', label: 'Nauvis' },
          { value: 'gleba', label: 'Gleba' },
        ],
      },
    })
    await w.find('select').setValue('gleba')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['gleba'])
  })

  it('FTabs marks the active tab and emits on click', async () => {
    const w = mount(FTabs, {
      props: { modelValue: 'Resources', tabs: ['Resources', 'Terrain'] },
    })
    const buttons = w.findAll('button')
    expect(buttons[0]?.classes()).toContain('active')
    await buttons[1]?.trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['Terrain'])
  })

  it('FButton emits click, honors disabled', async () => {
    const w = mount(FButton, { props: { variant: 'danger' }, slots: { default: 'Delete' } })
    await w.find('button').trigger('click')
    expect(w.emitted('click')).toHaveLength(1)
    const d = mount(FButton, { props: { disabled: true } })
    await d.find('button').trigger('click')
    expect(d.emitted('click')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test`
Expected: FAIL - cannot resolve the `../src/ui/*.vue` imports.

- [ ] **Step 3: Implement the kit**

`src/ui/factorio.css` (imported once from `main.ts` in Task 10; for now just create it):

```css
:root {
  --f-bg: #1c1b1c;
  --f-panel: #313031;
  --f-panel-raised: #414041;
  --f-inset: #242324;
  --f-edge-light: #5f5e5f;
  --f-edge-dark: #141314;
  --f-text: #ffe6c0;
  --f-text-dim: #b0aca7;
  --f-orange: #e39827;
  --f-orange-bright: #f9b44b;
  --f-green: #47a447;
  --f-red: #d6413b;
  --f-value-box: #8e8e8e;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--f-bg);
  color: var(--f-text);
  font-family: 'Titillium Web', system-ui, -apple-system, sans-serif;
  font-size: 14px;
}

.f-bevel-out {
  box-shadow:
    inset 1px 1px 0 var(--f-edge-light),
    inset -1px -1px 0 var(--f-edge-dark);
}

.f-bevel-in {
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}
```

`src/ui/FPanel.vue`:

```vue
<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="f-panel f-bevel-out">
    <h2 v-if="title" class="f-panel-title">{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.f-panel {
  background: var(--f-panel);
  padding: 8px;
}

.f-panel-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
}
</style>
```

`src/ui/FButton.vue`:

```vue
<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'confirm' | 'danger' | 'tool'
  disabled?: boolean
}>()
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="f-button"
    :class="variant ?? 'default'"
    :disabled="disabled"
    type="button"
    @click="emit('click')"
  >
    <slot />
  </button>
</template>

<style scoped>
.f-button {
  padding: 4px 16px;
  border: none;
  font: inherit;
  font-weight: 700;
  color: #1a1a1a;
  background: var(--f-value-box);
  cursor: pointer;
  box-shadow:
    inset 1px 1px 0 rgb(255 255 255 / 35%),
    inset -1px -1px 0 rgb(0 0 0 / 45%);
}

.f-button.tool {
  background: var(--f-orange);
}

.f-button.confirm {
  background: var(--f-green);
  color: #fff;
}

.f-button.danger {
  background: var(--f-red);
  color: #fff;
}

.f-button:not(:disabled):hover {
  filter: brightness(1.15);
}

.f-button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
```

`src/ui/FSlider.vue`:

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>(),
  { min: 0, max: 6, step: 0.05 },
)
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function onInput(event: Event) {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <input
    class="f-slider"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    @input="onInput"
  />
</template>

<style scoped>
.f-slider {
  appearance: none;
  width: 100%;
  height: 6px;
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.f-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}
</style>
```

`src/ui/FNumberInput.vue`:

```vue
<script setup lang="ts">
defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function onChange(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const value = Number(raw)
  if (raw !== '' && Number.isFinite(value)) {
    emit('update:modelValue', value)
  }
}
</script>

<template>
  <input class="f-number" type="number" :value="modelValue" @change="onChange" />
</template>

<style scoped>
.f-number {
  width: 56px;
  padding: 3px 6px;
  border: none;
  font: inherit;
  font-weight: 700;
  text-align: center;
  color: #1a1a1a;
  background: var(--f-value-box);
  box-shadow:
    inset 1px 1px 0 rgb(0 0 0 / 40%),
    inset -1px -1px 0 rgb(255 255 255 / 30%);
}
</style>
```

`src/ui/FCheckbox.vue`:

```vue
<script setup lang="ts">
defineProps<{ modelValue: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="f-checkbox">
    <input type="checkbox" :checked="modelValue" @change="onChange" />
    <span v-if="label" class="f-checkbox-label">{{ label }}</span>
  </label>
</template>

<style scoped>
.f-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.f-checkbox input {
  width: 16px;
  height: 16px;
  accent-color: var(--f-orange);
}

.f-checkbox-label {
  font-weight: 700;
}
</style>
```

`src/ui/FDropdown.vue`:

```vue
<script setup lang="ts">
defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <select class="f-dropdown" :value="modelValue" @change="onChange">
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<style scoped>
.f-dropdown {
  padding: 4px 8px;
  border: none;
  font: inherit;
  font-weight: 700;
  color: var(--f-text);
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}
</style>
```

`src/ui/FTabs.vue`:

```vue
<script setup lang="ts">
defineProps<{ modelValue: string; tabs: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="f-tabs">
    <button
      v-for="tab in tabs"
      :key="tab"
      class="f-tab"
      :class="{ active: tab === modelValue }"
      type="button"
      @click="emit('update:modelValue', tab)"
    >
      {{ tab }}
    </button>
  </div>
</template>

<style scoped>
.f-tabs {
  display: flex;
  gap: 4px;
}

.f-tab {
  padding: 6px 20px;
  border: none;
  font: inherit;
  font-weight: 700;
  color: var(--f-text);
  background: var(--f-panel-raised);
  cursor: pointer;
  box-shadow:
    inset 1px 1px 0 var(--f-edge-light),
    inset -1px -1px 0 var(--f-edge-dark);
}

.f-tab.active {
  background: var(--f-orange);
  color: #1a1a1a;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS (6 tests).

- [ ] **Step 5: Check and commit**

```fish
vp check --fix
git add src/ui test/ui-kit.spec.ts
git commit -m "feat: add Factorio-styled UI component kit"
```

---

### Task 10: App shell + PresetBar

**Files:**
- Create: `src/components/PresetBar.vue`
- Modify: `src/App.vue` (full rewrite), `src/main.ts` (full rewrite), `index.html` (title)
- Test: `test/app.spec.ts` (created here, extended in Task 11)

**Interfaces:**
- Consumes: UI kit (Task 9), `usePresetsStore` (Task 8), `BUILTIN_NAMES` (Task 7), `PLANETS`, `PLANET_LABELS`, `Planet` (Task 6).
- Produces: `App.vue` owns `selectedPlanet = ref<Planet>('nauvis')` and `activeTab = ref('Resources')` and passes them down; Task 11's components receive `selectedPlanet` as a prop (`planet: Planet`). `App.vue` renders `<PresetBar />`, the `FTabs` row (`['Resources', 'Terrain', 'Enemy', 'Advanced']`), a `<main>` content area with a placeholder `div.tab-content` (replaced in Task 11), a right-hand `aside` placeholder (replaced by PreviewPanel in Task 11), and a bottom placeholder (replaced by ActionBar in Task 11).

- [ ] **Step 1: Write the failing test**

`test/app.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import App from '../src/App.vue'

function mountApp() {
  return mount(App, { global: { plugins: [createPinia()] } })
}

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the title bar, tabs, and preset bar', () => {
    const w = mountApp()
    expect(w.text()).toContain('Map generator')
    for (const tab of ['Resources', 'Terrain', 'Enemy', 'Advanced']) {
      expect(w.text()).toContain(tab)
    }
    expect(w.text()).toContain('New preset')
  })

  it('creates a preset from the builtin dropdown via the Create button', async () => {
    const w = mountApp()
    await w.find('input[data-test="new-preset-name"]').setValue('speedrun')
    await w.find('select[data-test="builtin-select"]').setValue('Rail world')
    await w.find('button[data-test="create-preset"]').trigger('click')
    const editSelect = w.find('select[data-test="edit-preset-select"]')
    expect((editSelect.element as HTMLSelectElement).value).toBe('speedrun')
  })

  it('disables the seed input when "Random each new map" is checked', async () => {
    const w = mountApp()
    const seed = w.find('input[data-test="seed-input"]')
    expect((seed.element as HTMLInputElement).disabled).toBe(true)
    await w.find('[data-test="random-each-map"] input').setValue(false)
    expect((seed.element as HTMLInputElement).disabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test`
Expected: FAIL - App.vue does not render these elements yet.

- [ ] **Step 3: Implement**

`src/main.ts`:

```ts
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './ui/factorio.css'

createApp(App).use(createPinia()).mount('#app')
```

In `index.html`, set `<title>Factorio Map Generator</title>` (keep the rest of the template's html as scaffolded).

`src/components/PresetBar.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { BUILTIN_NAMES } from '../model/builtins'
import { usePresetsStore } from '../store/presets'
import FButton from '../ui/FButton.vue'
import FCheckbox from '../ui/FCheckbox.vue'
import FDropdown from '../ui/FDropdown.vue'

const store = usePresetsStore()
const newName = ref('')
const builtinChoice = ref('Default')

const builtinOptions = BUILTIN_NAMES.map((name) => ({ value: name, label: name }))
const editOptions = computed(() =>
  store.userPresets.map((p) => ({ value: p.name, label: p.name })),
)

const randomEachMap = computed({
  get: () => store.activePreset?.randomEachMap ?? true,
  set: (value: boolean) => {
    if (store.activePreset) store.activePreset.randomEachMap = value
  },
})

function create() {
  if (!newName.value.trim()) return
  store.createFromBuiltin(builtinChoice.value, newName.value)
  newName.value = ''
}

function onSeedChange(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (store.activePreset) {
    store.activePreset.seed = raw === '' ? null : Number(raw)
  }
}
</script>

<template>
  <div class="preset-bar f-bevel-out">
    <span class="field-label">Edit preset</span>
    <FDropdown
      data-test="edit-preset-select"
      :model-value="store.activeName ?? ''"
      :options="editOptions"
      @update:model-value="store.selectPreset($event)"
    />

    <span class="field-label">New preset</span>
    <input
      v-model="newName"
      data-test="new-preset-name"
      class="name-input"
      placeholder="New preset name"
      @keyup.enter="create"
    />
    <FDropdown
      v-model="builtinChoice"
      data-test="builtin-select"
      :options="builtinOptions"
    />
    <FButton data-test="create-preset" variant="tool" @click="create">Create</FButton>

    <span class="spacer" />

    <span class="field-label">Seed</span>
    <input
      data-test="seed-input"
      class="name-input seed"
      type="number"
      placeholder="Random"
      :disabled="randomEachMap"
      :value="store.activePreset?.seed ?? ''"
      @change="onSeedChange"
    />
    <FCheckbox v-model="randomEachMap" data-test="random-each-map" label="Random each new map" />
  </div>
</template>

<style scoped>
.preset-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--f-panel);
}

.field-label {
  font-weight: 700;
  color: var(--f-text-dim);
  white-space: nowrap;
}

.name-input {
  padding: 4px 8px;
  border: none;
  font: inherit;
  color: var(--f-text);
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.name-input:disabled {
  opacity: 0.4;
}

.name-input.seed {
  width: 110px;
}

.spacer {
  flex: 1;
}
</style>
```

`src/App.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import PresetBar from './components/PresetBar.vue'
import type { Planet } from './model/planets'
import FTabs from './ui/FTabs.vue'

const TABS = ['Resources', 'Terrain', 'Enemy', 'Advanced']
const activeTab = ref('Resources')
const selectedPlanet = ref<Planet>('nauvis')
</script>

<template>
  <div class="app">
    <header class="titlebar">Map generator</header>
    <PresetBar />
    <div class="body">
      <div class="editor">
        <FTabs v-model="activeTab" :tabs="TABS" />
        <!-- tab content, PreviewPanel, and ActionBar land in Task 11 -->
        <div class="tab-content f-bevel-out">{{ activeTab }} - coming in Task 11</div>
      </div>
      <aside class="preview f-bevel-out">Preview panel - coming in Task 11</aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100vh;
  padding: 8px;
}

.titlebar {
  font-size: 18px;
  font-weight: 700;
}

.body {
  display: grid;
  grid-template-columns: minmax(480px, 1fr) minmax(420px, 1fr);
  gap: 8px;
  flex: 1;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-content {
  flex: 1;
  background: var(--f-panel);
  padding: 8px;
}

.preview {
  background: var(--f-panel);
  padding: 8px;
}
</style>
```

Delete any leftover scaffold components/stores the template generated (e.g. `src/components/HelloWorld.vue`, `src/stores/counter.ts`) so `vp check` stays clean.

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS (3 app tests plus all earlier suites).

- [ ] **Step 5: Visual smoke**

Run: `vp dev`, open the printed URL, compare against `webmapgenerator.png`: dark theme, title, preset bar layout, orange active tab. Stop the server.

- [ ] **Step 6: Check and commit**

```fish
vp check --fix
git add -A
git commit -m "feat: add app shell and preset bar"
```

---

### Task 11: Editor tabs, preview panel, action bar, import

**Files:**
- Create: `src/components/ControlRow.vue`, `src/components/ControlTable.vue`, `src/components/ResourcesTab.vue`, `src/components/TerrainTab.vue`, `src/components/EnemyTab.vue`, `src/components/AdvancedTab.vue`, `src/components/PreviewPanel.vue`, `src/components/ActionBar.vue`, `src/components/ImportPanel.vue`
- Modify: `src/App.vue` (replace the Task 10 placeholders)
- Test: `test/app.spec.ts` (extend)

**Interfaces:**
- Consumes: UI kit (Task 9), `usePresetsStore` (Task 8), `CONTROL_CATALOG`, `controlsFor`, `ControlCategory` (Task 6), `PLANETS`, `PLANET_LABELS`, `Planet` (Task 6), `ExchangeStringError` (Task 5).
- Produces: component props - `ControlTable { planet: Planet; category: ControlCategory }`, `ControlRow { name: string }`, `ResourcesTab/TerrainTab/EnemyTab { planet: Planet }`, `PreviewPanel { planet: Planet }` emitting `update:planet`, `ActionBar` emitting `import-requested`, `ImportPanel` emitting `close`.

- [ ] **Step 1: Extend the failing tests**

Append to `test/app.spec.ts` inside the existing `describe`:

```ts
  it('shows nauvis resource rows by default', () => {
    const w = mountApp()
    for (const label of ['Coal', 'Iron ore', 'Copper ore', 'Uranium ore']) {
      expect(w.text()).toContain(label)
    }
    expect(w.text()).not.toContain('Tungsten ore')
  })

  it('switching the preview planet dropdown switches the visible controls', async () => {
    const w = mountApp()
    await w.find('select[data-test="planet-select"]').setValue('vulcanus')
    expect(w.text()).toContain('Tungsten ore')
    expect(w.text()).not.toContain('Iron ore')
  })

  it('editing a frequency number input updates the store', async () => {
    const w = mountApp()
    const coalRow = w.find('[data-test="control-row-coal"]')
    await coalRow.find('input[type="number"]').setValue('3')
    const stored = JSON.parse(JSON.stringify(w.vm.$pinia.state.value)) as {
      presets: { userPresets: { autoplaceControls: Record<string, { frequency: number }> }[] }
    }
    expect(stored.presets.userPresets[0]?.autoplaceControls['coal']?.frequency).toBe(3)
  })

  it('duplicate and save buttons work end to end', async () => {
    const w = mountApp()
    await w.find('button[data-test="duplicate"]').trigger('click')
    expect(w.text()).toContain('My preset (copy)')
    await w.find('button[data-test="save"]').trigger('click')
    expect(localStorage.getItem('factorio-map-webui.presets.v1')).toContain('My preset (copy)')
  })

  it('imports an exchange string through the import panel', async () => {
    const w = mountApp()
    await w.find('button[data-test="open-import"]').trigger('click')
    await w.find('[data-test="import-name"]').setValue('from-game')
    await w.find('[data-test="import-string"]').setValue(presetStrings['Marathon'] as string)
    await w.find('button[data-test="import-confirm"]').trigger('click')
    const editSelect = w.find('select[data-test="edit-preset-select"]')
    expect((editSelect.element as HTMLSelectElement).value).toBe('from-game')
  })

  it('shows an error for an invalid import string without crashing', async () => {
    const w = mountApp()
    await w.find('button[data-test="open-import"]').trigger('click')
    await w.find('[data-test="import-name"]').setValue('bad')
    await w.find('[data-test="import-string"]').setValue('not a string')
    await w.find('button[data-test="import-confirm"]').trigger('click')
    expect(w.find('[data-test="import-error"]').text()).toContain('envelope')
  })
```

And add to the top of `test/app.spec.ts`:

```ts
import fixtures from './fixtures/builtin-presets.json'

const presetStrings = fixtures.presets as Record<string, string>
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `vp test`
Expected: the 6 new tests FAIL (missing components); the Task 10 tests still pass.

- [ ] **Step 3: Implement the components**

`src/components/ControlRow.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { CONTROL_CATALOG } from '../model/controlCatalog'
import { usePresetsStore } from '../store/presets'
import FNumberInput from '../ui/FNumberInput.vue'
import FSlider from '../ui/FSlider.vue'

const props = defineProps<{ name: string }>()
const store = usePresetsStore()

const entry = computed(() => CONTROL_CATALOG[props.name])
const control = computed(() => store.activePreset?.autoplaceControls[props.name])
</script>

<template>
  <tr v-if="entry && control" class="control-row" :data-test="`control-row-${name}`">
    <td class="label">{{ entry.label }}</td>
    <td class="cell">
      <FSlider v-model="control.frequency" />
      <FNumberInput v-model="control.frequency" />
    </td>
    <td class="cell">
      <FSlider v-model="control.size" />
      <FNumberInput v-model="control.size" />
    </td>
    <td class="cell">
      <template v-if="entry.hasRichness">
        <FSlider v-model="control.richness" />
        <FNumberInput v-model="control.richness" />
      </template>
    </td>
  </tr>
</template>

<style scoped>
.label {
  font-weight: 700;
  padding: 6px 8px;
}

.cell {
  padding: 6px 8px;
}

.cell:deep(.f-slider) {
  width: 90px;
  vertical-align: middle;
  margin-right: 6px;
}
</style>
```

`src/components/ControlTable.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { controlsFor, type ControlCategory } from '../model/controlCatalog'
import type { Planet } from '../model/planets'
import ControlRow from './ControlRow.vue'

const props = defineProps<{ planet: Planet; category: ControlCategory }>()

const names = computed(() => controlsFor(props.planet, props.category))
</script>

<template>
  <table class="control-table">
    <thead>
      <tr>
        <th>{{ category === 'resource' ? 'Resource' : 'Setting' }}</th>
        <th>Frequency</th>
        <th>Size</th>
        <th>Richness</th>
      </tr>
    </thead>
    <tbody>
      <ControlRow v-for="name in names" :key="name" :name="name" />
    </tbody>
  </table>
  <p v-if="names.length === 0" class="empty">No {{ category }} controls on this planet.</p>
</template>

<style scoped>
.control-table {
  width: 100%;
  border-collapse: collapse;
}

.control-table th {
  text-align: left;
  padding: 6px 8px;
  color: var(--f-text-dim);
  border-bottom: 1px solid var(--f-edge-dark);
}

.control-table :deep(tr:nth-child(even)) {
  background: rgb(255 255 255 / 3%);
}

.empty {
  color: var(--f-text-dim);
}
</style>
```

`src/components/ResourcesTab.vue`:

```vue
<script setup lang="ts">
import type { Planet } from '../model/planets'
import ControlTable from './ControlTable.vue'

defineProps<{ planet: Planet }>()
</script>

<template>
  <ControlTable :planet="planet" category="resource" />
</template>
```

`src/components/TerrainTab.vue`:

```vue
<script setup lang="ts">
import type { Planet } from '../model/planets'
import ControlTable from './ControlTable.vue'

defineProps<{ planet: Planet }>()
</script>

<template>
  <ControlTable :planet="planet" category="terrain" />
  <p class="note">
    Water coverage, cliff continuity, and moisture expression settings unlock in
    Phase 1 once their payload offsets are mapped.
  </p>
</template>

<style scoped>
.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>
```

`src/components/EnemyTab.vue`:

```vue
<script setup lang="ts">
import type { Planet } from '../model/planets'
import ControlTable from './ControlTable.vue'

defineProps<{ planet: Planet }>()
</script>

<template>
  <ControlTable :planet="planet" category="enemy" />
  <p class="note">
    Evolution and expansion settings live in the MapSettings payload region and
    unlock in Phase 1.
  </p>
</template>

<style scoped>
.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>
```

`src/components/AdvancedTab.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { usePresetsStore } from '../store/presets'

const store = usePresetsStore()
const expressions = computed(() =>
  Object.entries(store.activePreset?.propertyExpressionNames ?? {}),
)
</script>

<template>
  <div class="advanced">
    <h3>Property expression names</h3>
    <p v-if="expressions.length === 0" class="note">
      None set - this preset uses default terrain generation expressions.
    </p>
    <table v-else class="expr-table">
      <tbody>
        <tr v-for="[key, value] in expressions" :key="key">
          <td class="key">{{ key }}</td>
          <td>{{ value }}</td>
        </tr>
      </tbody>
    </table>
    <p class="note">
      Read-only in Phase 0. Map size, terrain scale, and map settings unlock in
      Phase 1 once their payload offsets are mapped.
    </p>
  </div>
</template>

<style scoped>
.advanced h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.expr-table {
  border-collapse: collapse;
}

.expr-table td {
  padding: 4px 12px 4px 0;
}

.key {
  font-weight: 700;
}

.note {
  color: var(--f-text-dim);
}
</style>
```

`src/components/PreviewPanel.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { PLANET_LABELS, PLANETS, type Planet } from '../model/planets'
import FButton from '../ui/FButton.vue'
import FCheckbox from '../ui/FCheckbox.vue'
import FDropdown from '../ui/FDropdown.vue'

defineProps<{ planet: Planet }>()
const emit = defineEmits<{ 'update:planet': [value: Planet] }>()

const autoRefresh = ref(true)
const quality = ref('normal')
const qualityOptions = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]
const planetOptions = PLANETS.map((p) => ({ value: p, label: PLANET_LABELS[p] }))
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <FCheckbox v-model="autoRefresh" label="Auto-refresh" />
      <FDropdown
        data-test="planet-select"
        :model-value="planet"
        :options="planetOptions"
        @update:model-value="emit('update:planet', $event as Planet)"
      />
      <FDropdown v-model="quality" :options="qualityOptions" />
      <FButton variant="tool" disabled>Preview</FButton>
    </div>
    <div class="preview-placeholder f-bevel-in">
      <p>Map preview requires Factorio's noise engine and is planned for a later phase.</p>
      <p class="dim">Selected planet: {{ PLANET_LABELS[planet] }}</p>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-toolbar > :last-child {
  margin-left: auto;
}

.preview-placeholder {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--f-inset);
  text-align: center;
  padding: 16px;
}

.dim {
  color: var(--f-text-dim);
}
</style>
```

`src/components/ActionBar.vue`:

```vue
<script setup lang="ts">
import { usePresetsStore } from '../store/presets'
import FButton from '../ui/FButton.vue'

const store = usePresetsStore()
const emit = defineEmits<{ 'import-requested': [] }>()
</script>

<template>
  <div class="action-bar">
    <FButton data-test="open-import" @click="emit('import-requested')">Import string</FButton>
    <span class="spacer" />
    <FButton data-test="duplicate" @click="store.duplicateActive()">Duplicate</FButton>
    <FButton disabled title="ZIP export lands in Phase 1">Download ZIP</FButton>
    <FButton data-test="delete" variant="danger" @click="store.deleteActive()">Delete</FButton>
    <FButton data-test="save" variant="confirm" @click="store.saveToStorage()">Save</FButton>
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 8px;
  background: var(--f-panel);
}

.spacer {
  flex: 1;
}
</style>
```

`src/components/ImportPanel.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ExchangeStringError } from '../codec/mapExchangeString'
import { usePresetsStore } from '../store/presets'
import FButton from '../ui/FButton.vue'
import FPanel from '../ui/FPanel.vue'

const store = usePresetsStore()
const emit = defineEmits<{ close: [] }>()

const name = ref('')
const exchangeString = ref('')
const error = ref('')

function doImport() {
  error.value = ''
  try {
    store.importExchangeString(name.value || 'Imported preset', exchangeString.value)
    name.value = ''
    exchangeString.value = ''
    emit('close')
  } catch (caught) {
    if (caught instanceof ExchangeStringError) {
      error.value = caught.message
    } else {
      throw caught
    }
  }
}
</script>

<template>
  <FPanel title="Import map exchange string">
    <div class="import-form">
      <input
        v-model="name"
        data-test="import-name"
        class="name-input"
        placeholder="Preset name"
      />
      <textarea
        v-model="exchangeString"
        data-test="import-string"
        class="string-input"
        rows="5"
        placeholder=">>> ... <<<"
      ></textarea>
      <p v-if="error" data-test="import-error" class="error">{{ error }}</p>
      <div class="buttons">
        <FButton @click="emit('close')">Cancel</FButton>
        <FButton data-test="import-confirm" variant="tool" @click="doImport">Import</FButton>
      </div>
    </div>
  </FPanel>
</template>

<style scoped>
.import-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.name-input,
.string-input {
  padding: 4px 8px;
  border: none;
  font: inherit;
  color: var(--f-text);
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.string-input {
  resize: vertical;
  font-family: monospace;
}

.error {
  color: var(--f-red);
  margin: 0;
}

.buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
```

Rewrite `src/App.vue` to wire everything:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import ActionBar from './components/ActionBar.vue'
import AdvancedTab from './components/AdvancedTab.vue'
import EnemyTab from './components/EnemyTab.vue'
import ImportPanel from './components/ImportPanel.vue'
import PresetBar from './components/PresetBar.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import ResourcesTab from './components/ResourcesTab.vue'
import TerrainTab from './components/TerrainTab.vue'
import type { Planet } from './model/planets'
import FTabs from './ui/FTabs.vue'

const TABS = ['Resources', 'Terrain', 'Enemy', 'Advanced']
const activeTab = ref('Resources')
const selectedPlanet = ref<Planet>('nauvis')
const showImport = ref(false)
</script>

<template>
  <div class="app">
    <header class="titlebar">Map generator</header>
    <PresetBar />
    <ImportPanel v-if="showImport" @close="showImport = false" />
    <div class="body">
      <div class="editor f-bevel-out">
        <FTabs v-model="activeTab" :tabs="TABS" />
        <div class="tab-content">
          <ResourcesTab v-if="activeTab === 'Resources'" :planet="selectedPlanet" />
          <TerrainTab v-else-if="activeTab === 'Terrain'" :planet="selectedPlanet" />
          <EnemyTab v-else-if="activeTab === 'Enemy'" :planet="selectedPlanet" />
          <AdvancedTab v-else />
        </div>
      </div>
      <aside class="preview f-bevel-out">
        <PreviewPanel v-model:planet="selectedPlanet" />
      </aside>
    </div>
    <ActionBar @import-requested="showImport = true" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100vh;
  padding: 8px;
}

.titlebar {
  font-size: 18px;
  font-weight: 700;
}

.body {
  display: grid;
  grid-template-columns: minmax(480px, 1fr) minmax(420px, 1fr);
  gap: 8px;
  flex: 1;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--f-panel);
  padding: 8px;
}

.tab-content {
  flex: 1;
}

.preview {
  background: var(--f-panel);
  padding: 8px;
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `vp test`
Expected: PASS - all app tests (Task 10's 3 + these 6) and every earlier suite.

- [ ] **Step 5: Visual smoke against the mockup**

Run: `vp dev` and verify against `webmapgenerator.png`:
- Resources tab shows the six Nauvis resources plus sliders/value boxes in Frequency/Size/Richness columns.
- Planet dropdown in the preview toolbar switches Resources/Terrain/Enemy content (Vulcanus shows Tungsten ore etc.).
- Import panel round-trip: paste any fixture string from `test/fixtures/builtin-presets.json`, import, see the preset appear in the Edit preset dropdown.
- Save, reload the page, preset edits survive.

Stop the server.

- [ ] **Step 6: Check and commit**

```fish
vp check --fix
git add -A
git commit -m "feat: add editor tabs, preview placeholder, action bar, and string import"
```

---

### Task 12: Phase 0 verification and wrap-up

**Files:**
- Create: `README.md`
- Modify: none expected (fixes only if verification fails)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified Phase 0 milestone and the recorded starting point for the Phase 1 plan.

- [ ] **Step 1: Full verification run**

```fish
vp check --fix
vp test
vp build
```

Expected: check clean, all suites pass (fixtures, crc32, base64, binaryReader, deflate, decode, catalog, builtins, store, ui-kit, app), build emits `dist/`. Then `vp preview` (or serve `dist/` statically) and click through the Task 11 Step 5 checklist once against the production build.

- [ ] **Step 2: Write README.md**

```markdown
# Factorio Map WebUI

A pure static SPA for authoring and exchanging Factorio 2.1.9 (experimental)
map generation presets. No backend - everything runs in the browser.

## Status

Phase 0 complete: decode-only codec (format 2.1.9.3), full multi-planet
editor over the decoded model, localStorage presets, exchange-string import.
Phase 1 (encode, round-trip guarantees, JSON/ZIP export) is planned in
`docs/superpowers/plans/`.

## Development

Requires Node 24.18.0 (see `.node-version`) and the `vp` CLI (Vite+).

- `vp install` - install dependencies (pnpm)
- `vp dev` - dev server
- `vp check --fix` - lint + format
- `vp test` - test suite (fixture-driven codec tests and UI tests)
- `vp build` - production build

## Design

See `docs/superpowers/specs/2026-07-01-factorio-map-webui-design.md`. The
codec is fixture-driven: `test/fixtures/builtin-presets.json` holds all 9
built-in presets captured from Factorio 2.1.9 and is read-only ground truth.
```

- [ ] **Step 3: Confirm Phase 1 handoff state**

Verify these facts hold and note any deviation in the commit message (the Phase 1 plan depends on them):
- The compressor-fidelity tests (Task 4) pass for all 9 fixtures, or the divergences are recorded as `it.fails` cases.
- `DecodedExchange.midBlock`/`tail` + `Preset.opaqueMidB64`/`opaqueTailB64` carry all undecoded bytes, so the Phase 1 encoder can emit `header + flag + autoplace + mid block + property dict + tail + CRC` and hit payload-level round-trip immediately.
- Open items deliberately NOT addressed in Phase 0 (spec Sections 4/14): the Default cliff-string anomaly (re-capture + diff), absent-optional path, float32-rounding test, varint confirmation, Appendix A JSON schema dumps, seed offset mapping.

- [ ] **Step 4: Commit**

```fish
git add README.md
git commit -m "docs: add README and close out Phase 0"
```

---

## Self-review notes (done at planning time)

- Spec coverage: Phase 0 items from spec Section 12 all map to tasks - decode (Tasks 2-5), model/catalog/defaults derivation (Tasks 6-7), scaffold (Task 1), UI kit (Task 9), editor + localStorage presets (Tasks 8, 10, 11). Exchange-string import (spec Section 8) is decode-only, hence included (Task 11). The compressor-fidelity test is pulled forward from "very early Phase 1" into Task 4 on purpose. Everything else in the spec is Phase 1 and is listed explicitly in Task 12 Step 3 so it cannot silently drop.
- Type consistency: `AutoplaceSetting`/`FormatVersion` are defined once in the codec (Task 5) and re-exported by the model (Task 6). `decodeExchangeString`, `ExchangeStringError`, `presetFromDecoded`, `getBuiltinPreset(s)`, `BUILTIN_NAMES`, `usePresetsStore`, `controlsFor`, `CONTROL_CATALOG` names are used identically across Tasks 5-11.
- Known judgment calls an executor should not "fix" silently: builtins decode fixtures at runtime instead of a hand-written `defaults.ts` (rationale in Task 7); `src` imports `test/fixtures/builtin-presets.json` (single source of truth); seed is UI-only until Phase 1; FSlider range 0-6 linear is a Phase 0 approximation of Factorio's detented slider.

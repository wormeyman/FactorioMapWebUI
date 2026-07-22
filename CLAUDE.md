# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Factorio Lua API - check the local mirror FIRST

A full offline copy of the Factorio 2.x Lua API docs lives at `factorioLuaAPI/`
(git-ignored, ~24 MB, HTML + JSON). **Before answering any Factorio API question
or WebFetching lua-api.factorio.com / wiki.factorio.com, grep this directory.**
It is the authoritative source for how the map generator, noise expressions, and
map-gen settings work.

Useful entry points:

- `factorioLuaAPI/auxiliary/noise-expressions.html` - named noise expressions and
  the `control:<name>:frequency|size|richness|bias` constants (e.g.
  `control:moisture:frequency`, `control:aux:bias`, `control:temperature:*` - the
  exact keys this app's `property_expression_names` codec round-trips).
- `factorioLuaAPI/types/MapGenSettings.html`, `types/FrequencySizeRichness.html`,
  `types/AutoplaceControlID.html` - map-gen settings structure and autoplace controls.
- `factorioLuaAPI/runtime-api.json` and `prototype-api.json` - machine-readable
  dumps; grep these for a signature/field faster than the HTML.

Only fall back to WebFetch if something genuinely is not in this mirror.

### Game _data_ (prototype Lua) for noise/autoplace RE - use `~/GitHub/factorio-data`

The `factorioLuaAPI/` mirror above is the API _docs_. For the actual base-game
map-gen **source** (the noise expression trees, autoplace utils, resource
prototypes) that the client-side preview ports, use **`~/GitHub/factorio-data`** -
a local clone of the official `wube/factorio-data` repo with per-version git tags.
Check out the tag matching the oracle binary before reading:
`git -C ~/GitHub/factorio-data checkout 2.1.11` (verify `base/info.json`'s
`"version"` matches `factorio --version`; `master` may sit a few commits ahead).
Key files: `core/prototypes/{noise-functions,noise-programs}.lua`,
`core/lualib/resource-autoplace.lua`, `base/prototypes/entity/resources.lua`.
**Do NOT use `~/Downloads/factorio 4/data` - it is Factorio 2.0.77 (stale)** and
`starting_patches` changed materially by 2.1.11. `git pull` fetches newer versions.

### Automate with the Factorio headless CLI

A lot can be driven from the command line - see
https://wiki.factorio.com/Command_line_parameters (the game's own binary; this
is a wiki page, not in the `factorioLuaAPI/` mirror). Relevant here:

- **Map-gen testing / validation:** `factorio --create <save> --map-gen-settings
<json> --map-gen-seed <n> --mod-directory <dir>` runs headless and exits
  cleanly even alongside a running game if you point an isolated `--config` INI's
  `write-data` at a temp dir. This is how the codec is cross-validated against the
  game's own parse (a dumper mod calls `helpers.parse_map_exchange_string` and
  writes JSON) - the resulting fixture lives at
  `test/fixtures/map-exchange-parsed.default-seed123456.dump.json`.
- **Preview rendering:** `factorio --generate-map-preview` is exactly what
  `preview-service/container/` shells out to.

Prefer the game as an oracle over byte-diffing when settling a codec question.

## Commands

Run `vp` (Vite+) **through pnpm** - the project pins pnpm via `devEngines`, so a
bare `vp` or `npx vp` from the project root fails with `EBADDEVENGINES`.

Node **26.5.0** (`.node-version`) is what the repo is developed and verified on.
`engines.node` stays a permissive floor (`>=24.18.0`) rather than matching the
pin - older versions are simply untested, not known-broken. Nothing local
consumes `.node-version` (node comes from Homebrew, no version manager is
installed) and Cloudflare Pages never builds this repo - `deploy:app` uploads an
already-built `dist` - so the file is documentation, not machinery.

Adding a root dependency needs `pnpm add -w` (or `--workspace-root`); a bare
`pnpm add <pkg>` at the root fails with `ERR_PNPM_ADDING_TO_ROOT`. Prefer
targeted `pnpm add` over `pnpm up` for dependency bumps - see the type-checking
note below for why `pnpm up`'s transitive re-resolution can break `vp check`.

- `pnpm install` - install deps
- `pnpm vp dev` - dev server
- `pnpm vp test` - full test suite (Vitest-compatible; tests import from `"vite-plus/test"`)
- `pnpm vp test test/controlScale.spec.ts` - a single test file
- `pnpm vp check --fix` - format + lint + **type-check**, the single static-check
  step (see the type-checking note below; there is still **no** `vue-tsc` check
  of `.vue` bodies)
- `pnpm vp build` - production build
- `pnpm run deploy` - build + `wrangler pages deploy` to Cloudflare Pages

The app is live at **`map.factorygamefan.com`**. The apex `factorygamefan.com`
is a separate landing page, not this app; the worker's `ALLOWED_ORIGIN` is the
`map.` subdomain.

Preview-service stack (optional feature, needs Docker): `pnpm preview:dev` runs
the Worker (`:8787`) + app (`:5173`) together; `pnpm preview:test` runs its unit
tests. See README for the full list.

## Architecture

A static, backend-free SPA (Vue 3 `<script setup>` + Pinia) for authoring
Factorio 2.1.9 map-generation presets, plus an optional Cloudflare preview
service in a separate workspace.

### The codec is the core, and byte-exactness is a hard invariant

`src/codec/mapExchangeString.ts` decodes a map-exchange string to a
`DecodedExchange` and re-encodes it. The encoder must reproduce the game's zlib@9
stream **byte-for-byte** - re-emitting a string must equal the original.
Consequences that constrain any change here:

- Deflate goes through `zlib-asm` specifically; `pako`/`fflate` diverge from the
  game's stream. `zlib-asm` uses direct `eval`, so the app's CSP must allow
  `unsafe-eval` (and the production build logs an `[EVAL]` warning - expected).
- `src/codec/fieldSchema.ts` (`readFields`/`writeFields`) drives the typed
  binary layout; `binaryReader`/`binaryWriter`/`crc32`/`base64` are the
  primitives.
- `test/fixtures/builtin-presets.json` (9 presets captured from the game) is
  **read-only ground truth**. Codec tests decode→re-encode each and assert the
  bytes are identical. Never edit a fixture or an expected value to make a test
  pass - a mismatch is a real finding.

### Two representations, bridged by `convert.ts`

The codec speaks `DecodedExchange` (raw wire shape). The app speaks `Preset`
(`src/model/types.ts`). `src/model/convert.ts` maps between them
(`presetFromDecoded` / `presetToEncodable`). `src/model/builtins.ts` decodes the
9 fixtures once and hands out deep clones (`getBuiltinPreset`).

### The store is the reactive spine

`src/store/presets.ts` (Pinia) holds `userPresets: Preset[]` + `activeName`. Two
getters matter: `activePreset`, and `activeExchangeString` (a live re-encode of
the active preset). Editing any control mutates the active `Preset` in place, and
`activeExchangeString` recomputes through Pinia reactivity - that is how edits
flow to the exported string. **Edits are NOT persisted to localStorage until an
action calls `saveToStorage()`** (most control-slider edits don't; they survive
in-session but are lost on reload until a Save). `seed` is the single source of
truth for "random each new map": `null` = random, which encodes to wire `0`.

### Controls: autoplace vs. climate (an important asymmetry)

- **Autoplace controls** (iron, coal, enemy-base, cliffs, ...) have dedicated
  `frequency`/`size`/`richness` floats stored in `Preset.autoplaceControls`.
  `src/model/controlCatalog.ts` is the catalog (labels, planet); `ControlTable` /
  `ControlRow` render them bound to the store.
- **Climate controls** (moisture, aux = "terrain type") have **no** dedicated
  struct - only `frequency` + `bias`, stored purely as `property_expression_names`
  overrides (`control:moisture:frequency`, `control:aux:bias`, ...). Accessed via
  `src/model/climateControls.ts` (`{ freqKey, biasKey }` + read/write helpers).
  Writing a value that snaps to the default notch **deletes** the key (so an
  edited-then-reset preset stays byte-identical to the game's empty dict).
- `src/model/controlScale.ts` holds the slider notch math: geometric
  `PERCENT_STEPS`, and the `StepScale` abstraction (`PERCENT_SCALE` /
  `BIAS_SCALE`) that lets one `FPercentSlider` serve both percent and bias.
  Scale is stored as `frequency = 1/scale`; all wire values are `toFixed(6)`.

### UI

`App.vue` hosts the tabbed editor (Resources / Terrain / Enemy / Advanced).
`src/ui/` is a Factorio-styled component kit (`F*` components + `factorio.css`).
Sliders bind through the store so edits reach `activeExchangeString`.

`src/store/ui.ts` (Pinia `useUiStore`) holds UI-only preferences - currently
just `devMode` - and persists immediately under `fmw.devMode`, unlike the
preset store's Save-gated persistence. Dev mode reveals the preview panel's six
view toggles and the elapsed-ms render readout; it is toggled by the toolbar
"Debug" checkbox and can be seeded from the URL with `?dev=1` (or forced off
with `?dev=0`).

The **Enemy tab** (`src/components/EnemyTab.vue`) is the one tab that edits
MapSettings _tail_ fields (`mapSettings.enemyEvolution` / `enemyExpansion`),
overlaid back onto the tail at encode time by `writeEnemyToTail` - so untouched
imports stay byte-exact (values are converted only on set). Three non-obvious UI
conventions live here:

- **Evolution factors are scaled for display.** The game's map-gen GUI shows
  these tiny wire floats scaled up: time & pollution `display = wire * 1e7`,
  destroy `* 1e5` (so default time `0.000004` reads `40`, destroy `0.002` reads
  `200`, pollution `0.0000009` reads `9`). `EVO_DISPLAY_SCALE` in `EnemyTab.vue`
  holds this; the slider/box work in display space, the wire stays raw. Verified
  against the game by importing strings with known wire values and reading the
  GUI.
- **Cooldowns display in minutes**, stored as ticks (`* 3600`).
- **Min/max expansion distance are linked** (max always > min, both clamped
  `[1,20]`); editing one drags the other.

Field labels carry in-game tooltip text via `FInfo` (an `info` prop on
`EnemyValueRow`, an `info:` entry in `controlCatalog.ts` for the enemy-base
autoplace rows).

### Preview service (`preview-service/`)

A separate pnpm workspace (`worker/` Cloudflare Worker + `container/`
digest-pinned Factorio headless image). Opt-in and the app's only outbound call;
the editor is fully functional offline without it.

`wrangler` is not global - drive it through the workspace:
`pnpm --filter @fmw/preview-worker exec wrangler <cmd>`.

**`worker-configuration.d.ts` is generated and must stay in sync with
`wrangler.jsonc`.** It once drifted silently (the types declared the apex origin
while the config said the `map.` subdomain). Nothing caught that: it is not a
type error, so both `vp check` and the worker tests pass with a wrong value in
it. `wrangler types --check` now gates the worker's `test` and `deploy` scripts,
so `pnpm preview:test` fails loudly on drift.

- Regenerate with
  `pnpm --filter @fmw/preview-worker exec wrangler types && pnpm vp check --fix`.
  The formatter pass is **not optional** - wrangler emits tabs/unwrapped types
  and the repo formats to 2-space/wrapped, so a raw regen shows a whole-file
  whitespace diff that hides the real change.
- Limitation: `--check` compares the **config** against the hash recorded in the
  generated file's header. It catches a changed `wrangler.jsonc`, but it does
  **not** notice hand-edits to the generated file itself. Don't hand-edit it.
- The worker deliberately has **no** `typescript` and **no**
  `@cloudflare/workers-types` devDependency, and ignores wrangler's
  "Install @types/node" advice. See the comment in
  `preview-service/worker/tsconfig.json` before adding any of them back.

## Conventions

- `docs/superpowers/specs/` and `docs/superpowers/plans/` are point-in-time
  design/plan records, **not** living docs - don't treat them as current state.

### Type-checking runs through `vp check`, not `tsc`

`vp check` runs format, lint, **and** type checks. The type-check step is gated
behind `lint.options.typeAware` + `lint.options.typeCheck` in `vite.config.ts` -
both are on. Do not add a `tsc`-based `typecheck` script:

- **`tsc` is not the type-check path.** Bare `./node_modules/.bin/tsc --noEmit`
  **crashes** (`Debug Failure. False expression: parameter should have errors
when reporting errors`) - a TypeScript 6.0.3 compiler bug, not a type error,
  triggered by `vite.config.ts` alone. `vp check` type-checks that same file
  fine because it uses **tsgolint** (the TypeScript Go toolchain), a different
  implementation. Beware: passing globs (`tsc --noEmit 'src/**/*.ts'`) silently
  ignores `tsconfig.json` and reports a misleading "ok".
- **`.vue` bodies are still unchecked.** Neither `vp check` nor `tsc` reports
  type errors inside `<script setup lang="ts">` (measured, not assumed). So
  `vp check` is a partial net over `.ts` only, not a full gate.
- **`vite.config.ts` sits near TypeScript's comparison-depth limit.** A shift in
  the transitive dependency graph can tip it over, making `vp check` fail with
  `TS2321: Excessive stack depth comparing types ... and 'UserConfig'` - the
  same pathology behind the `tsc` crash, and nothing to do with the file being
  wrong. This is why dependency bumps use targeted `pnpm add` rather than
  `pnpm up`: `pnpm up` re-resolves ~22 surrounding packages and triggered
  exactly this, while installing the same target versions directly did not. If
  it reappears, suspect the transitive graph, not the named package. Annotating
  the config with an explicit type does **not** help - the augmented
  `UserConfig` lives in `@voidzero-dev/vite-plus-core`, which is not resolvable,
  and vitest's exported `ViteUserConfig` lacks the `staged`/`lint`/`fmt` fields.
- The project stays on `typescript` 6.0.3 as the _editor/LSP_ compiler; the TS7
  upgrade is deferred because `vue-tsc`/Volar can't yet type-check `.vue`
  against it. Note the type-_check_ already effectively runs on TS7 via
  tsgolint, so the deferral only ever applied to `vue-tsc`.

Two deliberate suppressions live in `vite.config.ts`, both narrow on purpose:

- `typescript/unbound-method` is off for `test/**/*.spec.ts` -
  `expect(mock.fn).toHaveBeenCalled()` passes an unbound reference by design.
- The `[EVAL]` build warning is filtered in `build.rollupOptions.onLog` **by
  module id** for `zlib-asm` only, rather than via `checks.eval = false`, so a
  direct `eval` introduced anywhere else still warns. `zlib-asm`'s `eval` is
  load-bearing (it is the only deflate that matches the game's stream
  byte-for-byte), which is also why the app's CSP needs `unsafe-eval`.

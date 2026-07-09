# Factorio Map WebUI

A pure static SPA for authoring and exchanging Factorio 2.1.9 (experimental)
map generation presets. No backend - everything runs in the browser.

## Status

Phases 0-1c complete and merged. The codec (format 2.1.9.3) does a
**byte-exact** decode/encode round-trip on all 9 built-in presets and the
reference fixtures - the encoder reproduces the game's zlib@9 stream via
`zlib-asm`, so re-emitted strings are byte-identical to the originals.

Decoded and typed on the model:

- **Mid-block:** `autoplace_settings` count + `default_enable_all_autoplace_controls`,
  `seed`, `width`, `height`, `starting_area`, `peaceful_mode`, `no_enemies_mode`.
  Still opaque: `area_to_generate_at_start` and `starting_points` (both are
  byte-identical across the corpus, so cracking them needs new positive
  fixtures).
- **Tail:** the entire MapSettings region (cliffs, pollution, enemy evolution/
  expansion, unit group, path finder, difficulty, asteroids) is fully typed;
  it decodes to zero residual opaque bytes.

Also shipped: a full multi-planet editor over the decoded model, localStorage
presets, exchange-string import, and export of `map-gen-settings.json` +
`map-settings.json` as a downloadable ZIP. `seed` is a single source of truth
for "random each new map" (`null` = random, which encodes to wire 0).

Design and phase history live in `docs/superpowers/specs/` and
`docs/superpowers/plans/` (point-in-time records, not living docs).

## Development

Requires Node 24.18.0 (see `.node-version`) and the `vp` CLI (Vite+). The
project pins pnpm via `devEngines`, so run `vp` through pnpm (a bare `vp` or
`npx vp` from the project root fails with `EBADDEVENGINES`).

- `pnpm install` - install dependencies
- `pnpm vp dev` - dev server
- `pnpm vp check --fix` - lint + format
- `pnpm vp test` - test suite (fixture-driven codec tests and UI tests)
- `pnpm vp build` - production build

## Design

See `docs/superpowers/specs/2026-07-01-factorio-map-webui-design.md`. The
codec is fixture-driven: `test/fixtures/builtin-presets.json` holds all 9
built-in presets captured from Factorio 2.1.9 and is read-only ground truth.

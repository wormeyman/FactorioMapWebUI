# Factorio Map WebUI

A pure static SPA for authoring and exchanging Factorio 2.1.9 (experimental)
map generation presets. No backend - everything runs in the browser.

## Status

Phase 0 complete: decode-only codec (format 2.1.9.3), full multi-planet
editor over the decoded model, localStorage presets, exchange-string import.
Byte-identical string export will require a zlib-exact deflate (pako level 9
diverges from the game's zlib on all 9 fixtures; the payload-level round-trip
is the primary guarantee). Phase 1 (encode, round-trip guarantees, JSON/ZIP
export) is planned in `docs/superpowers/plans/`.

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

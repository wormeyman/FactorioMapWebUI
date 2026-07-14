# Factorio Map WebUI

A static SPA for authoring and exchanging Factorio 2.1.9 (experimental) map
generation presets. The core editor has no backend - everything runs in the
browser. An optional, opt-in map preview service (the app's only outbound call)
renders real Factorio previews via Cloudflare; the editor stays fully functional
offline without it. See [Map preview service](#map-preview-service).

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
for "random each new map" (`null` = random, which encodes to wire 0). The
**Enemy tab** additionally makes MapSettings tail fields editable - enemy
evolution and expansion - with the game's own display scaling (evolution factors
shown scaled up from the tiny wire floats, cooldowns in minutes), linked min/max
expansion distance, and in-game tooltip text on every field.

The **map preview service** (`preview-service/`) is code-complete and validated
end to end locally: clicking "Generate preview" POSTs the active preset's
`map-gen-settings` to a Cloudflare Worker, which serves a cached PNG from R2 or
renders one with the real Factorio 2.1.9 headless engine in a container. Only
the live Cloudflare deploy remains as a hand-off.

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

## Map preview service

`preview-service/` is a pnpm workspace holding the two backend pieces:

- `worker/` - a Cloudflare Worker: validates the request, computes a cache key,
  serves a cached PNG from R2 on a hit, and on a miss enforces a monthly render
  budget (Durable Object) before calling the container. Returns the PNG through
  the Worker so it stays same-origin with the app.
- `container/` - a digest-pinned `factoriotools/factorio:2.1.9` image plus a thin
  Node HTTP server that shells out to `factorio --generate-map-preview` and
  returns the PNG bytes.

### Run the whole stack locally (needs Docker)

`wrangler dev` builds and runs the container through your local Docker daemon and
simulates the R2 and Durable Object bindings, so no Cloudflare deploy is needed
to develop or test the feature:

- `pnpm preview:dev` - runs the Worker (on `:8787`) and the app (on `:5173`)
  together; Ctrl-C tears down both. Wires `ALLOWED_ORIGIN` and
  `VITE_PREVIEW_SERVICE_URL` so the local CORS and service URL match.
- `pnpm preview:worker` - just the Worker + container (`wrangler dev`)
- `pnpm preview:app` - just the app, pointed at the local Worker
- `pnpm preview:test` - Worker + container unit tests
- `pnpm preview:deploy` - `wrangler deploy` the Worker

The container image build and render are also covered by a Docker integration
test: `pnpm --filter @fmw/preview-container test:integration`.

### Deploy (hand-off)

Deploying to Cloudflare is the one step not yet done. It needs a Cloudflare
account and Workers Paid ($5/mo, required for Containers):

```
pnpm --filter @fmw/preview-worker exec wrangler r2 bucket create fmw-preview-cache
# fill REPLACE_WITH_APP_ORIGIN in preview-service/worker/wrangler.jsonc, then:
pnpm --filter @fmw/preview-worker exec wrangler types
pnpm preview:deploy
# set VITE_PREVIEW_SERVICE_URL and fill REPLACE_WITH_WORKER_ORIGIN in public/_headers
pnpm vp build
```

Design and the task-by-task plan:
`docs/superpowers/specs/2026-07-10-map-preview-service-design.md` and
`docs/superpowers/plans/2026-07-10-map-preview-service.md`.

## Design

See `docs/superpowers/specs/2026-07-01-factorio-map-webui-design.md`. The
codec is fixture-driven: `test/fixtures/builtin-presets.json` holds all 9
built-in presets captured from Factorio 2.1.9 and is read-only ground truth.

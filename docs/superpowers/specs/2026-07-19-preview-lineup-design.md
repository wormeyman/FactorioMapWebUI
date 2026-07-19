# Line up the client and server map previews - design

Written 2026-07-19. Point-in-time design record (not a living doc).

## Goal

Make the client-side elevation preview (`ElevationPreviewPanel`, the "Preview"
tab) cover the **same world extent** and display at the **same on-screen size** as
the server-rendered preview (`PreviewPanel`, always visible in the side panel), so
the two panels - already adjacent whenever the Preview tab is open - can be
compared directly for Nauvis coastlines. The server render is the fixed reference;
only the client changes.

## Current state

- `src/components/PreviewPanel.vue` (server): posts to the preview-service, which
  runs `factorio --generate-map-preview` at `--map-preview-size 1024`, default
  offset (0,0) = world origin, and shows the returned 1024x1024 PNG in an `<img>`.
  Factorio has **no** preview-scale flag (only `--map-preview-size` and
  `--map-preview-offset`), so the world extent is a fixed internal default.
- `src/components/ElevationPreviewPanel.vue` (client): renders `PREVIEW_PX = 512`
  at `TILES_PER_PIXEL = 4` (a 2048-tile window) centered on the preset's spawn
  point, to a `<canvas>`.
- Both stages share identical CSS (`.preview-stage` + `max-width/height:100%`,
  `image-rendering: pixelated`), but sit in different-width containers (side panel
  vs main tab area), so they display at different on-screen sizes. And the world
  extents differ (server's fixed default vs the client's 2048 tiles), so the same
  terrain appears at different scales.

The comparison is only meaningful when the server panel's planet = **Nauvis** (the
client renders land/water in blue/green; the server renders full-color terrain).
This is a fidelity spot-check of coastline shape/position, not a color match.

## Approach - three alignments (client-only)

### 1. World extent (zoom) - measure, then match

Measure the server preview's world extent (tiles across a 1024px preview, offset
0,0, Nauvis) and hardcode it as a constant `SERVER_PREVIEW_TILES`.

Measurement (offline, one-time, with the local Factorio + the committed
`test/fixtures/map-gen-settings.default-nauvis.dump.json`):
- Render a server preview: `factorio --generate-map-preview out.png --map-gen-settings
  <default-nauvis> --map-preview-planet nauvis --map-gen-seed 123456
  --map-preview-size 1024`. (macOS bundle needs the isolated `--config` with
  `read-data=../data`, as the oracle harness already does.)
- Determine tiles-across. Primary method (exact): render a second preview at
  `--map-preview-offset D,0` for a known D tiles; the image shifts horizontally by
  `D / tiles_per_pixel` pixels, so `tiles_per_pixel = D / pixel_shift` and
  `SERVER_PREVIEW_TILES = tiles_per_pixel * 1024`. A rough render-both-and-eyeball
  cross-check (server PNG vs a client render at the candidate extent) confirms it;
  precision to a few percent is sufficient for eyeballing coastlines.

Then set the client to the same world square: with `PREVIEW_PX = 1024`,
`TILES_PER_PIXEL = SERVER_PREVIEW_TILES / 1024`.

### 2. Center on world origin (0,0)

The server centers on origin via its default offset. Change the client to center
on (0,0) as well (currently it centers on `startingPositions[0]`, the preset
spawn). Spawn is usually at/near origin, but centering on origin guarantees the
two overlay regardless of a preset's starting point. Concretely the client's
`originX = originY = -SERVER_PREVIEW_TILES / 2` (a full window centered on 0,0),
independent of the spawn point. Note the elevation tree itself still uses the real
spawn/starting-lake positions for its `distance`-gated terms - only the *view
window* is recentred on origin.

### 3. On-screen display size

Give both panels' displayed media the same fixed square display size so they are
literally the same size on screen despite their different containers. A shared
`max-width/height:100%` alone does NOT equalize them: each image caps at its own
container's width, and the side panel and the main tab area differ. So pick one
shared display square sized to fit the **narrower** of the two containers (the side
panel), expressed as a CSS custom property / shared class, and apply it to both
`.preview-canvas` and `.preview-image` as an explicit `width`/`height` (with
`max-width:100%` retained so it still shrinks on a very narrow viewport). Both then
render at exactly that size. The exact value is chosen during implementation by
checking the rendered side-panel width; both panels reference the single shared
value so they cannot drift apart.

## Decisions (confirmed)

- **Client resolution: 1024px** (`PREVIEW_PX = 1024`) to match the server's native
  1024px pixel-for-pixel. Cost: ~4x the pixels of today's 512px render, so ~7s per
  Generate (was ~1.7s). Acceptable because the render already runs on a Web Worker
  (the UI does not freeze; the button shows "Rendering...").
- **Center on origin (0,0)**, not the preset spawn.
- **Hardcoded match** to the measured `SERVER_PREVIEW_TILES` (no zoom UI).

## Files

- `src/components/ElevationPreviewPanel.vue`: `PREVIEW_PX 512 -> 1024`,
  `TILES_PER_PIXEL 4 -> SERVER_PREVIEW_TILES/1024`, recenter the window on (0,0),
  add the shared display-size class/var to the canvas. A short comment records
  `SERVER_PREVIEW_TILES` and how it was measured.
- `src/components/PreviewPanel.vue`: add the same shared display-size
  class/var to the `<img>` (no behavior change).
- A shared CSS value (custom property in `factorio.css` or a tiny shared class) for
  the display size, so the two panels cannot drift apart.

## Testing

- Unit: the panel builds a render request whose window is centered on (0,0) and
  spans `SERVER_PREVIEW_TILES` (`originX = originY = -SERVER_PREVIEW_TILES/2`,
  `width = height = 1024`, `tilesPerPixel = SERVER_PREVIEW_TILES/1024`). This
  guards the extent/center wiring (the existing panel spec already asserts the
  request shape - update its expected origin/size).
- The measurement itself is an offline derivation, not a CI test (it needs
  Factorio); the derived constant is committed with a comment citing the method.
- Visual confirmation in the app: on the Preview tab with the side panel set to
  Nauvis, the two previews show the same region at the same size.

## Non-goals / out of scope

- No change to the server render or the preview-service.
- No zoom/pan/offset UI (fixed match).
- No color/tile-type parity - the client stays land/water only.
- Aligning non-Nauvis planets (the client only renders Nauvis elevation).

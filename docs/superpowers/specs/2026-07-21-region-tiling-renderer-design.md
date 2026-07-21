# Region-tiling parallelization of the client-side map renderer

Date: 2026-07-21
Status: design approved, not yet implemented

## Problem

The client-side map preview renders on a single Web Worker. Measured in the
browser at 1024x1024, 1 tile/pixel, seed 123456:

| view                       | wall-clock |
| -------------------------- | ---------- |
| elevation only             | ~1.7s      |
| terrain                    | ~9.1s      |
| all (terrain + 3 overlays) | ~12.5s     |

(The `pnpm perf` Node bench reports ~1.4s / ~8.0s / ~10.9s for the same cases;
it runs about 15% optimistic against the browser. Browser numbers are the ones
that matter and the ones this design is gated on.)

Ten-plus seconds is too slow to feel interactive. The goal is to cut wall-clock
by parallelizing across a worker pool, without changing a single output pixel.

## Why region tiling, not per-layer

Splitting work by layer was rejected. The three overlays read the terrain buffer
they composite onto (they skip pixels the terrain drew as water), so they cannot
start until terrain finishes. Per-layer parallelism therefore leaves the
dominant ~9s terrain pass serial and only splits the ~3s overlay tail.

Region tiling splits the entire per-region cost - terrain and every overlay -
uniformly. Every tile is self-contained, so all ~12.5s is parallelizable.

It works here because all noise is a pure function of `(seed, world x, world y)`.
Verified by reading the renderers: `renderTerrain`, `renderResources` and
`renderEnemies` sweep pixels and evaluate a field at each world coordinate, with
no dependence on the extent of the buffer. Resource spot lists are already
memoized per 1024-tile world region, keyed on world region index, not on the
render box.

`renderCliffs` is the one exception, and the only source of a seam artifact -
see "The cliff halo" below.

## Decisions

| Question   | Decision                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| Paint      | Progressive - blit each tile as it lands                                    |
| Geometry   | Over-decompose into a fixed grid of square tiles + work queue               |
| Setup cost | Measure first (phase A); split scene from geometry only if it bites (phase B) |
| Transport  | Transferable per-tile buffers, no SharedArrayBuffer                        |
| Halo       | Clamp the cliff halo to the full-image box - output stays byte-identical    |

### Progressive paint

Perceived latency is the actual goal. A map filling in tile by tile reads as
responsive in a way a multi-second blank pause does not, and it costs nothing
extra - the stitch target is the same canvas either way.

### Over-decompose plus a work queue

Per-tile cost is very non-uniform: open-water pixels take a provably-safe
early-out and skip 19 land-tile noise evaluations, while land pixels near ore
and cliffs run the full resolver stack. The target machine is 8 performance
cores plus 4 efficiency cores, and the E-cores run appreciably slower.

Splitting into exactly N blocks for N workers makes wall-clock equal to the
slowest block, so one E-core holding a land-heavy block sets the floor.
Over-decomposing into ~64 tiles of 128x128 and having ~11 workers pull the next
tile as they free up absorbs both the cost skew and the core skew. Tile size is
a parameter, tunable after measurement.

Square tiles rather than horizontal strips: a full-width strip touches the same
wide swath of ore regions as an entire row, which maximizes the duplicated
region-selection work discussed next.

### Transferable buffers, not SharedArrayBuffer

Each worker posts back its own tile buffer, transferred zero-copy; the main
thread does `putImageData(tile, dx, dy)`. Sixty-four transfers of 64KB is
microseconds against ~12s of compute.

SharedArrayBuffer would require adding `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp` to `public/_headers`, which in
turn requires the deployed preview-service Worker response to carry CORP/CORS
headers or that fetch breaks. Real deploy risk, no measurable gain.

### The cliff halo, clamped to the image box

`makeCliffPlacement().placedCells(x0, y0, x1, y1)` enumerates the game's 4-tile
placement grid and keeps cells whose *center* satisfies `x >= x0 && x < x1`
(same in y). `renderCliffs` then paints a `(2r+1)x(2r+1)` block around each
cell's pixel, `r = CLIFF_MARK_RADIUS_PX`.

So a cell centered just outside a tile still owes paint inside it. Each tile
must query cells over the expanded box:

```
cellQueryBox = expand(tileBox, CLIFF_MARK_RADIUS_PX * tilesPerPixel) INTERSECT fullImageBox
```

The intersection with the full-image box is what preserves byte-identity: the
untiled render drops cells centered outside the 1024x1024 image, so their blocks
never bleed in, and the tiled render must drop exactly the same ones. Interior
seams get filled, the outer border keeps today's behavior.

The paint loop already clips `px`/`py` to the tile's pixel range and re-checks
water per painted pixel, so an expanded query needs no other change.

If the border bleed is later judged a bug, fixing it is a separate change with
its own oracle check. A performance refactor must not quietly change pixels.

### Setup duplication: measure, then split

`runRenderRequest` builds its resolvers from scratch on every call:
`makeResourceResolver` (which memoizes selected spot lists per world region -
roughly 4 to 9 regions across 6 ore types for a 1024-tile view), plus
`makeCliffPlacement`, `makeTileCatalog`, and the basis-noise seed tables.

Today that setup runs once per render. Naive tiling makes it run once per
*tile* - 64 times. Region selection (candidate generation, dart-throw selection,
quantity batches) is not obviously cheap, so this could eat much of the win on
the resources layer.

**Phase A - measure.** Time `runRenderRequest` on one 128x128 tile, multiply by
64, and compare against the full 1024x1024 render. Ratio near 1.0 means setup is
noise and plain tiling ships. Past roughly 1.15, phase B pays for itself.

**Phase B - split scene from geometry, if warranted.**

```ts
makeScene(sceneParams) -> { renderTile(box): ImageData }
```

`sceneParams` is everything non-geometric (seed, view, controls, ctx); `box` is
origin, size and tiles-per-pixel. Each worker holds `{ key, scene }` in module
scope, where `key` is a stable serialization of `sceneParams`; a tile whose key
matches reuses the scene. Setup then runs at most once per worker per
settings-change - capped at pool size, not tile count, regardless of how finely
the image is decomposed.

`runRenderRequest(req)` becomes `makeScene(sceneOf(req)).renderTile(boxOf(req))`,
so it remains a valid single-shot entry point and every existing test keeps
passing unchanged.

Rejected alternative: precomputing region spot lists on the main thread and
serializing them into each tile request. That trades a clean refactor for a
bespoke wire format plus a main-thread stall before any worker starts.

## Architecture

Three pieces, each testable in isolation.

### `src/noise/preview/tiling.ts` - pure geometry

```ts
interface ImageBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
  tilesPerPixel: number;
}

interface TileBox extends ImageBox {
  dx: number; // pixel offset of this tile within the full image
  dy: number;
}

planTiles(full: ImageBox, tileSize: number): TileBox[];
```

Covers the image exactly, no overlap, handles a ragged trailing row and column
when the size is not divisible. No dependency on the renderer or on Workers.

### `elevationRenderRequest.ts` - one new optional field

`ElevationRenderRequest` gains:

```ts
fullImage?: { originX: number; originY: number; width: number; height: number };
```

Used for exactly one thing: computing the cliff cell-query box. When absent it
defaults to the tile's own box, which is today's behavior - so every existing
call site and test is unchanged.

`RenderCliffsOptions` correspondingly gains an optional `cellQueryBox` in world
coordinates, defaulting to the pixel box.

### `src/components/renderPool.ts` - the pool

```ts
createRenderPool({ size, execute }): {
  render(req, onTile): Promise<void>;
  dispose(): void;
}
```

`execute: (req: ElevationRenderRequest) => Promise<ElevationRenderResult>` is
the injectable seam. In the app it posts to a real `Worker`; in tests it calls
`runRenderRequest` in-process. That seam is what makes the byte-identity gate
runnable in Node without browser Workers.

The pool plans tiles, keeps at most `size` in flight, refills each slot as a
tile returns, calls `onTile(result, dx, dy)` per tile, and resolves when the
last one lands.

Pool size: `max(1, (navigator.hardwareConcurrency ?? 4) - 1)`. Workers are
created once on first render and reused for the panel's lifetime.

### Wiring

`useElevationPreview.ts` keeps its `ElevationRenderer` shape - so the panel's
existing fake-renderer tests keep working - but is backed by the pool and gains
an `onTile` callback.

`ElevationPreviewPanel.vue` sizes and clears the canvas up front, then blits
each tile as it arrives, and stamps `elapsedMs` when the render resolves.

## Data flow

1. Panel sizes the canvas to 1024x1024 and clears it, bumps a generation
   counter, calls `pool.render(req, onTile)`.
2. Pool calls `planTiles` (64 tiles at 128px), fills its ~11 in-flight slots.
3. Each worker runs its tile and transfers the buffer back.
4. Pool refills the freed slot from the queue and invokes `onTile`.
5. Panel wraps the buffer in `ImageData` and blits at `(dx, dy)`.
6. Queue drains, all slots idle, promise resolves, panel stamps `elapsedMs`.

### Staleness

Every tile request carries its generation. A new `render()` bumps the
generation, drops all queued tiles of the old one, and discards results arriving
from it. In-flight tiles run to completion and are thrown away - a worker
restart costs more than the ~150ms of wasted tile. This is already an
improvement on today, where a superseded render burns ~12s of a core.

### Errors

Any tile rejecting fails the whole render; the panel shows its existing
"Preview failed." message and the pool stops dispatching that generation. A
worker `onerror` rejects its in-flight tile, and that worker is replaced.

## Testing

### The correctness gate

Build a pool whose `execute` calls `runRenderRequest` directly, render a region
tiled, and assert the stitched buffer equals the single untiled
`runRenderRequest` for the same region - byte for byte, no tolerance.

- Every view: `elevation`, `terrain`, `resources`, `enemies`, `cliffs`, `all`.
- A divisible case (96x96 image, 32x32 tiles) and a ragged one (100x100 image,
  32x32 tiles).
- One adversarial case: a seed and region chosen because cliff cells sit within
  `CLIFF_MARK_RADIUS_PX` of a seam. **This case must be shown to fail before the
  halo is implemented** - a gate that cannot fail proves nothing.

### Unit tests

- `planTiles`: exact cover, no overlap, ragged edges, tile larger than image.
- `renderPool` (fake `execute`, no real Workers): never exceeds `size` in
  flight, drains the queue, fires `onTile` once per tile, resolves after the
  last, generation supersede drops stale results, a rejecting tile fails the
  render.
- Panel (fake renderer emitting tiles out of order): one `putImageData` per tile
  at the correct offset, `elapsedMs` stamped once at the end.

### Performance

Node cannot measure the real speedup - no browser Workers, and the in-process
pool is serial. Numbers come from the browser: load the app, dev mode on,
Generate, read the elapsed-ms readout, the same method that produced the ~12.5s
composite baseline.

Target: roughly 4-6x on the composite view, about 2-3s.

`pnpm perf` stays as-is - it is the per-layer single-thread cost table and
tiling should not move it. Phase A adds one small bench there for the
tile-overhead ratio.

A final full-size visual check in the browser (tiled output against the
pre-change image) catches anything structural that the small byte-identity
region misses.

## Out of scope

- Changing the cliff border behavior (see "The cliff halo").
- Pan/zoom of the preview viewport. Phase B's scene cache would make it cheap,
  but nothing here implements it.
- Any change to oracle fidelity. Tiling must not move a single pixel; the
  existing oracle validation continues to cover correctness of the fields
  themselves.

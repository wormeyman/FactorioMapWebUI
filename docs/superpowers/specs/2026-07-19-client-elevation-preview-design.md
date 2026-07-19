# Client-side elevation_lakes preview in the app UI - design

Date: 2026-07-19
Status: approved design, ready for planning
Roadmap: `docs/noise/client-preview-ROADMAP.md` (this is the first slice of
Milestone 5 - integration: wire the ported tree into the UI + move the sweep off
the main thread).

## Goal

Surface the already-ported, already-tested `elevation_lakes` renderer
(`src/noise/preview/renderElevation.ts`) in the app as a live, offline preview.
A new **Preview** tab renders the active preset's map to a `<canvas>` entirely in
the browser - no headless preview-service container - with the heavy per-pixel
sweep running in a **Web Worker** so the editor never freezes.

This is purely additive UI + a worker seam over existing pure code. It does not
touch the codec, the store's persistence, or the ported noise tree.

## Non-goals (deferred)

- **Any map type other than Lakes.** `renderElevation` only implements the
  `elevation_lakes` tree. Nauvis (default) and Island are shown as "client
  preview not available for this map type yet" (see "Map-type gate"). The
  server-side `PreviewPanel.vue` already covers all types and is untouched.
- **Auto re-render on edits.** MVP is an explicit **Generate** button (mirrors
  `PreviewPanel.vue`). Debounced/live re-render is a follow-up that the worker
  seam is built to enable.
- **Pan / zoom / recenter controls.** MVP is one fixed framing centered on
  spawn. The render entry point already takes `originX/originY/tilesPerPixel`, so
  adding controls later is trivial.
- **Seed reroll control.** MVP resolves and displays the seed (sticky random for
  a null-seed preset) but shows no reroll button.
- **Richer visuals** (elevation shading, coastline, deep/shallow water). MVP
  keeps the existing binary `elevation < 0 => water` mask and the existing
  `WATER_RGBA` / `LAND_RGBA` palette.
- **Viewport tiling and per-region caching.** See "Performance" - measure first.

## Decisions locked in brainstorming

| Question | Decision |
| --- | --- |
| Relationship to server `PreviewPanel` | Separate client preview; server path untouched |
| Location in the app | New **Preview** tab alongside Resources/Terrain/Enemy/Advanced |
| Unsupported map types | Render only when Lakes; else a clear message |
| Update trigger | Explicit **Generate** button (no auto re-render) |
| View | Fixed spawn framing, no pan/zoom controls |
| Off-main-thread | Yes - Web Worker (this was the change that reshaped the design) |

## Architecture

Bottom-up layers. Each has one job, a narrow interface, and (except the trivial
worker adapter) unit tests with no DOM and no Worker.

```
Preset ──elevationCtxFromPreset──▶ { supported, mapTypeLabel, ctx }   (model, pure)
                                          │
ElevationPreviewPanel.vue  ──builds──▶ ElevationRenderRequest
   │  (resolve seed, fixed view)          │
   │                                      ▼
   └── useElevationPreview() ──postMessage──▶ elevationRender.worker.ts
        (owns Worker, request-id                    │  onmessage
         staleness, dispose)                         ▼
                                          runRenderRequest(req)   (pure)
                                                     │  calls renderElevation
                                                     ▼
                                          { buffer, width, height }
        ◀──postMessage(result, [buffer])── (transferable, zero-copy)
        │
   putImageData onto <canvas>
```

### `src/model/elevationPreviewCtx.ts` (NEW, pure, unit-tested)

The one place that maps a `Preset` to what the renderer needs. Keeps the
`noise/preview` layer preset-agnostic and puts model knowledge next to the
existing `mapType.ts` / `climateControls.ts`.

```ts
export interface ElevationPreviewCtx {
  /** false => the active map type is not renderable client-side (Nauvis/Island/unknown). */
  supported: boolean;
  /** The resolved map-type label, for the "not available for <label>" message. */
  mapTypeLabel: string;
  /** Non-seed tree params; shape = Omit<ElevationLakesParams, "seed0">. */
  ctx: {
    waterLevel: number;
    segmentationMultiplier: number;
    startingPositions: Point[];
    // startingLakePositions intentionally omitted => the worker computes the
    // game's real positions from (seed0, startingPositions).
  };
}

export function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx;
```

Derivations (all verified against `EvalCtx` docs in `src/noise/eval/ctx.ts`):

- **supported / mapTypeLabel:** `readMapType(preset.propertyExpressionNames)`;
  `supported = (mapType.writeValue === "elevation_lakes")`.
- **waterLevel = `10 * log2(size)`** where `size = autoplaceControls.water?.size`.
  When `water` is absent from the dict, `size` defaults to `1` => `waterLevel = 0`.
  **Guard:** if `size` is not `> 0` (a disabled/zero control), fall back to `1`
  (`waterLevel = 0`) rather than emit `-Infinity`.
- **segmentationMultiplier = `autoplaceControls.water?.frequency ?? 1`.**
- **startingPositions:** `preset.startingPoints.map(p => ({ x: p.x, y: p.y }))`,
  or `[{ x: 0, y: 0 }]` when empty (the game default spawn).

Note the happy coincidence: an unedited preset (no `water` control, default
spawn) yields exactly the renderer's existing `DEFAULT_CTX_FIELDS`
(`waterLevel 0`, `seg 1`, spawn at origin), so the default preset renders
identically to the current fixtures.

### `src/noise/preview/renderElevation.ts` (UNCHANGED)

Pure grid sweep -> `ImageData`. Already tested (`test/renderElevation.spec.ts`).
The worker consumes it as-is.

### `src/noise/preview/elevationRenderRequest.ts` (NEW, pure, unit-tested)

Owns the message contract **and** all real worker logic, as plain functions so
they test with no Worker.

```ts
export interface ElevationRenderRequest {
  id: number;                    // staleness tag, echoed in the result
  seed0: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  tilesPerPixel: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  startingLakePositions?: Point[];
}

export interface ElevationRenderResult {
  id: number;
  buffer: ArrayBuffer;           // RGBA bytes, length width*height*4
  width: number;
  height: number;
}

/** Pure: calls renderElevation and hands back the transferable pixel buffer. */
export function runRenderRequest(req: ElevationRenderRequest): ElevationRenderResult {
  const image = renderElevation({
    seed0: req.seed0,
    width: req.width,
    height: req.height,
    originX: req.originX,
    originY: req.originY,
    tilesPerPixel: req.tilesPerPixel,
    ctx: {
      waterLevel: req.waterLevel,
      segmentationMultiplier: req.segmentationMultiplier,
      startingPositions: req.startingPositions,
      startingLakePositions: req.startingLakePositions,
    },
  });
  return { id: req.id, buffer: image.data.buffer, width: req.width, height: req.height };
}
```

`ImageData` is available both in Vitest's DOM env (the existing
`renderElevation.spec.ts` proves it) and in `DedicatedWorkerGlobalScope`, so
`runRenderRequest` runs unchanged in tests and in the worker.

### `src/noise/preview/elevationRender.worker.ts` (NEW, thin adapter, not unit-tested)

```ts
self.onmessage = (e: MessageEvent<ElevationRenderRequest>) => {
  const result = runRenderRequest(e.data);
  (self as unknown as Worker).postMessage(result, [result.buffer]);
};
```

Loaded from the app via Vite's worker URL form:
`new Worker(new URL("../noise/preview/elevationRender.worker.ts", import.meta.url), { type: "module" })`.
Never executed under Vitest.

### `src/components/useElevationPreview.ts` (NEW composable)

Owns the single long-lived `Worker`, assigns an incrementing `id` per request,
resolves the promise only for the matching `id` (stale renders are dropped), and
terminates the worker on `dispose()`.

```ts
export interface ElevationRenderer {
  render(req: Omit<ElevationRenderRequest, "id">): Promise<ElevationRenderResult>;
  dispose(): void;
}
export function useElevationPreview(): ElevationRenderer;
```

### `src/components/ElevationPreviewPanel.vue` (NEW)

Orchestration + paint. Mirrors `PreviewPanel.vue`'s toolbar/stage/loading/seed
conventions and Factorio styling (`f-bevel-in`, `image-rendering: pixelated`).

- Reads `store.activePreset`; computes `elevationCtxFromPreset(preset)`.
- **Map-type gate:** if `!supported`, the stage shows
  "Client preview is not available for <mapTypeLabel> yet." and Generate is
  disabled - no render is dispatched.
- **Seed:** `preset.seed ?? stickyRolledSeed` (rolled once via `randomU32()`,
  the exact `PreviewPanel` pattern), displayed as a read-only label.
- **Generate:** builds the fixed-view request, sets `loading`, awaits
  `renderer.render(req)`, then paints: `new ImageData(new Uint8ClampedArray(buffer),
  w, h)` -> `canvasCtx.putImageData(...)`. Errors set an error message.
- **Testability seam:** an optional prop `renderer?: ElevationRenderer`,
  resolved once in setup as `props.renderer ?? useElevationPreview()`. In the app
  the prop is omitted, so the panel builds the real worker-backed renderer when
  the tab first mounts (the worker idles until the first `postMessage`). Tests
  always pass a fake `renderer`, so the `??` short-circuits and no Worker is ever
  constructed under Vitest. The fake returns a known buffer; the panel test
  asserts the canvas paint and the map-type gate, exactly as
  `previewPanel.spec.ts` stubs `fetch`.
- Disposes the renderer on `onBeforeUnmount` (only when the panel owns it, i.e.
  the real worker-backed path; an injected renderer is owned by the caller).

### `src/App.vue` (MODIFIED)

Add `"Preview"` to the `TABS` list and a
`v-else-if="activeTab === 'Preview'"` branch rendering `<ElevationPreviewPanel />`.

## Fixed spawn view

A single tunable constant block in the panel:

- `PREVIEW_PX = 512` (canvas is `PREVIEW_PX x PREVIEW_PX`).
- `TILES_PER_PIXEL = 4` => a `2048 x 2048` tile window (the starting-lake
  `sld` cap is 1024, so lakes sit comfortably inside).
- Centered on the primary starting position `s0` (first `startingPositions`
  entry, default origin): `originX = s0.x - PREVIEW_PX * TILES_PER_PIXEL / 2`
  (= `-1024` at origin), same for `originY`.

These are constants, not UI. "Zoom + recenter controls" (a deferred option) would
later drive the same three render inputs.

## Performance

The worker keeps the main thread free, so a slow render degrades to "spinner for
a few seconds," never a frozen tab. But cost is real: `512x512 = 262 144` pixels,
each a full `elevation_lakes` evaluation (two variable-persistence octave stacks,
an amplitude-corrected stack, a quick-multioctave stack, a basis call, and two
distance lookups).

**Plan:** the implementation includes a task to **measure** one render at the
default size. If it exceeds ~2-3 s, dial `PREVIEW_PX` down (e.g. 384) or coarsen
`TILES_PER_PIXEL` before shipping. Viewport tiling / per-region spot caching
(roadmap M5) stays deferred - it is not needed to ship a usable Lakes preview.
Because the sizes are named constants, tuning is a one-line change.

## Error and edge handling

- **Unsupported map type:** handled before dispatch (gate above); no worker call.
- **`water.size <= 0`:** guarded in `elevationCtxFromPreset` (falls back to 1).
- **Stale results:** dropped by request-`id` mismatch in the composable, so a
  second Generate never paints the first render's late result.
- **Worker error / crash:** the composable's `worker.onerror` rejects every
  in-flight `render()` promise (otherwise a crash would leave it pending
  forever); the panel's `catch` shows a generic "Preview failed." message (same
  shape as `PreviewPanel`).
- **No active preset:** Generate is disabled (same guard as `PreviewPanel`).

## Testing plan (TDD)

Pure logic first, DOM/worker last, no real Worker ever under Vitest.

1. `test/elevationPreviewCtx.spec.ts` - `elevationCtxFromPreset`:
   - Lakes preset => `supported: true`, correct label.
   - Nauvis / Island / unknown => `supported: false`, correct label.
   - `water = { size: 4, frequency: 0.5 }` => `waterLevel = 10*log2(4) = 20`,
     `segmentationMultiplier = 0.5`.
   - `water` absent => `waterLevel 0`, `seg 1` (== `DEFAULT_CTX_FIELDS`).
   - `water.size = 0` (disabled) => `waterLevel 0` (guard), not `-Infinity`.
   - `startingPoints` present => mapped; empty => `[{0,0}]`.
2. `test/elevationRenderRequest.spec.ts` - `runRenderRequest`:
   - Returns a buffer of length `width*height*4`, echoes `id`, `width`, `height`.
   - Same `(seed0, view, ctx)` as a direct `renderElevation` call produces byte-
     identical pixels (parity with the existing renderer).
3. `test/useElevationPreview.spec.ts` - `createElevationRenderer` with a fake
   `WorkerLike` (no real Worker):
   - Posts a request with an incrementing `id`; resolves on the matching response.
   - Ignores a response whose `id` has no pending request (stale drop, no throw).
   - `dispose()` terminates the worker.
   - `worker.onerror` rejects an in-flight `render()` promise.
4. `test/elevationPreviewPanel.spec.ts` - mount with a fake `renderer`:
   - Lakes preset + click Generate => `renderer.render` called with the fixed
     view; canvas `putImageData` invoked (spy).
   - Nauvis preset => gate message shown, `render` never called, Generate
     disabled.
   - Rejecting fake `renderer` => error message shown.
5. Existing `renderElevation.spec.ts` and the full suite stay green.

The `.worker.ts` adapter and the *live* `Worker` construction are the only
untested surface (the composable's request/staleness/error logic is tested via
the injected fake); no attempt is made to run a real Worker in the test env.

## Files touched

New:
- `src/model/elevationPreviewCtx.ts`
- `src/noise/preview/elevationRenderRequest.ts`
- `src/noise/preview/elevationRender.worker.ts`
- `src/components/useElevationPreview.ts`
- `src/components/ElevationPreviewPanel.vue`
- `test/elevationPreviewCtx.spec.ts`
- `test/elevationRenderRequest.spec.ts`
- `test/useElevationPreview.spec.ts`
- `test/elevationPreviewPanel.spec.ts`

Modified:
- `src/App.vue` (add the Preview tab)
- `test/app.spec.ts` (assert the Preview tab label renders)

Unchanged (consumed as-is): `src/noise/preview/renderElevation.ts`,
`src/model/mapType.ts`, `src/util/seed.ts`, the codec, the store.

## Open questions / caveats

- **Render time is unmeasured.** The default size is a starting guess; the
  measure-and-tune task (Performance) resolves it before ship.
- **Near-spawn fidelity depends on the preset's starting points.** Default
  presets spawn at origin, matching the fixtures; a preset with custom
  `startingPoints` will shift both the framing and the computed lake positions
  (correct behavior, just untested against the game here).
- **Vite worker build.** The `new URL(..., import.meta.url)` + `{ type: "module" }`
  form is Vite-native and needs no config; confirm it survives `pnpm vp build`
  in the render-smoke/manual check.

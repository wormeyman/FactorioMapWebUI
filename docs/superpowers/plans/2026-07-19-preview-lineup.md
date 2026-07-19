# Line up client vs server previews - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client elevation preview (Preview tab) cover the same world extent (1024 tiles, centered on origin) and display at the same on-screen size as the server `--generate-map-preview` side panel, so they line up for a direct Nauvis-coastline comparison.

**Architecture:** Client-only. Two changes: (1) point the client render window at the measured server extent - 1024 tiles across, 1 tile/pixel, centered on world (0,0), rendered at 1024px; (2) give both panels' displayed media a shared square display size so they are the same size on screen. No server/preview-service change.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest-compatible `vite-plus/test`, global `src/ui/factorio.css`. Run everything through `pnpm vp ...`.

## Global Constraints

- The server preview is **1 tile per pixel at size 1024** = 1024 tiles across, centered on origin (measured 2026-07-19 from Factorio's log; see the design spec). Client target: `PREVIEW_PX = 1024`, `TILES_PER_PIXEL = 1`, `originX = originY = -512` (i.e. `-(PREVIEW_PX*TILES_PER_PIXEL)/2`, independent of the preset spawn).
- Recenter only the **view window** on origin; the elevation tree still receives the real `startingPositions` (its `distance`-gated terms need them) - keep passing `info.ctx.startingPositions` unchanged.
- The window change applies to the client panel for **both** map types (Nauvis and Lakes) - the panel does not branch on `mapType`, and this is intended: the server renders whichever elevation the preset selects, so aligning the window lets both client-Nauvis-vs-server-Nauvis and client-Lakes-vs-server-Lakes line up. It does mean the Lakes preview moves from its old 2048-tile, spawn-centered view to the same 1024-tile, origin-centered one. Do NOT add a per-map-type branch.
- Run tests: `pnpm vp test` (full) / `pnpm vp test test/<file>.spec.ts` (single). Lint/format: `pnpm vp check --fix` (the only lint step; no vue-tsc gate - `.vue` files are never type-checked, watch `.ts` diagnostics yourself). Node 24.18.0. Always `pnpm vp ...` (bare/`npx` vp fails EBADDEVENGINES).
- Extensionless `src/**` imports; tests import from `"vite-plus/test"`.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` then
  `Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK`
  Hyphens, never em/en dashes. Commit locally only; do not push.

---

### Task 1: Match the client render window to the server extent (1024 tiles, origin-centered, 1024px)

**Files:**
- Modify: `src/components/ElevationPreviewPanel.vue` (constants + `generate()` window)
- Test: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**
- Consumes: the existing `renderer.render({...})` request shape (`seed0, mapType, width, height, originX, originY, tilesPerPixel, waterLevel, segmentationMultiplier, startingPositions`) from `src/noise/preview/elevationRenderRequest.ts`.
- Produces: no new exports; the panel now posts `width=height=1024, tilesPerPixel=1, originX=originY=-512`.

- [ ] **Step 1: Update the panel spec assertions (RED)**

In `test/elevationPreviewPanel.spec.ts`, change the Lakes test's `toMatchObject` (currently lines ~49-57) to the new window:

```ts
    expect(arg).toMatchObject({
      seed0: 123456,
      mapType: "lakes",
      width: 1024,
      height: 1024,
      tilesPerPixel: 1,
      originX: -512,
      originY: -512,
    });
```

And add a test proving the view is centered on origin regardless of the preset spawn (insert after the Nauvis-render test, ~line 72). `generate()` reads the `preview` computed synchronously at click time, and the mutation below happens before the click, so no `nextTick` is needed:

```ts
  it("centers the view on world origin (0,0), not the preset spawn point", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    const store = usePresetsStore();
    store.activePreset!.startingPoints = [{ x: 300, y: -400 }];
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // window recentred on origin ...
    expect(arg).toMatchObject({ originX: -512, originY: -512, width: 1024, height: 1024, tilesPerPixel: 1 });
    // ... but the tree still gets the real spawn for its distance-gated terms
    expect(arg.startingPositions).toEqual([{ x: 300, y: -400 }]);
  });
```

Also (faithfulness, optional but tidy): update the `okRenderer` fake's returned dims to match the new 1024px render - `buffer: new ArrayBuffer(1024 * 1024 * 4), width: 1024, height: 1024`. The assertions don't depend on it (the fake ignores request dims), but it keeps the mock honest.

- [ ] **Step 2: Run the panel spec to verify it fails**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL - Lakes test sees `width:512, originX:-1024, ...`; the new origin test sees `originX: 300 - (512*4)/2 = -724` (still spawn-relative under the old constants) - both mismatch the expected `1024`/`-512`.

- [ ] **Step 3: Update the panel constants and window (GREEN)**

In `src/components/ElevationPreviewPanel.vue`, replace the constants block (lines ~10-13):

```ts
// Fixed view matched to the server --generate-map-preview: 1024 tiles across at
// 1 tile/pixel (the game renders size-1024 previews at 1 meter/pixel), rendered at
// 1024px and centered on world origin (0,0) so the two previews overlay. See
// docs/superpowers/specs/2026-07-19-preview-lineup-design.md.
const PREVIEW_PX = 1024;
const TILES_PER_PIXEL = 1;
```

In `generate()`, remove the spawn-based centering. Delete the `const s0 = ...` line (~line 42) and change the window origin so it is centered on (0,0):

```ts
  const half = (PREVIEW_PX * TILES_PER_PIXEL) / 2; // 512

  loading.value = true;
  error.value = null;
  try {
    const result = await renderer.render({
      seed0,
      mapType: info.mapType,
      width: PREVIEW_PX,
      height: PREVIEW_PX,
      originX: -half,
      originY: -half,
      tilesPerPixel: TILES_PER_PIXEL,
      waterLevel: info.ctx.waterLevel,
      segmentationMultiplier: info.ctx.segmentationMultiplier,
      startingPositions: info.ctx.startingPositions,
    });
```

(Leave the rest of `generate()` - the `putImageData` block, `startingPositions` passthrough - unchanged.)

- [ ] **Step 4: Run the panel spec to verify it passes**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS (all, including the new origin-centering test).

- [ ] **Step 5: Full suite, lint, commit**

Run: `pnpm vp test` (expect the full suite green) then `pnpm vp check --fix`.

```bash
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): match client preview window to the server extent

Render the client elevation preview over the same world window as the server
--generate-map-preview: 1024 tiles across at 1 tile/pixel (measured), at 1024px,
centered on world origin (0,0) instead of the preset spawn. The elevation tree
still receives the real starting positions; only the view window is recentred.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

### Task 2: Give both previews a shared on-screen display size

The two preview stages sit in equal-width grid columns, but the editor column also carries the tab bar, so a square image constrained by `max-height:100%` can render at slightly different sizes. Drive both media by width, capped at a shared square, so they match on screen. Define it once in the global stylesheet so the two panels cannot drift apart.

**Files:**
- Modify: `src/ui/factorio.css` (shared class + custom property)
- Modify: `src/components/ElevationPreviewPanel.vue` (apply the class; drop redundant scoped sizing)
- Modify: `src/components/PreviewPanel.vue` (apply the class; drop redundant scoped sizing)

**Interfaces:**
- Produces: a global `.f-preview-media` class and `--f-preview-media-max` custom property; both preview media elements use them.

- [ ] **Step 1: Add the shared class to `src/ui/factorio.css`**

Add the custom property to the existing `:root` block (next to the other `--f-*` values):

```css
  --f-preview-media-max: 512px;
```

And add the shared class (anywhere after `:root`, near the other `.f-*` classes):

```css
/* Shared sizing for the two map previews (client canvas + server image) so they
   render at the same on-screen size. Width-driven and square: the two panels live
   in equal-width columns (App.vue's 1fr/1fr grid), so capping width to one shared
   value makes them match. Deliberately NO max-height: the editor column also has a
   tab bar, so its stage is shorter than the side panel's, and a height cap would
   clamp the two media by different amounts and reintroduce the size drift this
   class exists to remove. (Trade-off: a very short viewport can let the square
   overflow its stage - acceptable versus unequal sizes.) */
.f-preview-media {
  width: 100%;
  aspect-ratio: 1 / 1;
  max-width: var(--f-preview-media-max);
  image-rendering: pixelated;
}
```

- [ ] **Step 2: Apply it to the client canvas**

In `src/components/ElevationPreviewPanel.vue`, add the class to the canvas element (keep the existing `preview-canvas` class and `data-test`):

```html
      <canvas
        v-show="supported && hasRendered && !error"
        ref="canvas"
        data-test="preview-canvas"
        class="preview-canvas f-preview-media"
      />
```

Then remove the now-redundant sizing from the scoped `.preview-canvas` rule so it does not conflict with the shared class (the shared class owns width/max-width/max-height/image-rendering). The scoped rule can be deleted entirely if nothing else remains in it:

```css
/* delete the scoped .preview-canvas { max-width:100%; max-height:100%; image-rendering: pixelated; } block */
```

- [ ] **Step 3: Apply it to the server image**

In `src/components/PreviewPanel.vue`, add the class to the `<img>` (keep `preview-image` and any existing attributes/`data-test`):

```html
      <img
        ...existing attributes...
        class="preview-image f-preview-media"
      />
```

Then delete the scoped `.preview-image { max-width:100%; max-height:100%; image-rendering: pixelated; }` block for the same reason.

- [ ] **Step 4: Verify the suite still passes and lint**

Run: `pnpm vp test` (CSS changes touch no assertions; expect the full suite green - this confirms nothing broke).
Run: `pnpm vp check --fix`.

- [ ] **Step 5: Visual confirmation in the app**

Run: `pnpm vp dev`, open the app, go to the Preview tab, set the side-panel planet to **Nauvis**, and click Generate on the client preview. Confirm the two previews are the same on-screen size and show the same region (edge lakes and the central starting lake in the same places). If the shared size needs tuning, adjust `--f-preview-media-max` only. (This step is manual; no automated assertion.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/factorio.css src/components/ElevationPreviewPanel.vue src/components/PreviewPanel.vue
git commit -m "$(cat <<'EOF'
feat(preview): shared on-screen size for the two map previews

Add a global .f-preview-media class (width-driven square, capped at
--f-preview-media-max) used by both the client canvas and the server preview
image, so the two panels render at the same on-screen size and stay in sync.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TEodZEvyN4eb33BNPihSEK
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Match world extent (1024 tiles, 1 tile/px, 1024px) -> Task 1 constants. ✓
- Center on origin (0,0), tree still gets real spawn -> Task 1 window + `startingPositions` passthrough + the origin-centering test. ✓
- Shared on-screen display size -> Task 2 (`.f-preview-media` on both media). ✓
- Client-only, server render untouched -> only `ElevationPreviewPanel.vue` behavior changes; `PreviewPanel.vue` gets a CSS class only. ✓
- 1024px resolution decision (~7s off-thread) -> Task 1 `PREVIEW_PX = 1024`. ✓

**Placeholder scan:** none - every step has concrete code/commands; the one manual step (visual confirmation) is explicitly manual with what to look for. ✓

**Type/naming consistency:** `PREVIEW_PX`/`TILES_PER_PIXEL`/`half` used consistently in Task 1; `.f-preview-media` / `--f-preview-media-max` consistent across factorio.css and both components in Task 2. Request field names match `ElevationRenderRequest`. ✓

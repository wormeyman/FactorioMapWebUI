# Client-side elevation_lakes Preview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Preview** tab that renders the active preset's `elevation_lakes` map to a canvas entirely in the browser, with the heavy per-pixel sweep on a Web Worker so the editor never freezes.

**Architecture:** A pure model helper (`elevationCtxFromPreset`) turns the active `Preset` into the renderer's free variables. A pure request runner (`runRenderRequest`) wraps the existing `renderElevation` and returns a transferable pixel buffer. A thin `.worker.ts` adapter runs that runner off-thread. A composable owns the `Worker` and drops stale results by request id. A `.vue` panel resolves the seed, fixes the spawn-centered view, dispatches a render, and paints the result. All real logic lives in the two pure modules; the worker and the live-`Worker` path are never executed under Vitest.

**Tech Stack:** TypeScript, Vue 3.5 `<script setup>`, Pinia, Vite worker (`new URL(..., import.meta.url)`), Vite-plus test runner (`vite-plus/test`), `@vue/test-utils`, happy-dom.

## Global Constraints

- Run everything through pnpm: `pnpm vp test` (full suite), `pnpm vp test test/<file>.spec.ts` (single), `pnpm vp check --fix` (lint + format, the ONLY lint step). Node 24.18.0. A bare/`npx` `vp` fails with `EBADDEVENGINES`.
- Tests import `describe`/`it`/`expect`/`vi` from `"vite-plus/test"`; `mount`/`flushPromises` from `"@vue/test-utils"`.
- `src/**` relative imports are **extensionless** (match neighbors like `src/model/mapType.ts`, `src/noise/preview/renderElevation.ts`).
- Test environment is **happy-dom**. It provides `ImageData` but `HTMLCanvasElement.getContext("2d")` returns `null` - canvas paint tests MUST stub `getContext`.
- Work stays on branch `feat/client-elevation-preview` (already checked out). Commit locally per task; do NOT push (main is auto-mode).
- Commit-message footer (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv
  ```
- Writing style: hyphens, not em/en dashes.
- Reuse, do not re-derive: `renderElevation` (`src/noise/preview/renderElevation.ts`), `readMapType` (`src/model/mapType.ts`), `randomU32` (`src/util/seed.ts`), `FButton` (`variant="confirm"`).

## File Structure

New:
- `src/model/elevationPreviewCtx.ts` - `Preset` -> renderer free variables (pure).
- `src/noise/preview/elevationRenderRequest.ts` - worker message types + `runRenderRequest` (pure).
- `src/noise/preview/elevationRender.worker.ts` - thin `onmessage` adapter (not unit-tested).
- `src/components/useElevationPreview.ts` - `createElevationRenderer` + `useElevationPreview` composable.
- `src/components/ElevationPreviewPanel.vue` - the tab UI.
- `test/elevationPreviewCtx.spec.ts`, `test/elevationRenderRequest.spec.ts`, `test/useElevationPreview.spec.ts`, `test/elevationPreviewPanel.spec.ts`.

Modified:
- `src/App.vue` - register the Preview tab.
- `test/app.spec.ts` - assert the Preview tab label appears.

Reference types (already defined, consumed as-is):
- `Preset` (`src/model/types.ts`): `.propertyExpressionNames: Record<string,string>`, `.autoplaceControls: Record<string, {frequency:number; size:number; richness:number}>`, `.startingPoints: {x:number;y:number}[]`, `.seed: number | null`.
- `Point` (`src/noise/distanceFromNearestPoint.ts`): `{ x: number; y: number }`.
- `renderElevation(opts)` (`src/noise/preview/renderElevation.ts`): `opts = { seed0, width, height, originX?, originY?, tilesPerPixel?, ctx?: { waterLevel?; segmentationMultiplier?; startingPositions?; startingLakePositions? } }` -> `ImageData`.

---

### Task 1: `elevationCtxFromPreset` (pure model helper)

**Files:**
- Create: `src/model/elevationPreviewCtx.ts`
- Test: `test/elevationPreviewCtx.spec.ts`

**Interfaces:**
- Consumes: `readMapType` from `./mapType`; `Preset` from `./types`; `Point` from `../noise/distanceFromNearestPoint`.
- Produces:
  - `interface ElevationPreviewCtx { supported: boolean; mapTypeLabel: string; ctx: { waterLevel: number; segmentationMultiplier: number; startingPositions: Point[] } }`
  - `function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx`

- [ ] **Step 1: Write the failing test**

```ts
// test/elevationPreviewCtx.spec.ts
import { describe, it, expect } from "vite-plus/test";
import { elevationCtxFromPreset } from "../src/model/elevationPreviewCtx";
import { getBuiltinPreset } from "../src/model/builtins";
import { writeMapType } from "../src/model/mapType";
import type { Preset } from "../src/model/types";

function lakesPreset(): Preset {
  const p = getBuiltinPreset("Default");
  writeMapType(p.propertyExpressionNames, "lakes");
  return p;
}

describe("elevationCtxFromPreset", () => {
  it("marks a Lakes preset supported with its label", () => {
    const r = elevationCtxFromPreset(lakesPreset());
    expect(r.supported).toBe(true);
    expect(r.mapTypeLabel).toBe("Lakes elevation");
  });

  it("marks the default (Nauvis) preset unsupported", () => {
    const r = elevationCtxFromPreset(getBuiltinPreset("Default"));
    expect(r.supported).toBe(false);
    expect(r.mapTypeLabel).toBe("Nauvis elevation");
  });

  it("derives waterLevel = 10*log2(size) and segmentation = frequency", () => {
    const p = lakesPreset();
    p.autoplaceControls.water = { frequency: 0.5, size: 4, richness: 1 };
    const r = elevationCtxFromPreset(p);
    expect(r.ctx.waterLevel).toBeCloseTo(20, 10); // 10*log2(4)
    expect(r.ctx.segmentationMultiplier).toBe(0.5);
  });

  it("falls back to renderer defaults when water is absent", () => {
    const p = lakesPreset();
    delete p.autoplaceControls.water;
    const r = elevationCtxFromPreset(p);
    expect(r.ctx.waterLevel).toBe(0); // 10*log2(1)
    expect(r.ctx.segmentationMultiplier).toBe(1);
  });

  it("guards a disabled (size 0) water control against -Infinity", () => {
    const p = lakesPreset();
    p.autoplaceControls.water = { frequency: 1, size: 0, richness: 1 };
    expect(elevationCtxFromPreset(p).ctx.waterLevel).toBe(0);
  });

  it("maps starting points, defaulting to a single origin spawn when empty", () => {
    const p = lakesPreset();
    p.startingPoints = [{ x: 12, y: -8 }];
    expect(elevationCtxFromPreset(p).ctx.startingPositions).toEqual([{ x: 12, y: -8 }]);
    p.startingPoints = [];
    expect(elevationCtxFromPreset(p).ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: FAIL (cannot resolve `../src/model/elevationPreviewCtx`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/model/elevationPreviewCtx.ts
import type { Point } from "../noise/distanceFromNearestPoint";
import { readMapType } from "./mapType";
import type { Preset } from "./types";

const LAKES_ELEVATION = "elevation_lakes";

export interface ElevationPreviewCtx {
  /** false => the active map type has no client renderer yet (Nauvis/Island/unknown). */
  supported: boolean;
  /** Resolved map-type label, for the "not available for <label>" message. */
  mapTypeLabel: string;
  /** Non-seed free variables for renderElevation (Omit<..., "seed0">-compatible). */
  ctx: {
    waterLevel: number;
    segmentationMultiplier: number;
    startingPositions: Point[];
  };
}

/**
 * Map the active preset onto the free variables the elevation_lakes renderer
 * needs. waterLevel = 10*log2(control:water:size), segmentation =
 * control:water:frequency; an absent water control collapses to the renderer's
 * own defaults (waterLevel 0, seg 1). A disabled control (size <= 0) is guarded
 * to size 1 rather than emitting -Infinity.
 */
export function elevationCtxFromPreset(preset: Preset): ElevationPreviewCtx {
  const mapType = readMapType(preset.propertyExpressionNames);
  const water = preset.autoplaceControls.water;
  const size = water && water.size > 0 ? water.size : 1;
  const startingPositions: Point[] =
    preset.startingPoints.length > 0
      ? preset.startingPoints.map((p) => ({ x: p.x, y: p.y }))
      : [{ x: 0, y: 0 }];

  return {
    supported: mapType.writeValue === LAKES_ELEVATION,
    mapTypeLabel: mapType.label,
    ctx: {
      waterLevel: 10 * Math.log2(size),
      segmentationMultiplier: water?.frequency ?? 1,
      startingPositions,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/model/elevationPreviewCtx.ts test/elevationPreviewCtx.spec.ts
git commit -m "feat(preview): elevationCtxFromPreset (preset -> renderer free vars)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

### Task 2: `runRenderRequest` + worker message types (pure)

**Files:**
- Create: `src/noise/preview/elevationRenderRequest.ts`
- Test: `test/elevationRenderRequest.spec.ts`

**Interfaces:**
- Consumes: `renderElevation` from `./renderElevation`; `Point` from `../distanceFromNearestPoint`.
- Produces:
  - `interface ElevationRenderRequest { id; seed0; width; height; originX; originY; tilesPerPixel; waterLevel; segmentationMultiplier; startingPositions: Point[]; startingLakePositions?: Point[] }` (all numbers except the point arrays)
  - `interface ElevationRenderResult { id: number; buffer: ArrayBuffer; width: number; height: number }`
  - `function runRenderRequest(req: ElevationRenderRequest): ElevationRenderResult`

- [ ] **Step 1: Write the failing test**

```ts
// test/elevationRenderRequest.spec.ts
import { describe, it, expect } from "vite-plus/test";
import { runRenderRequest, type ElevationRenderRequest } from "../src/noise/preview/elevationRenderRequest";
import { renderElevation } from "../src/noise/preview/renderElevation";

const REQ: ElevationRenderRequest = {
  id: 7,
  seed0: 123456,
  width: 8,
  height: 6,
  originX: -16,
  originY: -16,
  tilesPerPixel: 4,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
};

describe("runRenderRequest", () => {
  it("echoes id/width/height and returns an RGBA buffer of the right size", () => {
    const r = runRenderRequest(REQ);
    expect(r.id).toBe(7);
    expect(r.width).toBe(8);
    expect(r.height).toBe(6);
    expect(r.buffer.byteLength).toBe(8 * 6 * 4);
  });

  it("produces bytes identical to a direct renderElevation call", () => {
    const direct = renderElevation({
      seed0: REQ.seed0,
      width: REQ.width,
      height: REQ.height,
      originX: REQ.originX,
      originY: REQ.originY,
      tilesPerPixel: REQ.tilesPerPixel,
      ctx: {
        waterLevel: REQ.waterLevel,
        segmentationMultiplier: REQ.segmentationMultiplier,
        startingPositions: REQ.startingPositions,
      },
    });
    const got = new Uint8ClampedArray(runRenderRequest(REQ).buffer);
    expect(Array.from(got)).toEqual(Array.from(direct.data));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationRenderRequest.spec.ts`
Expected: FAIL (cannot resolve `elevationRenderRequest`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/noise/preview/elevationRenderRequest.ts
import type { Point } from "../distanceFromNearestPoint";
import { renderElevation } from "./renderElevation";

/** A render job posted to the worker. `id` tags the response for staleness. */
export interface ElevationRenderRequest {
  id: number;
  seed0: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  tilesPerPixel: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  /** Omitted => the game's real lake positions are computed inside the render. */
  startingLakePositions?: Point[];
}

/** The rendered pixels, with `buffer` posted back as a transferable. */
export interface ElevationRenderResult {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * Pure render step shared by the worker and its tests: run renderElevation and
 * hand back the transferable RGBA buffer. No Worker or DOM canvas involved.
 */
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationRenderRequest.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/noise/preview/elevationRenderRequest.ts test/elevationRenderRequest.spec.ts
git commit -m "feat(preview): runRenderRequest + worker message types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

### Task 3: worker adapter + `useElevationPreview` composable

**Files:**
- Create: `src/noise/preview/elevationRender.worker.ts`
- Create: `src/components/useElevationPreview.ts`
- Test: `test/useElevationPreview.spec.ts`

**Interfaces:**
- Consumes: `runRenderRequest`, `ElevationRenderRequest`, `ElevationRenderResult` from `../noise/preview/elevationRenderRequest`; `onBeforeUnmount` from `vue`.
- Produces:
  - `interface WorkerLike { postMessage(message: unknown, transfer?: Transferable[]): void; terminate(): void; onmessage: ((e: MessageEvent) => void) | null }`
  - `interface ElevationRenderer { render(req: Omit<ElevationRenderRequest, "id">): Promise<ElevationRenderResult>; dispose(): void }`
  - `function createElevationRenderer(createWorker?: () => WorkerLike): ElevationRenderer`
  - `function useElevationPreview(createWorker?: () => WorkerLike): ElevationRenderer`

The composable test drives `createElevationRenderer` with a fake `WorkerLike` (no real Worker, no component). The `.worker.ts` file is a trivial adapter and is not unit-tested.

- [ ] **Step 1: Write the failing test**

```ts
// test/useElevationPreview.spec.ts
import { describe, it, expect, vi } from "vite-plus/test";
import { createElevationRenderer, type WorkerLike } from "../src/components/useElevationPreview";

function fakeWorker(): WorkerLike & { posted: unknown[] } {
  return { posted: [], postMessage(m) { this.posted.push(m); }, terminate: vi.fn(), onmessage: null };
}

const REQ = {
  seed0: 1, width: 2, height: 2, originX: 0, originY: 0, tilesPerPixel: 1,
  waterLevel: 0, segmentationMultiplier: 1, startingPositions: [{ x: 0, y: 0 }],
};

describe("createElevationRenderer", () => {
  it("posts a request with an incrementing id and resolves on the matching response", async () => {
    const worker = fakeWorker();
    const r = createElevationRenderer(() => worker);
    const p = r.render(REQ);
    const posted = worker.posted[0] as { id: number };
    expect(posted.id).toBe(1);
    worker.onmessage!({ data: { id: posted.id, buffer: new ArrayBuffer(16), width: 2, height: 2 } } as MessageEvent);
    const result = await p;
    expect(result.width).toBe(2);
  });

  it("ignores a response whose id does not match a pending request", async () => {
    const worker = fakeWorker();
    const r = createElevationRenderer(() => worker);
    const p = r.render(REQ);
    // Stale/unknown id: must not throw and must not resolve the pending promise.
    worker.onmessage!({ data: { id: 999, buffer: new ArrayBuffer(4), width: 1, height: 1 } } as MessageEvent);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    const posted = worker.posted[0] as { id: number };
    worker.onmessage!({ data: { id: posted.id, buffer: new ArrayBuffer(16), width: 2, height: 2 } } as MessageEvent);
    await p;
  });

  it("terminates the worker on dispose", () => {
    const worker = fakeWorker();
    createElevationRenderer(() => worker).dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/useElevationPreview.spec.ts`
Expected: FAIL (cannot resolve `useElevationPreview`).

- [ ] **Step 3: Write the worker adapter**

```ts
// src/noise/preview/elevationRender.worker.ts
/// <reference lib="webworker" />
import { runRenderRequest, type ElevationRenderRequest } from "./elevationRenderRequest";

self.onmessage = (e: MessageEvent<ElevationRenderRequest>) => {
  const result = runRenderRequest(e.data);
  self.postMessage(result, [result.buffer]);
};
```

- [ ] **Step 4: Write the composable**

```ts
// src/components/useElevationPreview.ts
import { onBeforeUnmount } from "vue";
import type {
  ElevationRenderRequest,
  ElevationRenderResult,
} from "../noise/preview/elevationRenderRequest";

/** The minimal Worker surface the renderer uses, so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
}

export interface ElevationRenderer {
  render(req: Omit<ElevationRenderRequest, "id">): Promise<ElevationRenderResult>;
  dispose(): void;
}

function createRenderWorker(): WorkerLike {
  return new Worker(new URL("../noise/preview/elevationRender.worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Own a single worker and match each response to its request by id. A response
 * with no pending id is dropped (a superseded render), so a late result never
 * paints over a newer one. Lifecycle-free; callers own dispose().
 */
export function createElevationRenderer(
  createWorker: () => WorkerLike = createRenderWorker,
): ElevationRenderer {
  const worker = createWorker();
  const pending = new Map<number, (r: ElevationRenderResult) => void>();
  let nextId = 1;

  worker.onmessage = (e: MessageEvent) => {
    const result = e.data as ElevationRenderResult;
    const resolve = pending.get(result.id);
    if (resolve) {
      pending.delete(result.id);
      resolve(result);
    }
  };

  return {
    render(req) {
      const id = nextId++;
      return new Promise<ElevationRenderResult>((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ ...req, id } satisfies ElevationRenderRequest);
      });
    },
    dispose() {
      pending.clear();
      worker.terminate();
    },
  };
}

/** Vue composable: a renderer auto-disposed when the calling component unmounts. */
export function useElevationPreview(
  createWorker: () => WorkerLike = createRenderWorker,
): ElevationRenderer {
  const renderer = createElevationRenderer(createWorker);
  onBeforeUnmount(() => renderer.dispose());
  return renderer;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vp test test/useElevationPreview.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint**

Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/noise/preview/elevationRender.worker.ts src/components/useElevationPreview.ts test/useElevationPreview.spec.ts
git commit -m "feat(preview): worker adapter + useElevationPreview composable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

### Task 4: `ElevationPreviewPanel.vue`

**Files:**
- Create: `src/components/ElevationPreviewPanel.vue`
- Test: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**
- Consumes: `usePresetsStore` from `../store/presets`; `elevationCtxFromPreset` from `../model/elevationPreviewCtx`; `useElevationPreview`, `ElevationRenderer` from `./useElevationPreview`; `randomU32` from `../util/seed`; `FButton` from `../ui/FButton.vue`.
- Produces: default-export Vue component. Props: `{ renderer?: ElevationRenderer }` (omitted in the app -> real worker; injected in tests). Test hooks: `[data-test="generate"]`, `[data-test="preview-canvas"]`, `[data-test="preview-seed"]`, `[data-test="unsupported"]`, `[data-test="preview-error"]`.

- [ ] **Step 1: Write the failing test**

```ts
// test/elevationPreviewPanel.spec.ts
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ElevationPreviewPanel from "../src/components/ElevationPreviewPanel.vue";
import { usePresetsStore } from "../src/store/presets";
import { writeMapType } from "../src/model/mapType";
import type { ElevationRenderer } from "../src/components/useElevationPreview";

afterEach(() => vi.restoreAllMocks());

function stubCanvas() {
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  return putImageData;
}

function setup(mapTypeId: "nauvis" | "lakes", renderer: ElevationRenderer) {
  setActivePinia(createPinia());
  const store = usePresetsStore();
  store.createFromBuiltin("Default", "t");
  store.activePreset!.seed = 123456;
  writeMapType(store.activePreset!.propertyExpressionNames, mapTypeId);
  return mount(ElevationPreviewPanel, { props: { renderer } });
}

function okRenderer(): ElevationRenderer {
  return {
    render: vi.fn(async () => ({ id: 1, buffer: new ArrayBuffer(512 * 512 * 4), width: 512, height: 512 })),
    dispose: vi.fn(),
  };
}

describe("ElevationPreviewPanel", () => {
  it("renders a Lakes preset to the canvas on Generate", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("lakes", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ seed0: 123456, width: 512, height: 512, tilesPerPixel: 4, originX: -1024, originY: -1024 });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(w.find('[data-test="preview-seed"]').text()).toContain("123456");
  });

  it("shows a message and does not render for an unsupported map type", async () => {
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="unsupported"]').text()).toContain("Nauvis elevation");
    expect(w.find('[data-test="generate"]').attributes("disabled")).toBeDefined();
    await w.find('[data-test="generate"]').trigger("click");
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("shows an error when the render rejects", async () => {
    stubCanvas();
    const renderer: ElevationRenderer = { render: vi.fn(async () => { throw new Error("boom"); }), dispose: vi.fn() };
    const w = setup("lakes", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="preview-error"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL (cannot resolve `ElevationPreviewPanel.vue`).

- [ ] **Step 3: Write the component**

```vue
<!-- src/components/ElevationPreviewPanel.vue -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { elevationCtxFromPreset } from "../model/elevationPreviewCtx";
import { usePresetsStore } from "../store/presets";
import { randomU32 } from "../util/seed";
import FButton from "../ui/FButton.vue";
import { useElevationPreview, type ElevationRenderer } from "./useElevationPreview";

// Fixed spawn view (tunable constants; no UI yet). A 2048-tile window (the
// starting-lake distance cap is 1024) centered on the primary spawn.
const PREVIEW_PX = 512;
const TILES_PER_PIXEL = 4;

const props = defineProps<{ renderer?: ElevationRenderer }>();
// In the app no renderer is passed -> build the real worker-backed one (which
// registers its own onBeforeUnmount). Tests inject a fake, so no Worker is made.
const renderer = props.renderer ?? useElevationPreview();

const store = usePresetsStore();
const canvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const seed = ref<number | null>(null);
const hasRendered = ref(false);
const rolledSeed = ref<number | null>(null);

const preview = computed(() =>
  store.activePreset ? elevationCtxFromPreset(store.activePreset) : null,
);
const supported = computed(() => preview.value?.supported ?? false);

async function generate() {
  const preset = store.activePreset;
  const info = preview.value;
  if (!preset || !info || !info.supported || loading.value) return;

  if (preset.seed === null && rolledSeed.value === null) rolledSeed.value = randomU32();
  const seed0 = preset.seed ?? (rolledSeed.value as number);

  const s0 = info.ctx.startingPositions[0] ?? { x: 0, y: 0 };
  const half = (PREVIEW_PX * TILES_PER_PIXEL) / 2;

  loading.value = true;
  error.value = null;
  try {
    const result = await renderer.render({
      seed0,
      width: PREVIEW_PX,
      height: PREVIEW_PX,
      originX: s0.x - half,
      originY: s0.y - half,
      tilesPerPixel: TILES_PER_PIXEL,
      waterLevel: info.ctx.waterLevel,
      segmentationMultiplier: info.ctx.segmentationMultiplier,
      startingPositions: info.ctx.startingPositions,
    });
    const el = canvas.value;
    const g = el?.getContext("2d");
    if (el && g) {
      el.width = result.width;
      el.height = result.height;
      g.putImageData(new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), 0, 0);
      seed.value = seed0;
      hasRendered.value = true;
    }
  } catch {
    error.value = "Preview failed.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="elevation-preview">
    <div class="preview-toolbar">
      <span v-if="seed !== null" class="seed" data-test="preview-seed">Seed: {{ seed }}</span>
      <span class="spacer" />
      <FButton
        data-test="generate"
        variant="confirm"
        :disabled="!supported || loading"
        @click="generate()"
      >
        {{ loading ? "Rendering..." : "Generate" }}
      </FButton>
    </div>
    <div class="preview-stage f-bevel-in">
      <canvas
        v-show="supported && hasRendered"
        ref="canvas"
        data-test="preview-canvas"
        class="preview-canvas"
      />
      <p v-if="!supported" class="dim" data-test="unsupported">
        Client preview is not available for {{ preview?.mapTypeLabel ?? "this map type" }} yet.
      </p>
      <p v-else-if="error" class="error" role="alert" data-test="preview-error">{{ error }}</p>
      <p v-else-if="!hasRendered" class="dim">Click "Generate" to render the map.</p>
    </div>
  </div>
</template>

<style scoped>
.elevation-preview {
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
.spacer {
  flex: 1;
}
.seed {
  font-size: 12px;
  color: var(--f-text-dim);
}
.preview-stage {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--f-inset);
  padding: 8px;
}
.preview-canvas {
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
}
.error {
  color: var(--f-red);
}
.dim {
  color: var(--f-text-dim);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "feat(preview): ElevationPreviewPanel tab UI (client-side canvas render)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

### Task 5: register the Preview tab in `App.vue`

**Files:**
- Modify: `src/App.vue:14` (TABS) and `src/App.vue:29-32` (tab-content branches), plus the import block.
- Test: `test/app.spec.ts` (add one assertion)

**Interfaces:**
- Consumes: `ElevationPreviewPanel` from `./components/ElevationPreviewPanel.vue`.
- Produces: a `"Preview"` entry in the editor tab bar that mounts the panel when active. (The panel builds a real Worker on mount, so tests must NOT activate the tab - only assert the label renders.)

- [ ] **Step 1: Write the failing test (extend app.spec)**

Add this `it` block inside the existing `describe("App shell", ...)` in `test/app.spec.ts`:

```ts
  it("offers a Preview tab", () => {
    const w = mountApp();
    expect(w.text()).toContain("Preview");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/app.spec.ts`
Expected: FAIL (`expect(...).toContain("Preview")` - tab not present yet).

- [ ] **Step 3: Add the import**

In `src/App.vue`, add to the import block (alphabetical, after `EnemyTab`):

```ts
import ElevationPreviewPanel from "./components/ElevationPreviewPanel.vue";
```

- [ ] **Step 4: Add the tab to TABS**

Change `src/App.vue:14` from:

```ts
const TABS = ["Resources", "Terrain", "Enemy", "Advanced"];
```

to:

```ts
const TABS = ["Resources", "Terrain", "Enemy", "Advanced", "Preview"];
```

- [ ] **Step 5: Add the tab-content branch**

In `src/App.vue`, change the `tab-content` block so the Preview branch precedes the `v-else` Advanced fallback:

```vue
        <div class="tab-content">
          <ResourcesTab v-if="activeTab === 'Resources'" />
          <TerrainTab v-else-if="activeTab === 'Terrain'" />
          <EnemyTab v-else-if="activeTab === 'Enemy'" />
          <ElevationPreviewPanel v-else-if="activeTab === 'Preview'" />
          <AdvancedTab v-else />
        </div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vp test test/app.spec.ts`
Expected: PASS (all App shell tests, including the new one).

- [ ] **Step 7: Full suite + lint**

Run: `pnpm vp test`
Expected: PASS (entire suite green).
Run: `pnpm vp check --fix`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.vue test/app.spec.ts
git commit -m "feat(preview): register the Preview tab in App

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

### Task 6: verify in the real app - build, render, measure, tune

This task has no new unit test; it validates the Vite worker path (never exercised under Vitest) and dials in the render size. The worker only runs in a real browser.

**Files:**
- Possibly modify: `src/components/ElevationPreviewPanel.vue` (the `PREVIEW_PX` / `TILES_PER_PIXEL` constants), only if the measurement calls for it.

- [ ] **Step 1: Production build sanity-check the worker bundle**

Run: `pnpm vp build`
Expected: build succeeds and emits a separate worker chunk (a `assets/*worker*.js` file). If the build errors on the `new URL(..., import.meta.url)` worker import, that is the risk flagged in the spec - resolve before proceeding (confirm `{ type: "module" }` form; check Vite worker docs).

- [ ] **Step 2: Run the dev server and open the app**

Run: `pnpm vp dev`
Then in a browser: create/select a preset, set its Map type to **Lakes elevation** (Terrain tab), open the **Preview** tab, click **Generate**.
Expected: a blue/green land-water image appears; the rest of the UI (tab switching, sliders) stays responsive while it renders (worker off-thread).

- [ ] **Step 3: Measure render time**

In DevTools console, time one render (the worker posts a result; wall-clock from click to paint). Alternatively wrap the `renderer.render(...)` call in the panel with `performance.now()` deltas temporarily.
Expected/target: interactive-ish, roughly <= 2-3 s at the default `512 x 512` @ `TILES_PER_PIXEL = 4`.

- [ ] **Step 4: Tune if needed**

If render clearly exceeds ~3 s: reduce `PREVIEW_PX` to `384` (or coarsen `TILES_PER_PIXEL`) in `ElevationPreviewPanel.vue`. Re-check that the `originX/originY = s0 - PREVIEW_PX*TILES_PER_PIXEL/2` framing still shows the starting lakes. Update the panel test's expected `width`/`height`/`originX`/`originY` to match if you change the constants.
If performance is fine, make no change.

- [ ] **Step 5: Cross-check fidelity (optional but recommended)**

Compare the client Preview tab against the server `PreviewPanel` (right aside) for the same preset + seed on a Lakes map. Coastlines near spawn should agree (the M1 near-spawn parity result). Divergence far from spawn is expected (documented f32 floor).

- [ ] **Step 6: Commit (only if constants or tests changed)**

```bash
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "perf(preview): tune client preview render size after measurement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TWh8jqCio53zNagfGh3atv"
```

---

## Self-Review

**Spec coverage** (each spec section -> task):
- Preset -> ctx derivation (waterLevel/seg/startingPositions, guards) -> Task 1. ✓
- Worker message contract + pure render logic -> Task 2. ✓
- Worker adapter + composable (id staleness, dispose) -> Task 3. ✓
- Panel: map-type gate, seed resolution, fixed spawn view, canvas paint, error/loading -> Task 4. ✓
- New Preview tab wired into App -> Task 5. ✓
- Performance measure-and-tune + Vite worker build validation -> Task 6. ✓
- Non-goals (other map types, auto-render, pan/zoom, reroll, richer visuals, tiling) -> not built, matching spec. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every run step shows an expected result. ✓

**Type consistency:** `ElevationRenderRequest`/`ElevationRenderResult` defined in Task 2 are imported unchanged in Tasks 3-4; `ElevationRenderer`/`WorkerLike` defined in Task 3 are consumed in Task 4; `ElevationPreviewCtx.ctx` shape (Task 1) matches the `renderElevation` `ctx` and the request fields (Task 2). `render(req: Omit<ElevationRenderRequest,"id">)` is called in Task 4 without an `id`, and `createElevationRenderer` adds the `id` - consistent. ✓

**Known risks (carried from spec):**
- Vite worker build (`new URL(..., import.meta.url)`) is only validated in Task 6; if it fails, the fix is config-level and does not affect Tasks 1-5 (all worker-free).
- Default render size is a guess; Task 6 measures and tunes it, updating the Task 4 test constants together.

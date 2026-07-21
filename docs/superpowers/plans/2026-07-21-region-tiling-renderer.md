# Region-Tiling Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut client-side map preview wall-clock from ~12.5s to ~2-3s by splitting the 1024x1024 render into ~64 square tiles executed across a Web Worker pool and blitted progressively, without changing a single output pixel.

**Architecture:** A pure geometry module (`planTiles` / `stitchTiles`) decides the tile grid. `runRenderRequest` gains one optional `fullImage` field, used solely to widen the cliff cell-query box so cliff marks are not clipped at seams, clamped to the image so output stays byte-identical. A `createRenderPool` owns concurrency with an injectable `execute` seam - real Workers in the app, in-process `runRenderRequest` in tests, which is what makes the tiled-equals-untiled gate runnable in Node.

**Tech Stack:** TypeScript 6.0.3, Vue 3 `<script setup>`, Pinia, Vite+ (`vp`), Vitest-compatible tests importing from `"vite-plus/test"`, happy-dom, browser Web Workers.

**Design doc:** `/Users/ericjohnson/GitHub/FactorioMapWebUI/docs/superpowers/specs/2026-07-21-region-tiling-renderer-design.md`

## Global Constraints

- Run everything through pnpm. Full suite: `pnpm vp test`. One file: `pnpm vp test test/<file>.spec.ts`. Lint+format (the only lint step): `pnpm vp check --fix`. Benchmark: `pnpm perf`.
- There is **no** `tsc` / `vue-tsc` type-check step. Verify by running tests, never by trusting LSP diagnostics. Stale "cannot find module" errors on newly created files are normal and are not a failure.
- `src/**` imports are **extensionless**. Test files import from `"vite-plus/test"`. Files under `test/oracle/` import oracle helpers **with** a `.ts` extension.
- Use hyphens (`-`) in all prose and comments. Never em dashes or en dashes.
- Determinism is a hard invariant. Tiling must not move a single pixel. Never edit a fixture or an expected value to make a test pass - a mismatch is a real finding.
- Work happens on branch `feat/render-tiling`, already created off `main`. Do **not** push, merge, or deploy.
- Every commit message ends with these two lines, verbatim:

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
  ```

- Constants that matter, already in the codebase: `CLIFF_MARK_RADIUS_PX = 2`, `CLIFF_GRID_SIZE = 4`, `CLIFF_CELL_CENTER_X = 2`, `CLIFF_CELL_CENTER_Y = 2.5` (all exported from `src/noise/cliffs/cliffCatalog.ts`).

## File Structure

**Created:**

- `src/noise/preview/tiling.ts` - pure tile geometry and buffer stitching. No Workers, no renderer imports.
- `src/components/renderPool.ts` - concurrency, queue, generation/supersede. Injectable `execute`.
- `test/tiling.spec.ts` - `planTiles` / `stitchTiles` unit tests.
- `test/renderPool.spec.ts` - pool behavior with a fake `execute`.
- `test/tiledEquality.spec.ts` - the byte-identity gate: tiled render equals untiled render.

**Modified:**

- `src/noise/preview/renderCliffs.ts` - optional `cellQueryBox`.
- `src/noise/preview/elevationRenderRequest.ts` - optional `fullImage`, halo computation.
- `src/components/useElevationPreview.ts` - pool-backed renderer, per-slot workers.
- `src/components/ElevationPreviewPanel.vue` - progressive per-tile blit.
- `test/renderCliffs.spec.ts`, `test/useElevationPreview.spec.ts`, `test/elevationPreviewPanel.spec.ts` - updated for new signatures.
- `test/render-cost.perf.spec.ts` - tile-overhead measurement.
- `docs/noise/client-preview-ROADMAP.md` - mark the Milestone 5 tiling item done, record measured numbers.

## Task Order and the Phase Gate

Task 1 measures per-tile setup overhead. Its result decides whether **Task 8** (the scene split) runs at all: ratio at or below 1.15 means skip Task 8; above 1.15 means do it. Tasks 2-7 and 9 run regardless.

**GATE RESOLVED - Task 8 is CANCELLED.** Task 1 has been run. Measured ratios of tiled (64 x 128px) against one whole 1024x1024 render:

| view      | whole    | tiled    | ratio |
| --------- | -------- | -------- | ----- |
| terrain   | 7810 ms  | 8081 ms  | 1.035 |
| all       | 10683 ms | 11422 ms | 1.069 |

Both are far under the 1.15 threshold, so rebuilding the resolver stack per tile is not worth engineering away. Task 8 is struck. Do not implement it; its section is retained below only as a record of the rejected option.

Consequences: the worker stays a 7-line file, no renderer gains a `deps` parameter, and the ~3.5-7% extra total CPU is accepted as the cost of tiling. Hold the final browser number against that - the theoretical floor for the composite view is roughly `10.7s / poolSize * 1.069`, and any large gap above it is dispatch and blit overhead, not compute.

---

### Task 1: Measure per-tile setup overhead (the phase-A gate)

Each `runRenderRequest` call rebuilds `makeResourceResolver` (which memoizes ore spot lists per 1024-tile world region), `makeCliffPlacement`, `makeTileCatalog`, and the basis-noise seed tables. Rendering 64 tiles repeats that setup 64 times. This task measures how much that costs before any tiling code is written.

**Files:**

- Modify: `test/render-cost.perf.spec.ts` (append a second `perfIt` block after the existing one)

**Interfaces:**

- Consumes: existing `runRenderRequest`, and the file-local `base`, `N`, `HALF`, `time`, `rows`, `perfIt` bindings already defined at the top of the file.
- Produces: a measured `tiled/whole` ratio per view, written into `perf-result.txt`. No code other tasks import.

- [ ] **Step 1: Append the measurement block**

Append to the end of `test/render-cost.perf.spec.ts`:

```ts
// Phase-A gate for the region-tiling plan: how much does rebuilding every
// resolver per tile cost? Renders the same 1024x1024 area as 64 128x128 tiles
// and compares against the single whole-image render. A ratio near 1.0 means
// per-tile setup is noise; a high ratio means the scene/geometry split (plan
// Task 8) is needed. iters=1 because each tiled pass is already 64 renders.
perfIt(
  "tile overhead: 64 x 128x128 vs one 1024x1024",
  () => {
    const TILE = 128;
    for (const view of ["terrain", "all"] as const) {
      const whole = time(`whole ${view}`, () => runRenderRequest({ ...base, view }), 1);
      const tiled = time(
        `tiled ${view} (64 x ${TILE})`,
        () => {
          for (let dy = 0; dy < N; dy += TILE) {
            for (let dx = 0; dx < N; dx += TILE) {
              runRenderRequest({
                ...base,
                view,
                width: TILE,
                height: TILE,
                originX: -HALF + dx,
                originY: -HALF + dy,
              });
            }
          }
        },
        1,
      );
      rows.push(`${`ratio ${view}`.padEnd(30)} ${(tiled / whole).toFixed(3)}`);
    }
    writeFileSync("perf-result.txt", rows.join("\n") + "\n");
  },
  900000,
);
```

The timeout is a bare number as the third argument, matching the existing `perfIt` call at the end of the file - not an options object.

Note: `fullImage` is deliberately not passed - it does not exist until Task 3, and it does not affect setup cost, which is what this measures.

- [ ] **Step 2: Run the benchmark**

Run: `pnpm perf`

Expected: takes several minutes and prints a table ending in two `ratio` lines, for example `ratio terrain  1.08` and `ratio all  1.34`.

- [ ] **Step 3: Record the decision**

Write the two ratios into the task report and state the gate outcome explicitly: "both ratios <= 1.15, skip Task 8" or "ratio for <view> is X > 1.15, Task 8 is required".

- [ ] **Step 4: Commit**

```bash
git add test/render-cost.perf.spec.ts
git commit -F - <<'EOF'
perf(preview): measure per-tile setup overhead

Renders the same 1024x1024 area as 64 128x128 tiles and compares against
the single whole-image render, so the region-tiling plan can decide
whether resolver setup needs hoisting out of the per-tile path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 2: Tile geometry and stitching

**Files:**

- Create: `src/noise/preview/tiling.ts`
- Test: `test/tiling.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface ImageBox { originX: number; originY: number; width: number; height: number; tilesPerPixel: number }`
  - `interface TileBox extends ImageBox { dx: number; dy: number }`
  - `planTiles(full: ImageBox, tileSize: number): TileBox[]`
  - `interface StitchTile { dx: number; dy: number; width: number; height: number; data: Uint8ClampedArray }`
  - `stitchTiles(full: { width: number; height: number }, tiles: readonly StitchTile[]): Uint8ClampedArray`

- [ ] **Step 1: Write the failing test**

Create `test/tiling.spec.ts`:

```ts
import { describe, it, expect } from "vite-plus/test";
import { planTiles, stitchTiles } from "../src/noise/preview/tiling";

const full = { originX: -512, originY: -512, width: 1024, height: 1024, tilesPerPixel: 1 };

describe("planTiles", () => {
  it("covers the image exactly once, with no overlap", () => {
    const tiles = planTiles(full, 128);
    expect(tiles).toHaveLength(64);
    const seen = new Uint8Array(full.width * full.height);
    for (const t of tiles) {
      for (let y = 0; y < t.height; y++) {
        for (let x = 0; x < t.width; x++) {
          seen[(t.dy + y) * full.width + (t.dx + x)]++;
        }
      }
    }
    expect(seen.every((c) => c === 1)).toBe(true);
  });

  it("maps each tile's pixel offset to its world origin through tilesPerPixel", () => {
    const tiles = planTiles({ ...full, tilesPerPixel: 2 }, 128);
    const t = tiles.find((q) => q.dx === 128 && q.dy === 256)!;
    expect(t.originX).toBe(-512 + 128 * 2);
    expect(t.originY).toBe(-512 + 256 * 2);
    expect(t.tilesPerPixel).toBe(2);
  });

  it("handles a ragged trailing row and column", () => {
    const tiles = planTiles({ ...full, width: 100, height: 70 }, 32);
    // 4 columns (32,32,32,4) x 3 rows (32,32,6)
    expect(tiles).toHaveLength(12);
    expect(tiles.filter((t) => t.width === 4)).toHaveLength(3);
    expect(tiles.filter((t) => t.height === 6)).toHaveLength(4);
    const area = tiles.reduce((n, t) => n + t.width * t.height, 0);
    expect(area).toBe(100 * 70);
  });

  it("returns a single tile when the tile size exceeds the image", () => {
    const tiles = planTiles({ ...full, width: 10, height: 10 }, 4096);
    expect(tiles).toEqual([
      { originX: -512, originY: -512, width: 10, height: 10, tilesPerPixel: 1, dx: 0, dy: 0 },
    ]);
  });

  it("rejects a non-positive tile size", () => {
    expect(() => planTiles(full, 0)).toThrow(/tileSize/);
  });
});

describe("stitchTiles", () => {
  it("writes each tile's rows into the right place in the full buffer", () => {
    const target = { width: 4, height: 2 };
    const left = new Uint8ClampedArray(2 * 2 * 4).fill(1);
    const right = new Uint8ClampedArray(2 * 2 * 4).fill(2);
    const out = stitchTiles(target, [
      { dx: 0, dy: 0, width: 2, height: 2, data: left },
      { dx: 2, dy: 0, width: 2, height: 2, data: right },
    ]);
    // Row 0: two pixels of 1, then two pixels of 2.
    expect([...out.subarray(0, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...out.subarray(8, 16)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    // Row 1 repeats the pattern.
    expect([...out.subarray(16, 24)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...out.subarray(24, 32)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/tiling.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/preview/tiling`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/preview/tiling.ts`:

```ts
/**
 * Pure tile geometry for the region-tiled renderer: split a pixel image into a
 * grid of sub-boxes, each carrying both its pixel offset within the full image
 * (`dx`/`dy`, for blitting) and its own world origin (for rendering). No Worker,
 * no renderer, no DOM - see the region-tiling design doc.
 */

/** A pixel rectangle plus the world coordinates it maps onto. */
export interface ImageBox {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly tilesPerPixel: number;
}

/** An `ImageBox` that is part of a larger image, at pixel offset `dx`/`dy`. */
export interface TileBox extends ImageBox {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Split `full` into a row-major grid of at most `tileSize`-square tiles. The
 * trailing row and column are narrower when the size is not divisible, so the
 * tiles cover the image exactly once with no overlap.
 */
/**
 * Byte-identity precondition: a tile computes world coordinates as
 * `(originX + dx * tilesPerPixel) + px * tilesPerPixel`, while the untiled
 * render computes `originX + (dx + px) * tilesPerPixel`. Those agree exactly
 * only when the intermediate products are exactly representable in f64 - true
 * for integer origins and integer `tilesPerPixel`, which is all the app uses
 * (the preview is fixed at 1). A fractional `tilesPerPixel` (a zoom feature,
 * say) could make the two disagree in the last bit and silently break the
 * tiled-equals-untiled invariant. Do not generalize this without extending the
 * equality gate to the new scale.
 */
export function planTiles(full: ImageBox, tileSize: number): TileBox[] {
  if (!(tileSize > 0)) throw new Error("planTiles: tileSize must be positive");
  const tiles: TileBox[] = [];
  for (let dy = 0; dy < full.height; dy += tileSize) {
    const height = Math.min(tileSize, full.height - dy);
    for (let dx = 0; dx < full.width; dx += tileSize) {
      const width = Math.min(tileSize, full.width - dx);
      tiles.push({
        dx,
        dy,
        width,
        height,
        originX: full.originX + dx * full.tilesPerPixel,
        originY: full.originY + dy * full.tilesPerPixel,
        tilesPerPixel: full.tilesPerPixel,
      });
    }
  }
  return tiles;
}

/** A rendered tile's pixels, positioned within the full image. */
export interface StitchTile {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Assemble rendered tiles into one full-image RGBA buffer. The app blits tiles
 * straight to the canvas instead (so they appear progressively); this exists for
 * consumers that need a flat buffer, notably the tiled-equals-untiled gate.
 */
export function stitchTiles(
  full: { readonly width: number; readonly height: number },
  tiles: readonly StitchTile[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(full.width * full.height * 4);
  for (const t of tiles) {
    const rowBytes = t.width * 4;
    for (let y = 0; y < t.height; y++) {
      const src = y * rowBytes;
      out.set(t.data.subarray(src, src + rowBytes), ((t.dy + y) * full.width + t.dx) * 4);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vp test test/tiling.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
pnpm vp check --fix
git add src/noise/preview/tiling.ts test/tiling.spec.ts
git commit -F - <<'EOF'
feat(preview): add pure tile geometry and stitching

planTiles splits a pixel image into a row-major grid covering it exactly
once, carrying both the pixel offset for blitting and the world origin for
rendering. stitchTiles assembles rendered tiles into a flat RGBA buffer for
consumers that need one, notably the tiled-equals-untiled gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 3: The cliff halo (seam correctness)

This is the only place tiling can change pixels. `makeCliffPlacement().placedCells(x0, y0, x1, y1)` keeps cells whose **center** satisfies `x >= x0 && x < x1` (same in y); `renderCliffs` then paints a `(2r+1)x(2r+1)` block around each center's pixel, `r = CLIFF_MARK_RADIUS_PX = 2`. A cell centered just outside a tile still owes paint inside it, so each tile must query a widened box.

**Halo width derivation** (state this in the task report; a reviewer will ask). A cell at world `wx` maps to pixel `cx = floor((wx - originX) / tilesPerPixel)` and paints pixels `cx - r .. cx + r`.

- It touches the tile on the low side when `cx >= -r`, and `floor(v) >= -r` exactly when `v >= -r`, so the condition is `wx - originX >= -r * tilesPerPixel`. `placedCells` uses an inclusive lower bound, so lowering `x0` by exactly `r * tilesPerPixel` is precise.
- It touches on the high side when `cx <= width - 1 + r`, i.e. `(wx - originX) / tilesPerPixel < width + r`, i.e. `wx < x1 + r * tilesPerPixel`. `placedCells` uses an exclusive upper bound, so raising `x1` by exactly `r * tilesPerPixel` is precise.

So the halo is `CLIFF_MARK_RADIUS_PX * tilesPerPixel`, exact on both sides, no rounding slack needed. It is then intersected with the full-image box, because the untiled render drops cells centered outside the image and the tiled render must drop exactly the same ones.

**Files:**

- Modify: `src/noise/preview/renderCliffs.ts`
- Modify: `src/noise/preview/elevationRenderRequest.ts`
- Test: `test/tiledEquality.spec.ts` (create)

**Interfaces:**

- Consumes: `planTiles`, `stitchTiles`, `TileBox` from Task 2.
- Produces:
  - `RenderCliffsOptions.cellQueryBox?: { x0: number; y0: number; x1: number; y1: number }` - world coordinates; defaults to the pixel box.
  - `ElevationRenderRequest.fullImage?: { originX: number; originY: number; width: number; height: number }` - the enclosing image this request is a tile of. Absent means "this request is the whole image", which is today's behavior.

- [ ] **Step 1: Find a seed and region where cliff cells straddle a seam**

The gate is only meaningful if a missing halo actually fails it. Create `test/findSeam.spec.ts` as a throwaway, run it to print the constants, then delete it. (It lives in `test/` rather than the scratchpad because that is the only place the project's test runner will resolve `src/**` imports from.)

Do **not** search for cliff cells near a seam by coordinate. Proximity is necessary but not sufficient: the mark only changes pixels if the clipped part lands on non-water terrain, and a cell near the vertical seam tells you nothing about the horizontal one. Search on the property that actually matters - that a haloless tiled render **differs** from the whole render:

```ts
import { it } from "vite-plus/test";
import { runRenderRequest } from "../src/noise/preview/elevationRenderRequest";

// Throwaway: finds a region where rendering in tiles WITHOUT a halo actually
// produces different bytes than rendering it whole. That is exactly the failure
// the gate must detect, so searching on it directly guarantees the gate can
// fail. Delete this file once the constants are recorded.
it("find a region where haloless tiling visibly differs", () => {
  const SIZE = 64;
  const TILE = 32;
  const base = {
    id: 0,
    width: SIZE,
    height: SIZE,
    tilesPerPixel: 1,
    waterLevel: 0,
    segmentationMultiplier: 1,
    startingPositions: [{ x: 0, y: 0 }],
    mapType: "nauvis" as const,
    view: "cliffs" as const,
  };

  for (const seed0 of [123456, 1, 2, 3, 4, 5]) {
    for (let oy = -512; oy <= 512; oy += SIZE) {
      for (let ox = -512; ox <= 512; ox += SIZE) {
        const whole = new Uint8ClampedArray(
          runRenderRequest({ ...base, seed0, originX: ox, originY: oy }).buffer,
        );
        // Tile it with no fullImage, i.e. no halo - today's behavior.
        const tiled = new Uint8ClampedArray(whole.length);
        for (let dy = 0; dy < SIZE; dy += TILE) {
          for (let dx = 0; dx < SIZE; dx += TILE) {
            const t = new Uint8ClampedArray(
              runRenderRequest({
                ...base,
                seed0,
                originX: ox + dx,
                originY: oy + dy,
                width: TILE,
                height: TILE,
              }).buffer,
            );
            for (let y = 0; y < TILE; y++) {
              tiled.set(
                t.subarray(y * TILE * 4, (y + 1) * TILE * 4),
                ((dy + y) * SIZE + dx) * 4,
              );
            }
          }
        }
        let diff = 0;
        for (let i = 0; i < whole.length; i++) if (whole[i] !== tiled[i]) diff++;
        if (diff > 0) {
          console.log(`FOUND seed0=${seed0} originX=${ox} originY=${oy} differingBytes=${diff}`);
          return;
        }
      }
    }
  }
  throw new Error("no differing region found - widen the search");
});
```

Run: `pnpm vp test test/findSeam.spec.ts`
Expected: prints one `FOUND seed0=... originX=... originY=... differingBytes=N` line with `N` comfortably above zero. Record the three numbers as `SEAM_SEED`, `SEAM_ORIGIN_X`, `SEAM_ORIGIN_Y` below, then `rm test/findSeam.spec.ts`. Because the search criterion **is** the gate's assertion, Step 3's "verify it fails" is now guaranteed rather than hoped for.

- [ ] **Step 2: Write the failing gate test**

Create `test/tiledEquality.spec.ts`, substituting the three constants found in Step 1:

```ts
import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";
import { planTiles, stitchTiles, type ImageBox } from "../src/noise/preview/tiling";

// Constants from the Task 3 Step 1 search: a region whose cliff cells sit within
// CLIFF_MARK_RADIUS_PX of the interior seam of a 64x64 image tiled at 32, so a
// missing halo actually fails this gate instead of passing by luck.
const SEAM_SEED = 123456; // replace with the found seed0
const SEAM_ORIGIN_X = -512; // replace with the found originX
const SEAM_ORIGIN_Y = -512; // replace with the found originY

function baseReq(over: Partial<ElevationRenderRequest> = {}): ElevationRenderRequest {
  return {
    id: 0,
    seed0: SEAM_SEED,
    width: 64,
    height: 64,
    originX: SEAM_ORIGIN_X,
    originY: SEAM_ORIGIN_Y,
    tilesPerPixel: 1,
    waterLevel: 0,
    segmentationMultiplier: 1,
    startingPositions: [{ x: 0, y: 0 }],
    mapType: "nauvis",
    ...over,
  };
}

/** Render `req` as a grid of `tileSize` tiles and stitch the result. */
function renderTiled(req: ElevationRenderRequest, tileSize: number): Uint8ClampedArray {
  const full: ImageBox = {
    originX: req.originX,
    originY: req.originY,
    width: req.width,
    height: req.height,
    tilesPerPixel: req.tilesPerPixel,
  };
  const fullImage = {
    originX: full.originX,
    originY: full.originY,
    width: full.width,
    height: full.height,
  };
  const tiles = planTiles(full, tileSize).map((t) => {
    const out = runRenderRequest({
      ...req,
      originX: t.originX,
      originY: t.originY,
      width: t.width,
      height: t.height,
      fullImage,
    });
    return {
      dx: t.dx,
      dy: t.dy,
      width: t.width,
      height: t.height,
      data: new Uint8ClampedArray(out.buffer),
    };
  });
  return stitchTiles(full, tiles);
}

function renderWhole(req: ElevationRenderRequest): Uint8ClampedArray {
  return new Uint8ClampedArray(runRenderRequest(req).buffer);
}

describe("tiled render equals untiled render", () => {
  it("matches byte for byte on the cliffs view across a seam", () => {
    const req = baseReq({ view: "cliffs" });
    expect(renderTiled(req, 32)).toEqual(renderWhole(req));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails for the right reason**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: FAIL. The failure must be an array mismatch (cliff pixels missing near the seam), not a type or import error. If it **passes** at this point the gate is worthless - go back to Step 1 and find a region with more cliff cells near the seam, because the halo is not yet implemented and it must therefore fail.

- [ ] **Step 4: Add `cellQueryBox` to renderCliffs**

In `src/noise/preview/renderCliffs.ts`, add to `RenderCliffsOptions`:

```ts
  /**
   * World box to enumerate placed cliff cells over. Defaults to the pixel grid's
   * own world box. The tiled renderer widens this by CLIFF_MARK_RADIUS_PX tiles
   * (clamped to the full image) so a cell centered just outside this tile still
   * paints the part of its mark that falls inside - without it, cliff marks are
   * clipped at tile seams. The paint loop already clips to the pixel grid, so a
   * wider query cannot paint outside the tile.
   */
  readonly cellQueryBox?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
```

and replace the box computation in the body:

```ts
  const box = opts.cellQueryBox ?? {
    x0: originX,
    y0: originY,
    x1: originX + width * tpp,
    y1: originY + height * tpp,
  };
  const cells = placement.placedCells(box.x0, box.y0, box.x1, box.y1);
```

(This deletes the existing `const x0 = originX;` through `const cells = ...` lines.)

- [ ] **Step 5: Add `fullImage` and the halo computation to the request**

In `src/noise/preview/elevationRenderRequest.ts`, add the import:

```ts
import { CLIFF_MARK_RADIUS_PX } from "../cliffs/cliffCatalog";
```

Add to `ElevationRenderRequest`:

```ts
  /**
   * The full image this request is one tile of, when the renderer is tiling.
   * Absent means the request *is* the whole image (the single-render path).
   *
   * Used for exactly one thing: clamping the widened cliff cell-query box, so a
   * tiled render reproduces the untiled render byte for byte - including at the
   * image border, where the untiled render drops cliff cells centered outside
   * the image. `tilesPerPixel` is shared with the request.
   */
  fullImage?: {
    readonly originX: number;
    readonly originY: number;
    readonly width: number;
    readonly height: number;
  };
```

Add this function above `runRenderRequest`, **exported** so the clamp can be unit-tested directly (the equality gate cannot pin it - see Step 6a):

```ts
/**
 * The world box to enumerate cliff cells over for `req`: its own pixel box,
 * widened by the cliff mark radius so marks are not clipped at tile seams, then
 * intersected with the full image so the outer border keeps the untiled
 * behavior. The halo is exact rather than conservative: a cell touches the tile
 * on the low side exactly when `wx - originX >= -r * tpp` (because
 * `floor(v) >= -r` iff `v >= -r`) and on the high side exactly when
 * `wx < x1 + r * tpp`, matching placedCells' inclusive-lower/exclusive-upper
 * filter.
 */
export function cliffCellQueryBox(req: ElevationRenderRequest): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const tpp = req.tilesPerPixel;
  const x0 = req.originX;
  const y0 = req.originY;
  const x1 = req.originX + req.width * tpp;
  const y1 = req.originY + req.height * tpp;
  const full = req.fullImage;
  if (!full) return { x0, y0, x1, y1 };
  const halo = CLIFF_MARK_RADIUS_PX * tpp;
  return {
    x0: Math.max(x0 - halo, full.originX),
    y0: Math.max(y0 - halo, full.originY),
    x1: Math.min(x1 + halo, full.originX + full.width * tpp),
    y1: Math.min(y1 + halo, full.originY + full.height * tpp),
  };
}
```

And pass it in the `renderCliffs` call inside `runRenderRequest`, adding one property to the existing options object:

```ts
        cellQueryBox: cliffCellQueryBox(req),
```

- [ ] **Step 6: Run the gate to verify it passes**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: PASS.

- [ ] **Step 6a: Pin the clamp with direct unit tests**

The equality gate proves the **widening** exists (delete it and the gate fails). It does **not** prove the **clamp** exists: dropping the `Math.max`/`Math.min` against `fullImage` only changes pixels if the test region happens to have a placed cliff cell within 2 tiles outside its border *and* a non-water pixel adjacent to it. That is luck, not coverage - and the clamp is the half that preserves byte-identity with the game-validated baseline. Pin it directly.

Add to `test/elevationRenderRequest.spec.ts`:

```ts
import { cliffCellQueryBox } from "../src/noise/preview/elevationRenderRequest";

describe("cliffCellQueryBox", () => {
  const full = { originX: -64, originY: -64, width: 128, height: 128 };
  const req = (over: Partial<ElevationRenderRequest>): ElevationRenderRequest => ({
    id: 0,
    seed0: 1,
    width: 32,
    height: 32,
    originX: -64,
    originY: -64,
    tilesPerPixel: 1,
    waterLevel: 0,
    segmentationMultiplier: 1,
    startingPositions: [{ x: 0, y: 0 }],
    ...over,
  });

  it("is the plain pixel box when the request is the whole image", () => {
    expect(cliffCellQueryBox(req({}))).toEqual({ x0: -64, y0: -64, x1: -32, y1: -32 });
  });

  it("widens an interior tile by the mark radius on every side", () => {
    // Interior tile at pixel offset (32,32) of the 128x128 image.
    const box = cliffCellQueryBox(req({ originX: -32, originY: -32, fullImage: full }));
    expect(box).toEqual({ x0: -34, y0: -34, x1: -34 + 36, y1: -34 + 36 });
  });

  it("clamps to the image edge instead of widening past it", () => {
    // Top-left tile: the low sides must NOT be widened past the image origin,
    // because the untiled render drops cells centered outside the image.
    const box = cliffCellQueryBox(req({ fullImage: full }));
    expect(box.x0).toBe(full.originX);
    expect(box.y0).toBe(full.originY);
    expect(box.x1).toBe(-32 + 2); // interior side still widened
    expect(box.y1).toBe(-32 + 2);
  });

  it("clamps the far edge of the last tile", () => {
    const box = cliffCellQueryBox(req({ originX: 32, originY: 32, fullImage: full }));
    expect(box.x1).toBe(full.originX + full.width); // tpp 1
    expect(box.y1).toBe(full.originY + full.height);
  });

  it("scales the halo by tilesPerPixel", () => {
    const box = cliffCellQueryBox(
      req({ originX: -32, originY: -32, tilesPerPixel: 4, fullImage: full }),
    );
    expect(box.x0).toBe(-32 - 8); // CLIFF_MARK_RADIUS_PX * 4
  });
});
```

Run: `pnpm vp test test/elevationRenderRequest.spec.ts`
Expected: PASS. Verify the clamp cases genuinely fail if the `Math.max`/`Math.min` are removed - a gate that cannot fail proves nothing.

- [ ] **Step 7: Run the existing cliff and request tests**

Run: `pnpm vp test test/renderCliffs.spec.ts test/elevationRenderRequest.spec.ts test/cliffPlacement.spec.ts`
Expected: PASS with no changes needed - both new fields are optional and default to today's behavior.

- [ ] **Step 8: Lint and commit**

```bash
pnpm vp check --fix
git add src/noise/preview/renderCliffs.ts src/noise/preview/elevationRenderRequest.ts test/tiledEquality.spec.ts
git commit -F - <<'EOF'
feat(preview): widen the cliff cell query so tile seams stay exact

renderCliffs keeps cells whose center is inside the box, then paints a
5x5 mark around it, so a cell centered just outside a tile still owes
paint inside it. Tiled requests now carry the enclosing image and widen
the cell query by CLIFF_MARK_RADIUS_PX tiles, clamped to that image so
the outer border keeps the untiled behavior and output stays byte-exact.

The gate test was confirmed failing before the halo existed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 4: Extend the gate to every view and a ragged grid

Cliffs were the suspected seam case. This proves the other four renderers really are per-pixel pure, and that a non-divisible grid stitches correctly.

**Files:**

- Modify: `test/tiledEquality.spec.ts`

**Interfaces:**

- Consumes: `baseReq`, `renderTiled`, `renderWhole` from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Add the remaining cases**

Add inside the existing `describe` in `test/tiledEquality.spec.ts`:

```ts
  const VIEWS = ["elevation", "terrain", "resources", "enemies", "cliffs", "all"] as const;

  for (const view of VIEWS) {
    it(`matches byte for byte on the ${view} view`, () => {
      const req = baseReq({ view });
      expect(renderTiled(req, 32)).toEqual(renderWhole(req));
    });
  }

  it("matches on a ragged grid where the tile size does not divide the image", () => {
    const req = baseReq({ view: "all", width: 100, height: 70 });
    expect(renderTiled(req, 32)).toEqual(renderWhole(req));
  });

  it("matches at a tile size of 1 pixel", () => {
    const req = baseReq({ view: "all", width: 8, height: 8 });
    expect(renderTiled(req, 1)).toEqual(renderWhole(req));
  });

  it("matches when tilesPerPixel is not 1", () => {
    const req = baseReq({ view: "all", width: 32, height: 32, tilesPerPixel: 4 });
    expect(renderTiled(req, 8)).toEqual(renderWhole(req));
  });
```

- [ ] **Step 2: Run the gate**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: PASS, 10 tests.

If any view fails, **stop and report it** - that is a real finding about a renderer having hidden box dependence, not something to paper over by loosening the assertion. The `tilesPerPixel: 4` case is the most likely to expose a halo that was scaled wrongly (it is the only case where the halo is not 2 world tiles). Note it does **not** exercise the floating-point precondition documented in `tiling.ts` - integer origins times an integer scale stay exact; only a fractional `tilesPerPixel` could break that, and nothing in the app produces one.

- [ ] **Step 3: Commit**

```bash
pnpm vp check --fix
git add test/tiledEquality.spec.ts
git commit -F - <<'EOF'
test(preview): prove tiled equals untiled for every view

Extends the gate across all six views plus a ragged grid, a 1px tile
size, and tilesPerPixel 4 - the cases most likely to expose a renderer
with hidden dependence on the render box extent.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 5: The render pool

**Files:**

- Create: `src/components/renderPool.ts`
- Test: `test/renderPool.spec.ts`

**Interfaces:**

- Consumes: `planTiles`, `ImageBox` (Task 2); `ElevationRenderRequest`, `ElevationRenderResult`.
- Produces:
  - `interface TilePaint { dx: number; dy: number; width: number; height: number; buffer: ArrayBuffer }`
  - `interface RenderPoolOptions { size: number; tileSize: number; execute: (req: ElevationRenderRequest, slot: number) => Promise<ElevationRenderResult> }`
  - `interface RenderPool { render(req: Omit<ElevationRenderRequest, "id">, onTile: (t: TilePaint) => void): Promise<boolean>; dispose(): void }`
  - `createRenderPool(opts: RenderPoolOptions): RenderPool`

`render` resolves `true` when every tile was painted, `false` when a newer render superseded it. It rejects if any tile's `execute` rejects.

- [ ] **Step 1: Write the failing test**

Create `test/renderPool.spec.ts`:

```ts
import { describe, it, expect } from "vite-plus/test";
import { createRenderPool, type TilePaint } from "../src/components/renderPool";
import type { ElevationRenderRequest, ElevationRenderResult } from "../src/noise/preview/elevationRenderRequest";

const REQ: Omit<ElevationRenderRequest, "id"> = {
  seed0: 1,
  width: 4,
  height: 4,
  originX: 0,
  originY: 0,
  tilesPerPixel: 1,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
};

/** An execute that resolves immediately with a correctly sized buffer. */
const instant = async (r: ElevationRenderRequest): Promise<ElevationRenderResult> => ({
  id: r.id,
  buffer: new ArrayBuffer(r.width * r.height * 4),
  width: r.width,
  height: r.height,
});

/** An execute whose promises are resolved by hand, one per call. */
function controlled() {
  const calls: {
    req: ElevationRenderRequest;
    slot: number;
    resolve: (r: ElevationRenderResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const execute = (req: ElevationRenderRequest, slot: number) =>
    new Promise<ElevationRenderResult>((resolve, reject) => {
      calls.push({ req, slot, resolve, reject });
    });
  const settle = (i: number) =>
    calls[i].resolve({
      id: calls[i].req.id,
      buffer: new ArrayBuffer(calls[i].req.width * calls[i].req.height * 4),
      width: calls[i].req.width,
      height: calls[i].req.height,
    });
  return { calls, execute, settle };
}

describe("createRenderPool", () => {
  it("executes one request per tile, carrying the tile box and the full image", async () => {
    const seen: ElevationRenderRequest[] = [];
    const pool = createRenderPool({
      size: 2,
      tileSize: 2,
      execute: (r) => {
        seen.push(r);
        return instant(r);
      },
    });
    const painted: TilePaint[] = [];
    const ok = await pool.render(REQ, (t) => painted.push(t));

    expect(ok).toBe(true);
    expect(seen).toHaveLength(4); // 4x4 image at tileSize 2
    expect(painted).toHaveLength(4);
    for (const r of seen) {
      expect(r.width).toBe(2);
      expect(r.height).toBe(2);
      expect(r.fullImage).toEqual({ originX: 0, originY: 0, width: 4, height: 4 });
    }
    expect(seen.map((r) => [r.originX, r.originY])).toEqual([
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ]);
    expect(painted.map((t) => [t.dx, t.dy])).toEqual([
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ]);
  });

  it("gives every request a distinct id", async () => {
    const seen: number[] = [];
    const pool = createRenderPool({
      size: 4,
      tileSize: 2,
      execute: (r) => {
        seen.push(r.id);
        return instant(r);
      },
    });
    await pool.render(REQ, () => {});
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("never runs more than `size` executes at once", async () => {
    const { calls, execute, settle } = controlled();
    const pool = createRenderPool({ size: 2, tileSize: 2, execute });
    const done = pool.render(REQ, () => {});

    await Promise.resolve();
    expect(calls).toHaveLength(2); // 4 tiles, only 2 slots
    settle(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(3);
    settle(1);
    settle(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(4);
    settle(3);
    expect(await done).toBe(true);
  });

  it("dispatches each tile to the slot index it was given", async () => {
    const { calls, execute, settle } = controlled();
    const pool = createRenderPool({ size: 2, tileSize: 2, execute });
    const done = pool.render(REQ, () => {});
    await Promise.resolve();
    expect(calls.map((c) => c.slot).sort()).toEqual([0, 1]);
    for (let i = 0; i < 4; i++) {
      settle(i);
      await Promise.resolve();
      await Promise.resolve();
    }
    await done;
  });

  it("resolves false and stops painting when a newer render supersedes it", async () => {
    const { calls, execute, settle } = controlled();
    const pool = createRenderPool({ size: 1, tileSize: 2, execute });
    const painted: TilePaint[] = [];
    const first = pool.render(REQ, (t) => painted.push(t));
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    // A newer render supersedes the first one before its tile lands.
    void pool.render(REQ, () => {});
    settle(0);

    expect(await first).toBe(false);
    expect(painted).toHaveLength(0);
  });

  it("rejects the whole render when a tile fails, and stops dispatching", async () => {
    const { calls, execute } = controlled();
    const pool = createRenderPool({ size: 1, tileSize: 2, execute });
    const done = pool.render(REQ, () => {});
    await Promise.resolve();
    calls[0].reject(new Error("worker died"));
    await expect(done).rejects.toThrow("worker died");
    expect(calls).toHaveLength(1);
  });

  it("stops an in-flight render when disposed", async () => {
    const { calls, execute, settle } = controlled();
    const pool = createRenderPool({ size: 1, tileSize: 2, execute });
    const painted: TilePaint[] = [];
    const done = pool.render(REQ, (t) => painted.push(t));
    await Promise.resolve();
    pool.dispose();
    settle(0);
    expect(await done).toBe(false);
    expect(painted).toHaveLength(0);
  });

  it("does not spawn more slots than there are tiles", async () => {
    const slots = new Set<number>();
    const pool = createRenderPool({
      size: 16,
      tileSize: 4, // one tile for a 4x4 image
      execute: (r, slot) => {
        slots.add(slot);
        return instant(r);
      },
    });
    await pool.render(REQ, () => {});
    expect(slots).toEqual(new Set([0]));
  });

  it("rejects a non-positive pool size", () => {
    expect(() => createRenderPool({ size: 0, tileSize: 2, execute: instant })).toThrow(/size/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/renderPool.spec.ts`
Expected: FAIL - cannot resolve `../src/components/renderPool`.

- [ ] **Step 3: Write the implementation**

Create `src/components/renderPool.ts`:

```ts
/**
 * Concurrency for the region-tiled renderer: plan a render into tiles, keep at
 * most `size` of them in flight, and hand each finished tile to `onTile` so the
 * caller can paint it immediately.
 *
 * `execute` is the seam. In the app it posts to one of `size` Web Workers (the
 * `slot` argument says which); in tests it calls `runRenderRequest` in-process,
 * which is what lets the tiled-equals-untiled gate run in Node with no Workers.
 */
import { planTiles, type ImageBox } from "../noise/preview/tiling";
import type {
  ElevationRenderRequest,
  ElevationRenderResult,
} from "../noise/preview/elevationRenderRequest";

/** A finished tile, positioned within the full image. */
export interface TilePaint {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer;
}

export interface RenderPoolOptions {
  /** Maximum tiles in flight at once. */
  readonly size: number;
  /** Square tile edge, in pixels. */
  readonly tileSize: number;
  readonly execute: (
    req: ElevationRenderRequest,
    slot: number,
  ) => Promise<ElevationRenderResult>;
}

export interface RenderPool {
  /**
   * Render `req` as tiles, calling `onTile` per finished tile. Resolves true
   * when every tile was painted, false when a newer render (or `dispose`)
   * superseded this one. Rejects if any tile fails.
   */
  render(
    req: Omit<ElevationRenderRequest, "id">,
    onTile: (t: TilePaint) => void,
  ): Promise<boolean>;
  dispose(): void;
}

export function createRenderPool(opts: RenderPoolOptions): RenderPool {
  // Without this, size 0 would dispatch nothing and silently resolve false -
  // a render that looks superseded rather than misconfigured.
  if (!(opts.size > 0)) throw new Error("createRenderPool: size must be positive");

  // Bumped by every new render and by dispose(); slots of an older generation
  // stop dispatching and their results are dropped, so a superseded render can
  // never paint over a newer one.
  let generation = 0;
  let nextId = 1;

  return {
    async render(req, onTile) {
      const gen = ++generation;
      const full: ImageBox = {
        originX: req.originX,
        originY: req.originY,
        width: req.width,
        height: req.height,
        tilesPerPixel: req.tilesPerPixel,
      };
      const fullImage = {
        originX: full.originX,
        originY: full.originY,
        width: full.width,
        height: full.height,
      };
      const queue = planTiles(full, opts.tileSize);

      let next = 0;
      let painted = 0;
      let aborted = false;

      const runSlot = async (slot: number): Promise<void> => {
        for (;;) {
          if (aborted || gen !== generation) return;
          const tile = queue[next++];
          if (!tile) return;
          const result = await opts.execute(
            {
              ...req,
              id: nextId++,
              originX: tile.originX,
              originY: tile.originY,
              width: tile.width,
              height: tile.height,
              fullImage,
            },
            slot,
          );
          if (aborted || gen !== generation) return;
          onTile({
            dx: tile.dx,
            dy: tile.dy,
            width: tile.width,
            height: tile.height,
            buffer: result.buffer,
          });
          painted++;
        }
      };

      // Promise.all attaches a handler to every slot, so a second failure after
      // the first cannot surface as an unhandled rejection.
      await Promise.all(
        Array.from({ length: Math.min(opts.size, queue.length) }, (_, i) =>
          runSlot(i).catch((e: unknown) => {
            aborted = true;
            throw e;
          }),
        ),
      );
      return painted === queue.length;
    },

    dispose() {
      generation++;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vp test test/renderPool.spec.ts`
Expected: PASS.

If the concurrency test's `await Promise.resolve()` counts turn out to be off by a microtask, adjust by adding another `await Promise.resolve()` - do **not** weaken the assertion to a range.

- [ ] **Step 5: Lint and commit**

```bash
pnpm vp check --fix
git add src/components/renderPool.ts test/renderPool.spec.ts
git commit -F - <<'EOF'
feat(preview): add the tile render pool

Plans a render into tiles, keeps at most `size` in flight, and hands each
finished tile to onTile for immediate painting. A generation counter drops
superseded renders so a stale tile can never paint over a newer one, and
`execute` is injectable so the equality gate can run in-process.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 6: Back the renderer with a worker pool

**Files:**

- Modify: `src/components/useElevationPreview.ts`
- Modify: `test/useElevationPreview.spec.ts`

**Interfaces:**

- Consumes: `createRenderPool`, `TilePaint`, `RenderPool` (Task 5).
- Produces:
  - `ElevationRenderer.render(req: Omit<ElevationRenderRequest, "id">, onTile: (t: TilePaint) => void): Promise<boolean>` - **changed signature**.
  - `DEFAULT_TILE_SIZE = 128`
  - `defaultPoolSize(): number`
  - `createElevationRenderer(createWorker?, size?, tileSize?): ElevationRenderer`

**Deviation from the design doc, record it in the task report:** the spec said `ElevationRenderer` would keep its shape. It cannot - progressive painting requires an `onTile` callback, and a superseded render has no buffer to resolve with. The interface now takes `onTile` and resolves to a completion flag. The panel and its tests are updated in Tasks 6 and 7. This is a deliberate, better choice than resolving with a stitched full buffer the panel would immediately throw away.

- [ ] **Step 1: Write the failing test**

Replace the contents of `test/useElevationPreview.spec.ts`:

```ts
import { describe, it, expect, vi } from "vite-plus/test";
import {
  createElevationRenderer,
  defaultPoolSize,
  type WorkerLike,
} from "../src/components/useElevationPreview";
import type { ElevationRenderRequest } from "../src/noise/preview/elevationRenderRequest";

function fakeWorker(): WorkerLike & { posted: ElevationRenderRequest[] } {
  return {
    posted: [],
    postMessage(m: unknown) {
      this.posted.push(m as ElevationRenderRequest);
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
}

const REQ = {
  seed0: 1,
  width: 4,
  height: 4,
  originX: 0,
  originY: 0,
  tilesPerPixel: 1,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
};

/** Answer every request a worker has been posted, in order. */
function drain(w: WorkerLike & { posted: ElevationRenderRequest[] }) {
  for (const req of w.posted.splice(0)) {
    w.onmessage!({
      data: {
        id: req.id,
        buffer: new ArrayBuffer(req.width * req.height * 4),
        width: req.width,
        height: req.height,
      },
    } as MessageEvent);
  }
}

describe("createElevationRenderer", () => {
  it("spreads tiles across one worker per slot and paints each one", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const r = createElevationRenderer(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      2, // pool size
      2, // tile size -> 4 tiles for a 4x4 image
    );

    const painted: { dx: number; dy: number }[] = [];
    const done = r.render(REQ, (t) => painted.push({ dx: t.dx, dy: t.dy }));

    // Two slots start immediately, so exactly two workers exist.
    await Promise.resolve();
    expect(workers).toHaveLength(2);
    for (let i = 0; i < 4; i++) {
      workers.forEach(drain);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await done).toBe(true);
    expect(painted).toHaveLength(4);
    expect(workers).toHaveLength(2); // reused, not recreated per tile
  });

  it("reuses its workers across successive renders", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const r = createElevationRenderer(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      1,
      4, // one tile
    );
    for (let n = 0; n < 3; n++) {
      const done = r.render(REQ, () => {});
      await Promise.resolve();
      workers.forEach(drain);
      expect(await done).toBe(true);
    }
    expect(workers).toHaveLength(1);
  });

  // Regression test for a hang found in review: with one pending entry per slot,
  // a second render overwrote the first render's resolver, so the first render's
  // promise never settled and the panel would stick on "Rendering..." forever.
  it("settles a superseded render instead of stranding it", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const r = createElevationRenderer(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      1,
      4, // one tile per render
    );

    const first = r.render(REQ, () => {});
    await Promise.resolve();
    const firstPosted = workers[0].posted.splice(0);
    expect(firstPosted).toHaveLength(1);

    // Supersede before the first tile comes back.
    const second = r.render(REQ, () => {});
    await Promise.resolve();

    // Now answer both, oldest first, exactly as a real worker would.
    for (const req of [...firstPosted, ...workers[0].posted.splice(0)]) {
      workers[0].onmessage!({
        data: {
          id: req.id,
          buffer: new ArrayBuffer(req.width * req.height * 4),
          width: req.width,
          height: req.height,
        },
      } as MessageEvent);
    }

    expect(await first).toBe(false); // superseded, painted nothing
    expect(await second).toBe(true);
  });

  it("rejects the render when a worker errors", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const r = createElevationRenderer(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      1,
      4,
    );
    const done = r.render(REQ, () => {});
    await Promise.resolve();
    workers[0].onerror!(new Error("boom"));
    await expect(done).rejects.toThrow(/worker/i);
  });

  it("replaces a crashed worker on the next render", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const make = () => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    };
    const r = createElevationRenderer(make, 1, 4);
    const first = r.render(REQ, () => {});
    await Promise.resolve();
    workers[0].onerror!(new Error("boom"));
    await expect(first).rejects.toThrow();
    expect(workers[0].terminate).toHaveBeenCalled();

    const second = r.render(REQ, () => {});
    await Promise.resolve();
    expect(workers).toHaveLength(2);
    drain(workers[1]);
    expect(await second).toBe(true);
  });

  it("terminates every worker on dispose and rejects the in-flight render", async () => {
    const workers: (WorkerLike & { posted: ElevationRenderRequest[] })[] = [];
    const r = createElevationRenderer(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      2,
      2,
    );
    const done = r.render(REQ, () => {});
    await Promise.resolve();
    r.dispose();
    // A terminated worker will never answer, so the in-flight tile's promise
    // must be rejected or the render would hang forever.
    await expect(done).rejects.toThrow(/disposed/);
    for (const w of workers) expect(w.terminate).toHaveBeenCalled();
  });
});

describe("defaultPoolSize", () => {
  it("leaves one core for the main thread", () => {
    expect(defaultPoolSize(12)).toBe(11);
    expect(defaultPoolSize(1)).toBe(1);
    // Unknown core count falls back to 4 cores, so 3 workers.
    expect(defaultPoolSize(undefined)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/useElevationPreview.spec.ts`
Expected: FAIL - `defaultPoolSize` is not exported and `render` has the wrong arity.

- [ ] **Step 3: Write the implementation**

Replace the contents of `src/components/useElevationPreview.ts`:

```ts
import { onBeforeUnmount } from "vue";
import type {
  ElevationRenderRequest,
  ElevationRenderResult,
} from "../noise/preview/elevationRenderRequest";
import { createRenderPool, type RenderPool, type TilePaint } from "./renderPool";

/** The minimal Worker surface the renderer uses, so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface ElevationRenderer {
  /**
   * Render tiled across the pool, calling `onTile` per finished tile so the
   * caller can paint progressively. Resolves true when every tile landed, false
   * when a newer render or dispose() superseded this one.
   */
  render(
    req: Omit<ElevationRenderRequest, "id">,
    onTile: (t: TilePaint) => void,
  ): Promise<boolean>;
  dispose(): void;
}

/** Square tile edge in pixels. 128 gives 64 tiles at the fixed 1024px preview. */
export const DEFAULT_TILE_SIZE = 128;

/**
 * One worker per core, less one so the main thread stays free to blit tiles and
 * keep the UI responsive. Falls back to 4 cores when the browser will not say.
 *
 * `cores` is a required parameter rather than a defaulted one: passing
 * `undefined` to a defaulted parameter silently re-applies the default, which
 * would make the fallback untestable.
 */
export function defaultPoolSize(cores: number | undefined): number {
  return Math.max(1, (cores ?? 4) - 1);
}

function createRenderWorker(): WorkerLike {
  // A real Worker's onerror is ((ev: ErrorEvent) => any) | null, narrower than
  // WorkerLike's ((e: unknown) => void) | null (kept broad so tests can invoke
  // it with any value) - the real Worker structurally provides everything
  // WorkerLike needs, so assert the narrowing here rather than loosen the type.
  return new Worker(new URL("../noise/preview/elevationRender.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

/**
 * Own a pool of `size` workers - one per pool slot, created lazily on first use
 * and reused for the renderer's lifetime - and drive them through a RenderPool.
 * Each slot runs one tile at a time, so a slot needs only a single pending
 * entry. Lifecycle-free; callers own dispose().
 */
export function createElevationRenderer(
  createWorker: () => WorkerLike = createRenderWorker,
  size: number = defaultPoolSize(
    typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
  ),
  tileSize: number = DEFAULT_TILE_SIZE,
): ElevationRenderer {
  const workers: (WorkerLike | null)[] = Array.from({ length: size }, () => null);

  // Keyed by request id, NOT by slot. A slot can legitimately hold two in-flight
  // tiles at once: when a new render supersedes an older one, the older tile is
  // still awaiting its worker while the newer tile is dispatched into the same
  // slot. A one-entry-per-slot map would overwrite the older tile's resolver,
  // stranding its promise forever so the superseded render never settles and the
  // panel sticks on "Rendering..." - a real hang, found in review. A worker
  // handles its messages in order, so both entries resolve in turn.
  const pending = new Map<
    number,
    {
      slot: number;
      resolve: (r: ElevationRenderResult) => void;
      reject: (e: unknown) => void;
    }
  >();

  function rejectSlot(slot: number, message: string) {
    for (const [id, entry] of [...pending]) {
      if (entry.slot !== slot) continue;
      pending.delete(id);
      entry.reject(new Error(message));
    }
  }

  function dropWorker(slot: number) {
    const w = workers[slot];
    workers[slot] = null;
    if (w) w.terminate();
  }

  function ensureWorker(slot: number): WorkerLike {
    const existing = workers[slot];
    if (existing) return existing;
    const w = createWorker();
    w.onmessage = (e: MessageEvent) => {
      const result = e.data as ElevationRenderResult;
      const entry = pending.get(result.id);
      // An id with no pending entry is a reply to an already-settled request.
      if (!entry) return;
      pending.delete(result.id);
      entry.resolve(result);
    };
    // A worker crash would otherwise leave its tiles' promises pending forever.
    // Every tile this slot holds fails, not just the newest.
    w.onerror = () => {
      dropWorker(slot);
      rejectSlot(slot, "Elevation render worker error");
    };
    workers[slot] = w;
    return w;
  }

  const pool: RenderPool = createRenderPool({
    size,
    tileSize,
    execute: (req, slot) =>
      new Promise<ElevationRenderResult>((resolve, reject) => {
        pending.set(req.id, { slot, resolve, reject });
        ensureWorker(slot).postMessage(req);
      }),
  });

  return {
    render: (req, onTile) => pool.render(req, onTile),
    dispose() {
      pool.dispose();
      for (let slot = 0; slot < size; slot++) {
        dropWorker(slot);
        rejectSlot(slot, "Elevation renderer disposed");
      }
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vp test test/useElevationPreview.spec.ts`
Expected: PASS.

On the dispose contract: a terminated worker never answers, so its tile's promise would stay pending forever and `render` would never settle. `dispose()` therefore rejects every pending tile, which makes an in-flight `render` **reject** rather than resolve `false`. That is why the test asserts a rejection. The panel only disposes on unmount, so the resulting rejection lands in `generate()`'s `catch` on a component that is already gone - harmless.

- [ ] **Step 5: Lint and commit**

```bash
pnpm vp check --fix
git add src/components/useElevationPreview.ts test/useElevationPreview.spec.ts
git commit -F - <<'EOF'
feat(preview): back the renderer with a worker pool

One worker per pool slot, created lazily and reused across renders, each
running a single tile at a time so a slot needs only one pending entry. A
crashed worker is terminated and replaced on the next render.

render() now takes an onTile callback and resolves to a completion flag -
a deviation from the design doc, which assumed the old signature could be
kept. Progressive painting needs the callback, and a superseded render has
no buffer to resolve with.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 7: Paint tiles progressively in the panel

**Files:**

- Modify: `src/components/ElevationPreviewPanel.vue` (the `generate()` function, currently around lines 63-120)
- Modify: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**

- Consumes: `ElevationRenderer.render(req, onTile)`, `TilePaint` (Task 6).
- Produces: nothing importable.

The canvas is `v-show`, not `v-if`, so `canvas.value` is non-null as soon as the component mounts - the 2D context can be taken before the first tile arrives.

- [ ] **Step 1: Write the failing test**

First, the existing `stubCanvas` helper returns a context stub with only `putImageData` on it. The new `generate()` also calls `clearRect`, which would throw. Update it in place:

```ts
function stubCanvas() {
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  return putImageData;
}
```

Then replace the existing `okRenderer` function with a tile-emitting fake:

```ts
/** Emits four 512x512 tiles covering the 1024x1024 preview, then completes. */
function okRenderer(): ElevationRenderer {
  return {
    render: vi.fn(async (_req, onTile) => {
      for (const [dx, dy] of [
        [0, 0],
        [512, 0],
        [0, 512],
        [512, 512],
      ]) {
        onTile({ dx, dy, width: 512, height: 512, buffer: new ArrayBuffer(512 * 512 * 4) });
      }
      return true;
    }),
    dispose: vi.fn(),
  };
}
```

Every existing assertion of the form `expect(putImageData).toHaveBeenCalledOnce()` must become `expect(putImageData).toHaveBeenCalledTimes(4)`.

Add this test inside the main `describe`:

```ts
  it("blits each tile at its own offset as it arrives", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(putImageData).toHaveBeenCalledTimes(4);
    const offsets = putImageData.mock.calls.map((c) => [c[1], c[2]]);
    expect(offsets).toEqual([
      [0, 0],
      [512, 0],
      [0, 512],
      [512, 512],
    ]);
    // The elapsed readout is stamped once, after the last tile.
    expect(w.find('[data-test="preview-elapsed"]').exists()).toBe(true);
  });

  it("blits each tile at its own offset even when they arrive out of order", async () => {
    const putImageData = stubCanvas();
    // Tiles land bottom-right first: a panel that tracked "the last offset" or
    // shared one tile object across callbacks would put them in the wrong place.
    const renderer: ElevationRenderer = {
      render: vi.fn(async (_req, onTile) => {
        for (const [dx, dy] of [
          [512, 512],
          [0, 512],
          [512, 0],
          [0, 0],
        ]) {
          onTile({ dx, dy, width: 512, height: 512, buffer: new ArrayBuffer(512 * 512 * 4) });
        }
        return true;
      }),
      dispose: vi.fn(),
    };
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(putImageData.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [512, 512],
      [0, 512],
      [512, 0],
      [0, 0],
    ]);
  });

  it("does not stamp the elapsed readout for a superseded render", async () => {
    stubCanvas();
    const renderer: ElevationRenderer = {
      render: vi.fn(async () => false),
      dispose: vi.fn(),
    };
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="preview-elapsed"]').exists()).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL - the panel still calls `render` with one argument and blits once from a returned buffer.

- [ ] **Step 3: Rewrite `generate()`**

In `src/components/ElevationPreviewPanel.vue`, replace the body of `generate()` from `loading.value = true;` through the closing `}` of the `try`/`catch`/`finally` with:

```ts
  loading.value = true;
  error.value = null;
  elapsedMs.value = null;
  const startedAt = performance.now();
  try {
    const el = canvas.value;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    // Size and clear up front: tiles arrive one at a time and paint straight
    // into this canvas, so it has to be the right size before the first lands.
    el.width = PREVIEW_PX;
    el.height = PREVIEW_PX;
    g.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);

    const completed = await renderer.render(
      {
        seed0,
        mapType: info.mapType,
        view: effectiveView.value,
        width: PREVIEW_PX,
        height: PREVIEW_PX,
        originX: -half,
        originY: -half,
        tilesPerPixel: TILES_PER_PIXEL,
        waterLevel: info.ctx.waterLevel,
        segmentationMultiplier: info.ctx.segmentationMultiplier,
        startingPositions: info.ctx.startingPositions,
        moistureFrequency: info.ctx.moistureFrequency,
        moistureBias: info.ctx.moistureBias,
        auxFrequency: info.ctx.auxFrequency,
        auxBias: info.ctx.auxBias,
        startingAreaMoistureSize: info.ctx.startingAreaMoistureSize,
        startingAreaMoistureFrequency: info.ctx.startingAreaMoistureFrequency,
        resourceControls: info.resourceControls,
        enemyControls: info.enemyControls,
        cliffControls: info.cliffControls,
        cliffSettings: info.cliffSettings,
      },
      (tile) => {
        g.putImageData(
          new ImageData(new Uint8ClampedArray(tile.buffer), tile.width, tile.height),
          tile.dx,
          tile.dy,
        );
        // Reveal the canvas as soon as there is anything on it, so the fill-in
        // is visible rather than hidden until the last tile.
        hasRendered.value = true;
      },
    );
    if (completed) {
      // Measured across the whole round trip (dispatch, compute, transfer,
      // blit) - that is the latency a user feels, and what tiling had to move.
      elapsedMs.value = Math.round(performance.now() - startedAt);
    }
  } catch {
    error.value = "Preview failed.";
  } finally {
    loading.value = false;
  }
```

- [ ] **Step 4: Run the panel tests**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm vp test`
Expected: PASS. Every pre-existing test must still pass - if `previewPanel.spec.ts`, `app.spec.ts`, or `devMode.spec.ts` construct an `ElevationRenderer`, update those fakes to the two-argument `render` as well.

- [ ] **Step 6: Lint and commit**

```bash
pnpm vp check --fix
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -F - <<'EOF'
feat(preview): paint the preview tile by tile

The canvas is sized and cleared up front, then each tile blits at its own
offset the moment it lands, so the map fills in instead of appearing after
a multi-second pause. The elapsed readout is stamped only when the render
actually completed, so a superseded one leaves it blank.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

### Task 8: Split scene from geometry - CANCELLED, DO NOT IMPLEMENT

**Task 1 measured ratios of 1.035 (terrain) and 1.069 (all), both under the 1.15 threshold. This task is struck.** It is kept below only as a record of what was considered and why it was rejected, so a later reader does not re-derive it. Skip straight to Task 9.

A review of this section while it was still live also found two defects worth recording, in case it is ever revived: the `sceneKey` "fails loudly" comment was false (the project has no type-check step, so a newly added request field would be silently omitted from the key and tiles of different scenes would share a stale resolver stack - it needed to be a test asserting `Object.keys` against an allowlist, not a comment), and neither proposed test actually exercised a cache **hit**, so the one risk that mattered - mutable state accumulating in a reused dep - had zero coverage.

---

<details>
<summary>Rejected design, retained for the record</summary>

Each tile currently rebuilds every resolver. This task builds them once per worker per settings-change instead, capping duplication at pool size rather than tile count. The approach is additive: each renderer gains an optional pre-built dependency, defaulting to building its own, so every existing test keeps passing untouched.

**Files:**

- Create: `src/noise/preview/scene.ts`
- Modify: `src/noise/preview/renderTerrain.ts`, `renderResources.ts`, `renderEnemies.ts`, `renderCliffs.ts`
- Modify: `src/noise/preview/elevationRender.worker.ts`
- Test: `test/scene.spec.ts` (create)

**Interfaces:**

- Consumes: `ElevationRenderRequest`, `ElevationRenderResult`, `runRenderRequest`.
- Produces:
  - `sceneKey(req: ElevationRenderRequest): string` - stable serialization of every non-geometric field.
  - `makeScene(req: ElevationRenderRequest): Scene` where `interface Scene { render(req: ElevationRenderRequest): ElevationRenderResult }`.
  - `runRenderRequestCached(req: ElevationRenderRequest): ElevationRenderResult` - module-scoped one-entry memo keyed by `sceneKey`.

- [ ] **Step 1: Write the failing test**

Create `test/scene.spec.ts`:

```ts
import { describe, it, expect } from "vite-plus/test";
import {
  runRenderRequestCached,
  sceneKey,
} from "../src/noise/preview/scene";
import {
  runRenderRequest,
  type ElevationRenderRequest,
} from "../src/noise/preview/elevationRenderRequest";

const req = (over: Partial<ElevationRenderRequest> = {}): ElevationRenderRequest => ({
  id: 0,
  seed0: 123456,
  width: 32,
  height: 32,
  originX: -512,
  originY: -512,
  tilesPerPixel: 1,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
  mapType: "nauvis",
  view: "all",
  ...over,
});

describe("sceneKey", () => {
  it("ignores geometry, so tiles of one render share a key", () => {
    expect(sceneKey(req({ originX: 0, originY: 64, width: 8, height: 8, id: 7 }))).toBe(
      sceneKey(req()),
    );
  });

  it("changes when a non-geometric input changes", () => {
    expect(sceneKey(req({ seed0: 999 }))).not.toBe(sceneKey(req()));
    expect(sceneKey(req({ view: "terrain" }))).not.toBe(sceneKey(req()));
    expect(sceneKey(req({ enemyControls: { frequency: 2, size: 1 } }))).not.toBe(sceneKey(req()));
  });
});

describe("runRenderRequestCached", () => {
  it("produces byte-identical output to the uncached path", () => {
    for (const view of ["elevation", "terrain", "resources", "enemies", "cliffs", "all"] as const) {
      const r = req({ view });
      expect(new Uint8ClampedArray(runRenderRequestCached(r).buffer)).toEqual(
        new Uint8ClampedArray(runRenderRequest(r).buffer),
      );
    }
  });

  it("stays correct when the scene changes between calls", () => {
    const a = req({ seed0: 1 });
    const b = req({ seed0: 2 });
    const firstA = new Uint8ClampedArray(runRenderRequestCached(a).buffer);
    runRenderRequestCached(b);
    const secondA = new Uint8ClampedArray(runRenderRequestCached(a).buffer);
    expect(secondA).toEqual(firstA);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/scene.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/preview/scene`.

- [ ] **Step 3: Add optional injected dependencies to the renderers**

In `src/noise/preview/renderTerrain.ts`, add to `RenderTerrainOptions`:

```ts
  /**
   * Pre-built resolver stack, so a tiled render builds it once per worker
   * instead of once per tile. Omitted means build it here, which is what every
   * single-shot caller does.
   */
  readonly deps?: {
    readonly resolve: ReturnType<typeof makeTileResolver>;
    readonly elevationAt: ReturnType<typeof makeElevationNauvis>;
    readonly catalog: ReturnType<typeof makeTileCatalog>;
  };
```

and replace the three construction lines in the body:

```ts
  const { resolve, elevationAt, catalog } =
    opts.deps ??
    {
      resolve: makeTileResolver({ seed0, ...opts.ctx }),
      elevationAt: makeElevationNauvis({
        seed0,
        segmentationMultiplier: opts.ctx?.segmentationMultiplier,
        startingPositions: opts.ctx?.startingPositions,
      }),
      catalog: makeTileCatalog(seed0),
    };
```

Apply the same pattern to the other three:

- `renderResources.ts`: `readonly deps?: { readonly resolve: ReturnType<typeof makeResourceResolver> }`, replacing `const resolve = makeResourceResolver({...})` with `const resolve = opts.deps?.resolve ?? makeResourceResolver({...})`.
- `renderEnemies.ts`: `readonly deps?: { readonly field: ReturnType<typeof makeEnemyBaseField> }`, replacing `const f = makeEnemyBaseField({...})` with `const f = opts.deps?.field ?? makeEnemyBaseField({...})`.
- `renderCliffs.ts`: `readonly deps?: { readonly placement: ReturnType<typeof makeCliffPlacement> }`, replacing `const placement = makeCliffPlacement({...})` with `const placement = opts.deps?.placement ?? makeCliffPlacement({...})`.

- [ ] **Step 4: Run the renderer tests to confirm nothing regressed**

Run: `pnpm vp test test/renderTerrain.spec.ts test/renderResources.spec.ts test/renderEnemies.spec.ts test/renderCliffs.spec.ts test/tiledEquality.spec.ts`
Expected: PASS - `deps` is optional, so behavior is unchanged.

- [ ] **Step 5: Write the scene module**

Create `src/noise/preview/scene.ts`:

```ts
/**
 * Scene caching for the region-tiled renderer. Every tile of one render shares
 * the same non-geometric inputs (seed, view, controls, ctx), so the resolver
 * stack they need is identical - building it per tile repeats work 64 times.
 *
 * `runRenderRequestCached` keeps the last scene in module scope, so a worker
 * builds it at most once per settings-change and duplication is capped at pool
 * size rather than tile count. A second Generate with unchanged settings then
 * costs only the pixel sweep.
 */
import { makeCliffPlacement } from "../cliffs/cliffPlacement";
import { makeEnemyBaseField } from "../enemies/enemyBaseField";
import { makeResourceResolver } from "../resources/resolveResource";
import { makeElevationNauvis } from "../expressions/elevationNauvis";
import { makeTileCatalog } from "../tiles/catalog";
import { makeTileResolver } from "../tiles/resolve";
import {
  runRenderRequest,
  type ElevationRenderRequest,
  type ElevationRenderResult,
} from "./elevationRenderRequest";

/**
 * Everything that is NOT geometry. Listing the fields explicitly (rather than
 * deleting the geometric ones) means a newly added request field fails loudly
 * in review instead of silently sharing a stale scene.
 */
function sceneFields(req: ElevationRenderRequest): unknown[] {
  return [
    req.seed0,
    req.view ?? "elevation",
    req.mapType ?? "lakes",
    req.waterLevel,
    req.segmentationMultiplier,
    req.startingPositions,
    req.startingLakePositions ?? null,
    req.moistureFrequency ?? null,
    req.moistureBias ?? null,
    req.auxFrequency ?? null,
    req.auxBias ?? null,
    req.startingAreaMoistureSize ?? null,
    req.startingAreaMoistureFrequency ?? null,
    req.resourceControls ?? null,
    req.enemyControls ?? null,
    req.cliffControls ?? null,
    req.cliffSettings ?? null,
  ];
}

/** Stable key over every non-geometric field of a request. */
export function sceneKey(req: ElevationRenderRequest): string {
  return JSON.stringify(sceneFields(req));
}

export interface Scene {
  render(req: ElevationRenderRequest): ElevationRenderResult;
}

/**
 * Build the resolver stack once for `req`'s scene. Only the resolvers the
 * request's view actually uses are built - an elevation-only render must not pay
 * for the tile catalog or the ore resolver.
 */
export function makeScene(req: ElevationRenderRequest): Scene {
  const view = req.view ?? "elevation";
  const terrainish =
    view === "terrain" ||
    view === "resources" ||
    view === "enemies" ||
    view === "cliffs" ||
    view === "all";
  if (!terrainish) {
    // The elevation path builds one cheap expression per render; nothing to hoist.
    return { render: (r) => runRenderRequest(r) };
  }

  const ctx = {
    segmentationMultiplier: req.segmentationMultiplier,
    startingPositions: req.startingPositions,
    moistureFrequency: req.moistureFrequency,
    moistureBias: req.moistureBias,
    auxFrequency: req.auxFrequency,
    auxBias: req.auxBias,
    startingAreaMoistureSize: req.startingAreaMoistureSize,
    startingAreaMoistureFrequency: req.startingAreaMoistureFrequency,
  };

  const terrainDeps = {
    resolve: makeTileResolver({ seed0: req.seed0, ...ctx }),
    elevationAt: makeElevationNauvis({
      seed0: req.seed0,
      segmentationMultiplier: req.segmentationMultiplier,
      startingPositions: req.startingPositions,
    }),
    catalog: makeTileCatalog(req.seed0),
  };

  const resourceDeps =
    view === "resources" || view === "all"
      ? {
          resolve: makeResourceResolver({
            seed0: req.seed0,
            controls: req.resourceControls ?? {},
            startingPositions: req.startingPositions,
            segmentationMultiplier: req.segmentationMultiplier,
            waterLevel: req.waterLevel,
            startingLakePositions: req.startingLakePositions,
          }),
        }
      : undefined;

  const enemyDeps =
    view === "enemies" || view === "all"
      ? {
          field: makeEnemyBaseField({
            seed0: req.seed0,
            controls: req.enemyControls ?? { frequency: 1, size: 1 },
            startingPositions: req.startingPositions,
          }),
        }
      : undefined;

  const cliffDeps =
    view === "cliffs" || view === "all"
      ? {
          placement: makeCliffPlacement({
            seed0: req.seed0,
            controls: req.cliffControls ?? { frequency: 1, continuity: 1 },
            settings: req.cliffSettings ?? {
              cliffElevation0: 10,
              cliffElevationInterval: 40,
              richness: 1,
            },
            segmentationMultiplier: req.segmentationMultiplier,
            waterLevel: req.waterLevel,
            startingPositions: req.startingPositions,
            startingLakePositions: req.startingLakePositions,
          }),
        }
      : undefined;

  return {
    render: (r) =>
      runRenderRequest({ ...r, terrainDeps, resourceDeps, enemyDeps, cliffDeps }),
  };
}

let cached: { key: string; scene: Scene } | null = null;

/** `runRenderRequest`, reusing the last scene when the non-geometric inputs match. */
export function runRenderRequestCached(req: ElevationRenderRequest): ElevationRenderResult {
  const key = sceneKey(req);
  if (!cached || cached.key !== key) cached = { key, scene: makeScene(req) };
  return cached.scene.render(req);
}
```

- [ ] **Step 6: Thread the deps through the request**

Add these four optional fields to `ElevationRenderRequest` in `elevationRenderRequest.ts`, documented as internal:

```ts
  /**
   * Pre-built resolver stacks, supplied only by `scene.ts` when a worker renders
   * many tiles of one scene. Never set by the panel and never serialized across
   * postMessage - they are attached inside the worker, after the request lands.
   */
  terrainDeps?: RenderTerrainOptions["deps"];
  resourceDeps?: RenderResourcesOptions["deps"];
  enemyDeps?: RenderEnemiesOptions["deps"];
  cliffDeps?: RenderCliffsOptions["deps"];
```

Import those option types at the top of the file, and pass each through in `runRenderRequest`: `deps: req.terrainDeps` on the `renderTerrain` call, `deps: req.resourceDeps` on `renderResources`, `deps: req.enemyDeps` on `renderEnemies`, `deps: req.cliffDeps` on `renderCliffs`.

- [ ] **Step 7: Use the cached path in the worker**

Replace `src/noise/preview/elevationRender.worker.ts`:

```ts
/// <reference lib="webworker" />
import { runRenderRequestCached } from "./scene";
import type { ElevationRenderRequest } from "./elevationRenderRequest";

self.onmessage = (e: MessageEvent<ElevationRenderRequest>) => {
  // Cached, not plain runRenderRequest: this worker renders many tiles of one
  // scene in a row, and rebuilding the resolver stack per tile is the dominant
  // cost the region-tiling design measured.
  const result = runRenderRequestCached(e.data);
  self.postMessage(result, [result.buffer]);
};
```

- [ ] **Step 8: Run the scene tests and the equality gate**

Run: `pnpm vp test test/scene.spec.ts test/tiledEquality.spec.ts`
Expected: PASS. The equality gate still goes through the uncached `runRenderRequest`, so add one case to `test/tiledEquality.spec.ts` that tiles through `runRenderRequestCached` instead and compares to the uncached whole render - that is what proves the cache cannot leak state between tiles.

- [ ] **Step 9: Re-run the overhead measurement**

Run: `pnpm perf`
Expected: the `ratio` lines are unchanged (they exercise `runRenderRequest`, not the cached path). Record the new numbers by temporarily pointing the tiled loop at `runRenderRequestCached` and reporting both, so the task report shows the improvement the cache actually bought.

- [ ] **Step 10: Full suite, lint, commit**

```bash
pnpm vp test
pnpm vp check --fix
git add src/noise/preview/ test/scene.spec.ts test/tiledEquality.spec.ts
git commit -F - <<'EOF'
perf(preview): build the resolver stack once per worker, not per tile

Every tile of one render shares its non-geometric inputs, so the resolver
stack is identical across them. The worker now memoizes the last scene by
a key over those inputs, capping setup duplication at pool size instead of
tile count. Renderers take optional pre-built deps, so every single-shot
caller and existing test is unaffected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

</details>

---

### Task 9: Verify in the browser and record the result

**Files:**

- Modify: `docs/noise/client-preview-ROADMAP.md`

**Interfaces:**

- Consumes: everything above.
- Produces: measured before/after numbers in the roadmap.

- [ ] **Step 1: Run the full suite**

Run: `pnpm vp test`
Expected: PASS, with the new `tiling`, `renderPool`, `tiledEquality` (and `scene`, if Task 8 ran) files included.

- [ ] **Step 2: Start the dev server**

Run: `pnpm vp dev`
Expected: serves on `http://localhost:5173`.

- [ ] **Step 3: Measure the composite render in the browser**

Open `http://localhost:5173/?dev=1`, leave the default preset (Nauvis), make sure the view is "All", click Generate, and read the elapsed-ms readout in the toolbar. Do it three times and take the median.

Baselines to beat, all browser-measured at 1024x1024, 1 tile/pixel, seed 123456: all-composite ~12,500ms, terrain ~9,100ms, elevation ~1,700ms. Record the new median for all three views.

Report the numbers honestly. If the composite speedup is below 3x, say so and report the measured value rather than describing the change as a success - a disappointing number is a finding, and the likely cause is per-tile setup (Task 8) or too few tiles.

- [ ] **Step 4: Check the fill-in is visible and the image is right**

Watch one Generate at the "All" view and confirm tiles appear progressively rather than all at once. Then compare the finished image against the pre-change render (`git stash` is not needed - the equality gate already proves pixel identity; this is a check for anything structural the small test region cannot show, such as a mis-stitched tile offset). Confirm there are no visible seams, no blank tiles, and no duplicated regions.

- [ ] **Step 5: Update the roadmap**

In `docs/noise/client-preview-ROADMAP.md`, mark the Milestone 5 tiling item done and add the measured before/after table:

```markdown
| view      | single worker | tiled (N workers) |
| --------- | ------------- | ----------------- |
| elevation | ~1,700ms      | <measured>        |
| terrain   | ~9,100ms      | <measured>        |
| all       | ~12,500ms     | <measured>        |
```

Fill in the real measured values - do not leave the placeholders.

- [ ] **Step 6: Commit**

```bash
pnpm vp check --fix
git add docs/noise/client-preview-ROADMAP.md
git commit -F - <<'EOF'
docs(preview): record the measured region-tiling speedup

Marks the Milestone 5 tiling item done and records browser-measured
before/after numbers for the elevation, terrain and composite views.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iddrFzgnNsqpgH2XuBzrB
EOF
```

---

## Self-Review Notes

Checked against the design doc:

- Progressive paint - Task 7.
- Over-decompose plus work queue - Tasks 2 and 5.
- Transferables, no SharedArrayBuffer - Task 6 (the worker already transfers its buffer; no `_headers` change anywhere in this plan).
- Cliff halo clamped to the image box - Task 3, with the exactness derivation stated.
- Phase A measurement gating phase B - Tasks 1 and 8.
- Byte-identity gate across all views, proven able to fail - Tasks 3 and 4.
- Browser perf measurement against the ~12.5s baseline - Task 9.

Known deviation from the spec, called out where it happens: `ElevationRenderer.render` changes signature (Task 6). The spec claimed the shape could be preserved; progressive painting makes that impossible.

## External Review - findings applied

A reviewer with no context on this work read the plan against the source. Applied:

1. **Confirmed hang (Task 6).** One pending entry per slot meant a second render overwrote the first render's resolver, stranding its promise so a superseded render never settled and the panel would stick on "Rendering..." forever. Latent today only because the Generate button is disabled while loading. Fixed by keying pending requests on request id rather than slot, since a slot legitimately holds two in-flight tiles across a supersede. Regression test added.
2. **Untested halo clamp (Task 3).** The equality gate pins the widening but not the clamp - deleting the clamp only changes pixels by luck. Added Step 6a: `cliffCellQueryBox` is now exported and unit-tested for both the widened and the clamped sides.
3. **Elevation view unmeasured (Task 1).** The gate benched only `terrain` and `all`, then Task 8 asserted without evidence that the elevation path had "nothing to hoist" - contradicted by `renderElevation.ts`'s own docstring about heavy octave closures and by `computeStartingLakes` running per construction. `elevation` was added to the benchmark.
4. **Weak seam search (Task 3, Step 1).** The old search checked X and Y straddles on possibly different cells and ignored whether the clipped mark landed on water, so a "found" region could still yield a gate that passes without the halo. Replaced with a search on the actual criterion: haloless tiling differing byte-wise from the whole render.
5. **Perf output clobbered (Task 1).** The block overwrote `perf-result.txt` with the bare accumulated rows, dropping the header and summary the first block wrote. Now appends.
6. Minor: `size: 0` guard on `createRenderPool`; the floating-point precondition for byte-identity documented in `tiling.ts`; an out-of-order tile test at the panel level, which the design doc asked for and the plan had omitted.

Verified by the reviewer and holding up, so not changed: the halo derivation is exact on both sides (checked against `placedCells`' inclusive-lower/exclusive-upper filter and `renderCliffs`' `Math.floor`, including at `tilesPerPixel: 4` with the half-integer cell-center Y); all four layer renderers are genuinely pure per-pixel functions of world coordinates, with every cache region-keyed on world coordinates rather than the render box; widening the cell query returns a strict superset with unchanged per-cell decisions; and the microtask ordering in the concurrency tests is sound.

Findings 4, 5 and 11 of the review concerned Task 8 only and are moot now that the measurement cancelled it; they are summarized in that section for the record.

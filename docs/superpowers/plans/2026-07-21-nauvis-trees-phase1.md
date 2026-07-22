# Nauvis Trees (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Nauvis forests in the client-side preview by porting the 15 tree
species probability fields and compositing them as a density-shaded green overlay.

**Architecture:** All 15 species share one expression shape, so this is a
15-row catalog plus one builder (mirroring `src/noise/resources/`), producing a
single `(x, y) => density` closure. A new `renderTrees` overlay alpha-blends the
game's own tree chart color over the terrain image, exactly as `renderResources`
overlays ore. Every field is validated against the real game through the existing
`test/oracle` harness.

**Tech Stack:** TypeScript 6.0.3, Vue 3 + Pinia, Vite+ (`pnpm vp test`), the
existing `src/noise/` primitive library (`basisNoise`, `multioctaveNoise`,
`quickMultioctaveNoise`), the `test/oracle` headless-Factorio harness.

**Spec:** `docs/superpowers/specs/2026-07-21-nauvis-trees-design.md`

## Global Constraints

- Branch: **`feat/nauvis-trees`**. Do not commit to `main`.
- Game data source: **`~/GitHub/factorio-data` @ tag 2.1.11** only. Never
  `~/Downloads/factorio 4/data` (2.0.77, stale).
- Run tests with `pnpm vp test` (never a bare `vp` - `devEngines` pins pnpm).
  Single file: `pnpm vp test test/<file>.spec.ts`.
- Lint/format: `pnpm vp check --fix`. There is no `.vue` type-check step.
- Never edit a fixture or an expected value to make a test pass. A mismatch is a
  real finding - stop and report it.
- Oracle-backed captures need a local Factorio install and are gated on
  `oracleAvailable()`; the committed JSON fixtures let the specs run without it.
- Use hyphens (`-`) in all prose, never em dashes or en dashes.
- Out of scope, do not build: per-tile placement stipple, decoratives, worm/fish
  autoplacers, non-Nauvis planets, tree richness.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/noise/trees/asymmetricRamps.ts` (create) | The `asymmetric_ramps` noise function |
| `src/noise/trees/treeCatalog.ts` (create) | The 15 species parameter rows + their crc32 seed1s |
| `src/noise/trees/treeShared.ts` (create) | `tree_small_noise` and the `trees_forest_path_cutout` chain |
| `src/noise/trees/treeField.ts` (create) | `makeTreeDensity` - the per-pixel max over species |
| `src/noise/preview/renderTrees.ts` (create) | The alpha-blended overlay |
| `src/noise/preview/elevationRenderRequest.ts` (modify) | `view: "trees"` + dispatch |
| `src/model/elevationPreviewCtx.ts` (modify) | Derive `treeControls` from the preset |
| `src/components/ElevationPreviewPanel.vue` (modify) | The Trees view toggle |
| `test/oracle/capture.ts` (modify) | Two new fixture capture functions |

---

### Task 1: The `asymmetric_ramps` helper

The single new noise function. Pure math, no oracle needed - it is validated
end-to-end by the species fixtures in Task 5.

**Files:**
- Create: `src/noise/trees/asymmetricRamps.ts`
- Test: `test/asymmetricRamps.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `asymmetricRamps(input: number, fromBottom: number, fromTop: number, toTop: number, toBottom: number): number`

- [ ] **Step 1: Write the failing test**

Create `test/asymmetricRamps.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { asymmetricRamps } from "../src/noise/trees/asymmetricRamps";

// core/prototypes/noise-functions.lua:114-124 -
//   min((input - from_top) / (from_top - from_bottom),
//       (to_top - input) / (to_bottom - to_top))
// The _tops are where the output crosses 0; the _bottoms are where it crosses -1.
// There is deliberately NO clamp - it is designed to sit inside a shared min().
describe("asymmetricRamps", () => {
  it("crosses 0 at from_top on the rising edge", () => {
    expect(asymmetricRamps(10, 0, 10, 14, 15)).toBe(0);
  });

  it("crosses 0 at to_top on the falling edge", () => {
    expect(asymmetricRamps(14, 0, 10, 14, 15)).toBe(0);
  });

  it("crosses -1 at from_bottom", () => {
    expect(asymmetricRamps(0, 0, 10, 14, 15)).toBe(-1);
  });

  it("crosses -1 at to_bottom", () => {
    expect(asymmetricRamps(15, 0, 10, 14, 15)).toBe(-1);
  });

  it("is positive between the tops, peaking midway", () => {
    expect(asymmetricRamps(12, 0, 10, 14, 15)).toBeCloseTo(0.2, 12);
  });

  it("keeps falling below -1 outside the bottoms (no clamp)", () => {
    expect(asymmetricRamps(-10, 0, 10, 14, 15)).toBe(-2);
  });

  it("takes the min of the two edges, not the max", () => {
    // Rising edge gives (20-10)/(10-0) = 1; falling gives (14-20)/(15-14) = -6.
    expect(asymmetricRamps(20, 0, 10, 14, 15)).toBe(-6);
  });

  it("can peak negative when the tops cross each other", () => {
    // from_top 16 > to_top 14: the ramps pass each other, so the max is negative.
    expect(asymmetricRamps(15, 15, 16, 14, 17)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/asymmetricRamps.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/trees/asymmetricRamps`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/trees/asymmetricRamps.ts`:

```ts
/**
 * `asymmetric_ramps` from core/prototypes/noise-functions.lua:114-124.
 *
 * Two opposing linear ramps combined with `min`: output crosses 0 at `fromTop`
 * and `toTop`, and -1 at `fromBottom` and `toBottom`. The peak value depends on
 * how far apart the tops are, so it is positive when they are apart and negative
 * when they cross each other.
 *
 * There is deliberately no clamp and no upper bound - the game's comment says it
 * is "designed to be used with a group of asymmetric_ramps inside a shared min()",
 * which is exactly how every tree species uses it.
 */
export function asymmetricRamps(
  input: number,
  fromBottom: number,
  fromTop: number,
  toTop: number,
  toBottom: number,
): number {
  return Math.min((input - fromTop) / (fromTop - fromBottom), (toTop - input) / (toBottom - toTop));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/asymmetricRamps.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/trees/asymmetricRamps.ts test/asymmetricRamps.spec.ts
git commit -m "feat(noise): add the asymmetric_ramps noise function"
```

---

### Task 2: The species catalog

The 15 parameter rows, as data. Values are transcribed from the spec table (which
was extracted mechanically from `trees.lua` @ 2.1.11) - do not re-derive them by
hand.

**Files:**
- Create: `src/noise/trees/treeCatalog.ts`
- Test: `test/treeCatalog.spec.ts`

**Interfaces:**
- Consumes: `crc32` from `src/codec/crc32.ts` (test only).
- Produces:
  ```ts
  interface TreeSpecies {
    readonly name: string;          // e.g. "tree_01" (the noise-expression name)
    readonly seed1Name: string;     // e.g. "tree-01" (the string passed to multioctave_noise)
    readonly seed1: number;         // crc32(utf8(seed1Name))
    readonly cap: number;
    readonly tempRamp: readonly [number, number, number, number];   // fb, ft, tt, tb
    readonly moistRamp: readonly [number, number, number, number];
    readonly inputScaleDiv: number; // input_scale = (1 / inputScaleDiv) * control:trees:frequency
    readonly outputScale: number;
  }
  const TREE_SPECIES: readonly TreeSpecies[];
  const TREE_SMALL_NOISE_SEED1: number;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/treeCatalog.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { crc32 } from "../src/codec/crc32";
import { TREE_SMALL_NOISE_SEED1, TREE_SPECIES } from "../src/noise/trees/treeCatalog";

const crcOf = (s: string): number => crc32(new TextEncoder().encode(s));

describe("TREE_SPECIES catalog", () => {
  it("has all 15 Nauvis tree species", () => {
    expect(TREE_SPECIES).toHaveLength(15);
  });

  it("names every species exactly once", () => {
    expect(new Set(TREE_SPECIES.map((s) => s.name)).size).toBe(15);
    expect(new Set(TREE_SPECIES.map((s) => s.seed1Name)).size).toBe(15);
  });

  // Factorio hashes a STRING seed1 with crc32 - see nauvisShared.ts:9. The
  // hardcoded numbers exist so src/noise never imports the codec at runtime;
  // this test is what keeps them honest.
  it("hardcodes seed1 as crc32 of the species' seed1 string", () => {
    for (const s of TREE_SPECIES) {
      expect(s.seed1, s.seed1Name).toBe(crcOf(s.seed1Name));
    }
    expect(TREE_SMALL_NOISE_SEED1).toBe(crcOf("tree-small"));
  });

  it("derives the expression name from the seed1 string", () => {
    // "tree-02-red" -> "tree_02_red": the Lua names differ only in separator.
    for (const s of TREE_SPECIES) {
      expect(s.name).toBe(s.seed1Name.replace(/-/g, "_"));
    }
  });

  it("keeps every parameter in the range trees.lua uses", () => {
    for (const s of TREE_SPECIES) {
      expect(s.cap, s.name).toBeGreaterThan(0);
      expect(s.cap, s.name).toBeLessThanOrEqual(0.45);
      expect(s.outputScale, s.name).toBeGreaterThanOrEqual(0.5);
      expect(s.outputScale, s.name).toBeLessThanOrEqual(0.8);
      expect(s.inputScaleDiv, s.name).toBeGreaterThanOrEqual(22);
      expect(s.inputScaleDiv, s.name).toBeLessThanOrEqual(40);
    }
  });

  it("orders ramps so the tops sit between the bottoms", () => {
    for (const s of TREE_SPECIES) {
      for (const [fb, ft, tt, tb] of [s.tempRamp, s.moistRamp]) {
        expect(fb, s.name).toBeLessThan(ft);
        expect(ft, s.name).toBeLessThanOrEqual(tt);
        expect(tt, s.name).toBeLessThan(tb);
      }
    }
  });

  it("sorts by descending cap so the early-out raises `best` fastest", () => {
    const caps = TREE_SPECIES.map((s) => s.cap);
    expect(caps).toEqual([...caps].sort((a, b) => b - a));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/treeCatalog.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/trees/treeCatalog`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/trees/treeCatalog.ts`. Rows are sorted by descending `cap` (see
Task 6 - it makes the early-out skip more work) but are otherwise verbatim from
the spec:

```ts
/**
 * The 15 Nauvis tree species autoplace probability expressions, as data.
 *
 * Every species in base/prototypes/entity/trees.lua @ 2.1.11 shares exactly one
 * expression shape (verified mechanically - filtering the common terms out of
 * every `tree_0*` block leaves nothing), so a species is fully described by a
 * parameter row:
 *
 *   min(cap,
 *       trees_forest_path_cutout_faded,
 *       min(0, asymmetric_ramps{input=temperature, ...tempRamp},
 *              asymmetric_ramps{input=moisture, ...moistRamp})
 *       + min(0, distance/20 - 3)
 *       - 0.5 + 0.2 * control:trees:size
 *       + tree_small_noise * 0.1
 *       + multioctave_noise{persistence 0.65, octaves 3, seed1 = <seed1Name>,
 *                           input_scale = (1/inputScaleDiv) * control:trees:frequency,
 *                           output_scale = outputScale})
 *
 * `seed1` is a STRING in the Lua; Factorio hashes it with crc32 (see
 * nauvisShared.ts:9). The numbers here are those hashes, precomputed so this
 * module has no runtime dependency on the codec. treeCatalog.spec.ts asserts each
 * one against `crc32`, and the oracle fixtures prove the whole assumption.
 *
 * Rows are ordered by descending `cap`; treeField's early-out converges faster
 * that way. Order does not affect the result (the composition is a max).
 */
export interface TreeSpecies {
  /** The game's noise-expression name, e.g. "tree_01" (used for oracle sampling). */
  readonly name: string;
  /** The string passed as `seed1` in the Lua, e.g. "tree-01". */
  readonly seed1Name: string;
  /** `crc32(utf8(seed1Name))` - the numeric seed1 the game actually uses. */
  readonly seed1: number;
  /** The species' upper bound (the leading `min(cap, ...)`). */
  readonly cap: number;
  /** `asymmetric_ramps{input=temperature}` args: from_bottom, from_top, to_top, to_bottom. */
  readonly tempRamp: readonly [number, number, number, number];
  /** `asymmetric_ramps{input=moisture}` args: from_bottom, from_top, to_top, to_bottom. */
  readonly moistRamp: readonly [number, number, number, number];
  /** `input_scale = (1 / inputScaleDiv) * control:trees:frequency`. */
  readonly inputScaleDiv: number;
  /** The species noise term's `output_scale`. */
  readonly outputScale: number;
}

/** `tree_small_noise`'s seed1: `crc32(utf8("tree-small"))`. */
export const TREE_SMALL_NOISE_SEED1 = 2343395516;

export const TREE_SPECIES: readonly TreeSpecies[] = [
  { name: "tree_01", seed1Name: "tree-01", seed1: 545692666, cap: 0.45,
    tempRamp: [0, 10, 14, 15], moistRamp: [0.6, 0.7, 1, 2], inputScaleDiv: 25, outputScale: 0.8 },
  { name: "tree_04", seed1Name: "tree-04", seed1: 1357672309, cap: 0.45,
    tempRamp: [13, 14, 16, 17], moistRamp: [0.7, 0.9, 1, 2], inputScaleDiv: 30, outputScale: 0.8 },
  { name: "tree_05", seed1Name: "tree-05", seed1: 669736931, cap: 0.45,
    tempRamp: [15, 16, 35, 45], moistRamp: [0.6, 0.7, 1, 2], inputScaleDiv: 40, outputScale: 0.8 },
  { name: "tree_02", seed1Name: "tree-02", seed1: 3113208384, cap: 0.4,
    tempRamp: [0, 10, 14, 15], moistRamp: [0.4, 0.5, 0.7, 0.8], inputScaleDiv: 25, outputScale: 0.75 },
  { name: "tree_03", seed1Name: "tree-03", seed1: 3465083606, cap: 0.4,
    tempRamp: [15, 16, 35, 45], moistRamp: [0.4, 0.5, 0.7, 0.8], inputScaleDiv: 35, outputScale: 0.75 },
  { name: "tree_07", seed1Name: "tree-07", seed1: 3387244239, cap: 0.4,
    tempRamp: [13, 14, 16, 17], moistRamp: [0.5, 0.6, 0.9, 1], inputScaleDiv: 40, outputScale: 0.75 },
  { name: "tree_02_red", seed1Name: "tree-02-red", seed1: 2142693989, cap: 0.3,
    tempRamp: [0, 10, 14, 15], moistRamp: [0.2, 0.3, 0.5, 0.6], inputScaleDiv: 25, outputScale: 0.7 },
  { name: "tree_08", seed1Name: "tree-08", seed1: 1499079518, cap: 0.3,
    tempRamp: [13, 14, 16, 17], moistRamp: [0.3, 0.4, 0.6, 0.7], inputScaleDiv: 30, outputScale: 0.7 },
  { name: "tree_09", seed1Name: "tree-09", seed1: 777851848, cap: 0.3,
    tempRamp: [15, 16, 35, 45], moistRamp: [0.2, 0.3, 0.5, 0.6], inputScaleDiv: 25, outputScale: 0.7 },
  { name: "tree_06", seed1Name: "tree-06", seed1: 3202485849, cap: 0.2,
    tempRamp: [0, 10, 14, 15], moistRamp: [0.1, 0.2, 0.3, 0.4], inputScaleDiv: 22, outputScale: 0.6 },
  { name: "tree_08_brown", seed1Name: "tree-08-brown", seed1: 3606254248, cap: 0.2,
    tempRamp: [13, 14, 16, 17], moistRamp: [0.2, 0.3, 0.4, 0.5], inputScaleDiv: 30, outputScale: 0.6 },
  { name: "tree_09_brown", seed1Name: "tree-09-brown", seed1: 1887705372, cap: 0.2,
    tempRamp: [15, 16, 35, 45], moistRamp: [0.1, 0.2, 0.3, 0.4], inputScaleDiv: 25, outputScale: 0.6 },
  { name: "tree_06_brown", seed1Name: "tree-06-brown", seed1: 2261543413, cap: 0.1,
    tempRamp: [0, 10, 14, 15], moistRamp: [0, 0.1, 0.2, 0.3], inputScaleDiv: 22, outputScale: 0.5 },
  { name: "tree_08_red", seed1Name: "tree-08-red", seed1: 889647812, cap: 0.1,
    tempRamp: [13, 14, 16, 17], moistRamp: [0.1, 0.2, 0.3, 0.4], inputScaleDiv: 30, outputScale: 0.5 },
  { name: "tree_09_red", seed1Name: "tree-09-red", seed1: 140958580, cap: 0.1,
    tempRamp: [15, 16, 35, 45], moistRamp: [0, 0.1, 0.2, 0.3], inputScaleDiv: 25, outputScale: 0.5 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/treeCatalog.spec.ts`
Expected: PASS, 6 tests. If the crc32 assertion fails, the hardcoded seeds are
wrong - fix the catalog, never the test.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/trees/treeCatalog.ts test/treeCatalog.spec.ts
git commit -m "feat(noise): add the 15-species Nauvis tree catalog"
```

---

### Task 3: The shared tree fields

`tree_small_noise` and the `trees_forest_path_cutout` chain, from
`core/prototypes/noise-programs.lua:427-446`. All three billow inputs already
exist on `makeNauvisShared`.

**Files:**
- Create: `src/noise/trees/treeShared.ts`
- Test: `test/treeShared.spec.ts`

**Interfaces:**
- Consumes: `makeNauvisShared` / `NauvisShared` from `src/noise/expressions/nauvisShared.ts`; `makeMultioctaveNoise`; `TREE_SMALL_NOISE_SEED1`.
- Produces:
  ```ts
  interface TreeSharedParams { readonly seed0: number; readonly segmentationMultiplier?: number; }
  interface TreeShared {
    readonly smallNoise: (x: number, y: number) => number;
    readonly forestPathCutout: (x: number, y: number) => number;
    readonly forestPathCutoutFaded: (x: number, y: number) => number;
  }
  function makeTreeShared(params: TreeSharedParams, shared?: NauvisShared): TreeShared;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/treeShared.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { makeNauvisShared } from "../src/noise/expressions/nauvisShared";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { TREE_SMALL_NOISE_SEED1 } from "../src/noise/trees/treeCatalog";
import { makeTreeShared } from "../src/noise/trees/treeShared";

const GRID: Array<[number, number]> = [
  [0.5, 0.25],
  [220.5, -180.25],
  [-1600.5, 1200.25],
  [12345.75, 6789.125],
];

describe("makeTreeShared", () => {
  it("builds tree_small_noise as a flat-input-scale 3-octave multioctave", () => {
    // noise-programs.lua:427 - persistence 0.75, octaves 3, input_scale 0.2,
    // output_scale 0.5. input_scale is FLAT: unlike each species' own noise term,
    // tree_small_noise is NOT scaled by control:trees:frequency.
    const expected = makeMultioctaveNoise({
      seed0: 123456,
      seed1: TREE_SMALL_NOISE_SEED1,
      octaves: 3,
      persistence: 0.75,
      inputScale: 0.2,
      outputScale: 0.5,
    });
    const { smallNoise } = makeTreeShared({ seed0: 123456 });
    for (const [x, y] of GRID) expect(smallNoise(x, y)).toBe(expected(x, y));
  });

  it("composes the cutout as the min of the three path fields", () => {
    // trees_forest_path_cutout = min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)
    //   forest_paths        = (forest_path_billows  - 0.07) * 3
    //   nauvis_hills_paths  = (nauvis_hills         - 0.1)  * 3
    //   nauvis_bridge_paths = (nauvis_bridge_billows - 0.07) * 5
    const nz = makeNauvisShared({ seed0: 123456 });
    const { forestPathCutout } = makeTreeShared({ seed0: 123456 }, nz);
    for (const [x, y] of GRID) {
      const expected = Math.min(
        (nz.bridgeBillows(x, y) - 0.07) * 5,
        (nz.hills(x, y) - 0.1) * 3,
        (nz.forestPathBillows(x, y) - 0.07) * 3,
      );
      expect(forestPathCutout(x, y)).toBeCloseTo(expected, 12);
    }
  });

  it("fades the cutout with a tenth of the small noise", () => {
    // trees_forest_path_cutout_faded = cutout * 0.3 + tree_small_noise * 0.1
    const { smallNoise, forestPathCutout, forestPathCutoutFaded } = makeTreeShared({
      seed0: 123456,
    });
    for (const [x, y] of GRID) {
      expect(forestPathCutoutFaded(x, y)).toBeCloseTo(
        forestPathCutout(x, y) * 0.3 + smallNoise(x, y) * 0.1,
        12,
      );
    }
  });

  it("threads segmentationMultiplier into the billow fields", () => {
    const a = makeTreeShared({ seed0: 123456, segmentationMultiplier: 1 });
    const b = makeTreeShared({ seed0: 123456, segmentationMultiplier: 2 });
    const differs = GRID.some(([x, y]) => a.forestPathCutout(x, y) !== b.forestPathCutout(x, y));
    expect(differs).toBe(true);
  });

  it("leaves tree_small_noise independent of segmentationMultiplier", () => {
    const a = makeTreeShared({ seed0: 123456, segmentationMultiplier: 1 });
    const b = makeTreeShared({ seed0: 123456, segmentationMultiplier: 2 });
    for (const [x, y] of GRID) expect(a.smallNoise(x, y)).toBe(b.smallNoise(x, y));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/treeShared.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/trees/treeShared`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/trees/treeShared.ts`:

```ts
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeNauvisShared, type NauvisShared } from "../expressions/nauvisShared";
import { TREE_SMALL_NOISE_SEED1 } from "./treeCatalog";

export interface TreeSharedParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. Threads into the billow fields. */
  readonly segmentationMultiplier?: number;
}

export interface TreeShared {
  /** `tree_small_noise` - noise-programs.lua:427. */
  readonly smallNoise: (x: number, y: number) => number;
  /** `trees_forest_path_cutout` - noise-programs.lua:439. */
  readonly forestPathCutout: (x: number, y: number) => number;
  /** `trees_forest_path_cutout_faded` - noise-programs.lua:444. */
  readonly forestPathCutoutFaded: (x: number, y: number) => number;
}

/**
 * The tree-specific shared noise fields from core/prototypes/noise-programs.lua:
 *
 *   tree_small_noise               = multioctave_noise{persistence 0.75, octaves 3,
 *                                                      seed1 'tree-small',
 *                                                      input_scale 0.2, output_scale 0.5}
 *   forest_paths                   = (forest_path_billows   - 0.07) * 3
 *   nauvis_hills_paths             = (nauvis_hills          - 0.1)  * 3
 *   nauvis_bridge_paths            = (nauvis_bridge_billows - 0.07) * 5
 *   trees_forest_path_cutout       = min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)
 *   trees_forest_path_cutout_faded = trees_forest_path_cutout * 0.3 + tree_small_noise * 0.1
 *
 * These are what carve the forest paths (and, via moisture, the same cutouts the
 * climate tree already uses). `tree_small_noise`'s `input_scale` is flat 0.2 - it
 * is NOT scaled by `control:trees:frequency`, unlike each species' own noise term.
 *
 * Pass an existing {@link NauvisShared} to reuse its closures instead of rebuilding
 * the billow fields (the render path already has one).
 */
export function makeTreeShared(params: TreeSharedParams, shared?: NauvisShared): TreeShared {
  const seed0 = params.seed0;
  const nz =
    shared ??
    makeNauvisShared({ seed0, segmentationMultiplier: params.segmentationMultiplier });

  const smallNoise = makeMultioctaveNoise({
    seed0,
    seed1: TREE_SMALL_NOISE_SEED1,
    octaves: 3,
    persistence: 0.75,
    inputScale: 0.2,
    outputScale: 0.5,
  });

  const forestPathCutout = (x: number, y: number): number =>
    Math.min(
      (nz.bridgeBillows(x, y) - 0.07) * 5,
      (nz.hills(x, y) - 0.1) * 3,
      (nz.forestPathBillows(x, y) - 0.07) * 3,
    );

  const forestPathCutoutFaded = (x: number, y: number): number =>
    forestPathCutout(x, y) * 0.3 + smallNoise(x, y) * 0.1;

  return { smallNoise, forestPathCutout, forestPathCutoutFaded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/treeShared.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/trees/treeShared.ts test/treeShared.spec.ts
git commit -m "feat(noise): add tree_small_noise and the forest-path cutout chain"
```

---

### Task 4: `makeTreeDensity` - the species field and its max

The builder, with **full evaluation only**. The early-out is deliberately deferred
to Task 6 so it has a trusted reference to be proven identical against.

**Files:**
- Create: `src/noise/trees/treeField.ts`
- Test: `test/treeField.spec.ts`

**Interfaces:**
- Consumes: `asymmetricRamps`, `TREE_SPECIES`/`TreeSpecies`, `makeTreeShared`, `makeTemperature`, `makeMoisture`, `makeMultioctaveNoise`, `distanceFromNearestPoint`, `clamp` from `src/noise/eval/math`.
- Produces:
  ```ts
  interface TreeFieldParams {
    readonly seed0: number;
    readonly treesFrequency?: number;   // control:trees:frequency, default 1
    readonly treesSize?: number;        // control:trees:size, default 1
    readonly segmentationMultiplier?: number;
    readonly moistureFrequency?: number;
    readonly moistureBias?: number;
    readonly startingAreaMoistureSize?: number;
    readonly startingAreaMoistureFrequency?: number;
    readonly startingPositions?: readonly Point[];
  }
  function makeTreeSpeciesFields(p: TreeFieldParams): Array<{ species: TreeSpecies; evalAt: (x: number, y: number) => number }>;
  function makeTreeDensity(p: TreeFieldParams): (x: number, y: number) => number;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/treeField.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { asymmetricRamps } from "../src/noise/trees/asymmetricRamps";
import { makeMoisture } from "../src/noise/expressions/moisture";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { makeTemperature } from "../src/noise/expressions/temperature";
import { makeTreeShared } from "../src/noise/trees/treeShared";
import { makeTreeDensity, makeTreeSpeciesFields } from "../src/noise/trees/treeField";
import { TREE_SPECIES } from "../src/noise/trees/treeCatalog";

const GRID: Array<[number, number]> = [
  [0.5, 0.25],
  [220.5, -180.25],
  [-1600.5, 1200.25],
  [900.5, 900.25],
  [12345.75, 6789.125],
];

describe("makeTreeSpeciesFields", () => {
  it("builds one field per catalog species, in catalog order", () => {
    const fields = makeTreeSpeciesFields({ seed0: 123456 });
    expect(fields.map((f) => f.species.name)).toEqual(TREE_SPECIES.map((s) => s.name));
  });

  it("reproduces the trees.lua expression term for term", () => {
    // An independent re-implementation of tree_01, built straight from the Lua,
    // so a refactor of treeField cannot quietly change the formula.
    const seed0 = 123456;
    const temperature = makeTemperature({ seed0 });
    const moisture = makeMoisture({ seed0 });
    const { smallNoise, forestPathCutoutFaded } = makeTreeShared({ seed0 });
    const row = TREE_SPECIES.find((s) => s.name === "tree_01")!;
    const noise = makeMultioctaveNoise({
      seed0,
      seed1: row.seed1,
      octaves: 3,
      persistence: 0.65,
      inputScale: 1 / row.inputScaleDiv,
      outputScale: row.outputScale,
    });

    const expected = (x: number, y: number): number => {
      const distance = Math.hypot(x, y);
      const climate = Math.min(
        0,
        asymmetricRamps(temperature(x, y), ...row.tempRamp),
        asymmetricRamps(moisture(x, y), ...row.moistRamp),
      );
      const sum =
        climate +
        Math.min(0, distance / 20 - 3) -
        0.5 +
        0.2 * 1 +
        smallNoise(x, y) * 0.1 +
        noise(x, y);
      return Math.min(row.cap, forestPathCutoutFaded(x, y), sum);
    };

    const actual = makeTreeSpeciesFields({ seed0 }).find((f) => f.species.name === "tree_01")!;
    for (const [x, y] of GRID) expect(actual.evalAt(x, y)).toBeCloseTo(expected(x, y), 12);
  });

  it("scales the species input_scale by control:trees:frequency", () => {
    const base = makeTreeSpeciesFields({ seed0: 123456 })[0];
    const fast = makeTreeSpeciesFields({ seed0: 123456, treesFrequency: 3 })[0];
    const differs = GRID.some(([x, y]) => base.evalAt(x, y) !== fast.evalAt(x, y));
    expect(differs).toBe(true);
  });

  it("shifts every species by 0.2 per unit of control:trees:size, until capped", () => {
    const base = makeTreeSpeciesFields({ seed0: 123456 });
    const big = makeTreeSpeciesFields({ seed0: 123456, treesSize: 2 });
    for (let i = 0; i < base.length; i++) {
      const cap = base[i].species.cap;
      for (const [x, y] of GRID) {
        // The +0.2 lands inside the shared sum, so it shifts the result unless the
        // cap or the cutout is the binding term.
        expect(big[i].evalAt(x, y)).toBeLessThanOrEqual(cap + 1e-12);
        expect(big[i].evalAt(x, y)).toBeGreaterThanOrEqual(base[i].evalAt(x, y) - 1e-12);
      }
    }
  });
});

describe("makeTreeDensity", () => {
  it("is the clamped max over every species", () => {
    const fields = makeTreeSpeciesFields({ seed0: 123456 });
    const density = makeTreeDensity({ seed0: 123456 });
    for (const [x, y] of GRID) {
      const expected = Math.min(1, Math.max(0, ...fields.map((f) => f.evalAt(x, y))));
      expect(density(x, y)).toBeCloseTo(expected, 12);
    }
  });

  it("never leaves [0, 1]", () => {
    const density = makeTreeDensity({ seed0: 123456 });
    for (let x = -2000; x <= 2000; x += 137) {
      for (let y = -2000; y <= 2000; y += 149) {
        const d = density(x + 0.5, y + 0.25);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is zero far from spawn, where the distance term collapses the field", () => {
    // min(0, distance/20 - 3) saturates at 0 past distance 60, so distance does
    // NOT suppress far-field trees - but the caps are all <= 0.45, so density can
    // never reach 1. This pins that the field stays a probability, not a mask.
    const density = makeTreeDensity({ seed0: 123456 });
    let maxSeen = 0;
    for (let x = -3000; x <= 3000; x += 211) {
      for (let y = -3000; y <= 3000; y += 223) {
        maxSeen = Math.max(maxSeen, density(x + 0.5, y + 0.25));
      }
    }
    expect(maxSeen).toBeGreaterThan(0);
    expect(maxSeen).toBeLessThanOrEqual(0.45);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/treeField.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/trees/treeField`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/trees/treeField.ts`:

```ts
import { asymmetricRamps } from "./asymmetricRamps";
import { clamp } from "../eval/math";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { makeMoisture } from "../expressions/moisture";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeNauvisShared } from "../expressions/nauvisShared";
import { makeTemperature } from "../expressions/temperature";
import { makeTreeShared } from "./treeShared";
import { TREE_SPECIES, type TreeSpecies } from "./treeCatalog";

export interface TreeFieldParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:trees:frequency; default 1. */
  readonly treesFrequency?: number;
  /** control:trees:size; default 1. */
  readonly treesSize?: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
  /** Climate levers, forwarded to makeMoisture. */
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly startingAreaMoistureSize?: number;
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export interface TreeSpeciesField {
  readonly species: TreeSpecies;
  readonly evalAt: (x: number, y: number) => number;
}

/**
 * Compile all 15 Nauvis tree species probability expressions for one seed.
 *
 * `temperature` has been ported and oracle-validated since M2 but was never
 * evaluated by anything - tile selection turned out to be aux + moisture only.
 * This is its first consumer. There is no user-facing temperature control, so it
 * runs at the game's defaults (frequency 1, bias 0).
 */
export function makeTreeSpeciesFields(params: TreeFieldParams): TreeSpeciesField[] {
  const seed0 = params.seed0;
  const treesFrequency = params.treesFrequency ?? 1;
  const treesSize = params.treesSize ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];

  const nz = makeNauvisShared({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
  });
  const { smallNoise, forestPathCutoutFaded } = makeTreeShared(
    { seed0, segmentationMultiplier: params.segmentationMultiplier },
    nz,
  );
  const temperature = makeTemperature({ seed0 });
  const moisture = makeMoisture({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingAreaMoistureSize: params.startingAreaMoistureSize,
    startingAreaMoistureFrequency: params.startingAreaMoistureFrequency,
    startingPositions: [...startingPositions],
  });

  // The size lever is a flat additive term shared by every species.
  const sizeTerm = -0.5 + 0.2 * treesSize;

  return TREE_SPECIES.map((species) => {
    const noise = makeMultioctaveNoise({
      seed0,
      seed1: species.seed1,
      octaves: 3,
      persistence: 0.65,
      inputScale: (1 / species.inputScaleDiv) * treesFrequency,
      outputScale: species.outputScale,
    });

    const evalAt = (x: number, y: number): number => {
      const distance = distanceFromNearestPoint(x, y, startingPositions);
      const climate = Math.min(
        0,
        asymmetricRamps(temperature(x, y), ...species.tempRamp),
        asymmetricRamps(moisture(x, y), ...species.moistRamp),
      );
      const sum =
        climate + Math.min(0, distance / 20 - 3) + sizeTerm + smallNoise(x, y) * 0.1 + noise(x, y);
      return Math.min(species.cap, forestPathCutoutFaded(x, y), sum);
    };

    return { species, evalAt };
  });
}

/**
 * The per-pixel tree density: `clamp(max_i p_i, 0, 1)`.
 *
 * `max` is not an approximation. Per docs/noise/placement-roll-NOTES.md, the game's
 * `EntityMapGenerationTask::generateEntities` arbitrates a single winning entity per
 * tile by MAX probability and then rolls once against it, so `max_i p_i` is exactly
 * the probability the game rolls on a tile where a tree wins. The density-shaded
 * render is therefore the expected value of what the game draws, and the eventual
 * placement-stipple project (Phase 2) consumes this identical field.
 */
export function makeTreeDensity(params: TreeFieldParams): (x: number, y: number) => number {
  const fields = makeTreeSpeciesFields(params);
  return (x: number, y: number): number => {
    let best = 0;
    for (const f of fields) {
      const v = f.evalAt(x, y);
      if (v > best) best = v;
    }
    return clamp(best, 0, 1);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/treeField.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/trees/treeField.ts test/treeField.spec.ts
git commit -m "feat(noise): compile the 15 tree species into a density field"
```

---

### Task 5: Oracle validation of all 15 species

The real gate. If the crc32 seed1 assumption, the ramp helper, or any catalog row
is wrong, this is what catches it.

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureTrees` and register it)
- Create: `test/fixtures/oracle-trees.seed123456.json` (generated)
- Create: `test/treeOracle.spec.ts`

**Interfaces:**
- Consumes: `sampleExpression`, `oracleAvailable`, `Position` from `test/oracle/oracle.ts`; `TREE_SPECIES`; `makeTreeSpeciesFields`.
- Produces: the committed fixture JSON `{ seed0, positions, values: Record<string, number[]> }`.

- [ ] **Step 1: Add the capture function**

Add to `test/oracle/capture.ts`, next to `captureAux`:

```ts
/**
 * Ground truth for all 15 Nauvis tree species probability expressions, plus the
 * two shared fields they build on. Sampled at defaults (control:trees 1/1), so
 * this pins the catalog rows, the crc32 string-seed1 assumption, and the
 * asymmetric_ramps port in one shot.
 *
 * 17 expressions x ~1.7 s per run - this capture is the slow one (~30 s).
 */
async function captureTrees(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  // Near-spawn grid (where the distance term is live) ...
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 17 - 17 + 0.5, y: gy * 19 - 19 + 0.25 });
    }
  }
  // ... plus two far rings, to span several climate biomes.
  for (const r of [800, 2400]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
    }
  }
  positions.push({ x: 12345.75, y: 6789.125 });

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const values: Record<string, number[]> = {};
    for (const name of [
      "tree_small_noise",
      "trees_forest_path_cutout_faded",
      ...TREE_SPECIES.map((s) => s.name),
    ]) {
      values[name] = await sampleExpression(name, positions, { workDir, seed });
    }
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. The 15 tree species probability expressions plus tree_small_noise and trees_forest_path_cutout_faded, each routed onto elevation, at default control:trees. Regenerate: node --experimental-strip-types test/oracle/capture.ts trees",
      seed0: seed,
      positions,
      values,
    };
    const out = join(FIXTURES, "oracle-trees.seed123456.json");
    await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
```

Import `TREE_SPECIES` at the top of `capture.ts`:

```ts
import { TREE_SPECIES } from "../../src/noise/trees/treeCatalog.ts";
```

(The `.ts` extension is required here - `capture.ts` is executed directly by Node
with `--experimental-strip-types`, which does no extension resolution. See the
comment at `test/oracle/capture.ts:17`.)

Register it with the other captures at the bottom of the file, after the
`enemy-base` line:

```ts
if (want("trees")) await captureTrees();
```

- [ ] **Step 2: Run the capture**

Run: `node --experimental-strip-types test/oracle/capture.ts trees`
Expected: ~30 s, then `wrote .../test/fixtures/oracle-trees.seed123456.json`.

If no Factorio binary is present the script exits with "No Factorio binary found";
in that case stop and report - this task cannot be completed without the oracle.

- [ ] **Step 3: Write the validation test**

Create `test/treeOracle.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-trees.seed123456.json";
import { makeTreeShared } from "../src/noise/trees/treeShared";
import { makeTreeSpeciesFields } from "../src/noise/trees/treeField";

const { seed0, positions, values } = fixture as {
  seed0: number;
  positions: Array<{ x: number; y: number }>;
  values: Record<string, number[]>;
};

/**
 * Tolerance idiom borrowed from test/resourcePatches.spec.ts: an absolute bound
 * for near-spawn points plus a relative escape for the known far-field basisNoise
 * f32 floor, so the far ring cannot mask a real near-field error.
 */
const agrees = (actual: number, expected: number, abs: number, rel: number): boolean =>
  Math.abs(actual - expected) < abs || Math.abs(actual - expected) < rel * Math.abs(expected);

describe("tree shared fields match the game", () => {
  const { smallNoise, forestPathCutoutFaded } = makeTreeShared({ seed0 });

  it.each([
    ["tree_small_noise", smallNoise],
    ["trees_forest_path_cutout_faded", forestPathCutoutFaded],
  ] as const)("reproduces %s to the noise floor", (name, evalAt) => {
    let worst = 0;
    let label = "";
    positions.forEach((p, i) => {
      const err = Math.abs(evalAt(p.x, p.y) - values[name][i]);
      if (err > worst) {
        worst = err;
        label = `@(${p.x},${p.y})`;
      }
    });
    expect(worst, `${name} worst ${label}`).toBeLessThan(1e-4);
  });
});

describe("every tree species matches the game", () => {
  const fields = makeTreeSpeciesFields({ seed0 });

  it("covers all 15 species in the fixture", () => {
    for (const f of fields) expect(values[f.species.name], f.species.name).toBeDefined();
  });

  it.each(fields.map((f) => [f.species.name, f] as const))(
    "reproduces %s to the noise floor",
    (name, field) => {
      let worst = 0;
      let label = "";
      positions.forEach((p, i) => {
        const err = Math.abs(field.evalAt(p.x, p.y) - values[name][i]);
        if (err > worst) {
          worst = err;
          label = `@(${p.x},${p.y})`;
        }
      });
      // Species values live in roughly [-3, 0.45]; the dominant error source is
      // the f32 coordinate floor inside basisNoise. Calibrate this bound DOWN to
      // just above the observed worst once measured - never up to make it pass.
      expect(worst, `${name} worst ${label}`).toBeLessThan(1e-3);
    },
  );

  it("agrees on the composed max at every sampled point", () => {
    positions.forEach((p, i) => {
      const expected = Math.min(
        1,
        Math.max(0, ...fields.map((f) => values[f.species.name][i])),
      );
      const actual = Math.min(1, Math.max(0, ...fields.map((f) => f.evalAt(p.x, p.y))));
      expect(agrees(actual, expected, 1e-3, 1e-2), `@(${p.x},${p.y})`).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm vp test test/treeOracle.spec.ts`
Expected: PASS, 18 tests.

If a species fails by a large margin (not ~1e-4 but ~0.1 or more), the likely
causes in order: a wrong crc32 seed1, a transposed ramp argument, or a wrong
`inputScaleDiv`. Fix the port, never the fixture. Tighten the two tolerance
constants down to just above the observed worst before committing, and record the
observed worst in a comment.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add test/oracle/capture.ts test/fixtures/oracle-trees.seed123456.json test/treeOracle.spec.ts
git commit -m "test(noise): validate all 15 tree species against the game"
```

---

### Task 6: The `control:trees` lever fixture

Proves the frequency and size levers enter the expression the way the game reads
them, not just that defaults work.

**Files:**
- Modify: `test/oracle/capture.ts` (add `captureTreesControls`, register it)
- Create: `test/fixtures/oracle-trees-controls.seed123456.json` (generated)
- Modify: `test/treeOracle.spec.ts` (add the lever describe block)

**Interfaces:**
- Consumes: `sampleExpression`'s `mapGenOverrides` option (used by the existing resource captures for control levers).
- Produces: fixture `{ seed0, treesFrequency, treesSize, positions, values }`.

- [ ] **Step 1: Add the capture function**

Add to `test/oracle/capture.ts`:

```ts
/**
 * The same species at NON-default control:trees levers, so the frequency ->
 * input_scale and size -> `0.2 * control:trees:size` wiring is pinned rather than
 * assumed. Three representative species (one per cap tier) keep this capture short.
 */
async function captureTreesControls(): Promise<void> {
  const seed = 123456;
  const treesFrequency = 3;
  const treesSize = 2;
  const positions: Position[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 23 - 23 + 0.5, y: gy * 29 - 29 + 0.25 });
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    positions.push({ x: 1200 * Math.cos(a) + 0.5, y: 1200 * Math.sin(a) + 0.25 });
  }

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const values: Record<string, number[]> = {};
    for (const name of ["tree_01", "tree_08", "tree_09_red"]) {
      values[name] = await sampleExpression(name, positions, {
        workDir,
        seed,
        mapGenOverrides: {
          autoplace_controls: { trees: { frequency: treesFrequency, size: treesSize } },
        },
      });
    }
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. Three tree species at control:trees frequency=3 size=2. Regenerate: node --experimental-strip-types test/oracle/capture.ts trees-controls",
      seed0: seed,
      treesFrequency,
      treesSize,
      positions,
      values,
    };
    const out = join(FIXTURES, "oracle-trees-controls.seed123456.json");
    await writeFile(out, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
```

Register it after the `trees` line:

```ts
if (want("trees-controls")) await captureTreesControls();
```

- [ ] **Step 2: Run the capture**

Run: `node --experimental-strip-types test/oracle/capture.ts trees-controls`
Expected: ~6 s, then `wrote .../test/fixtures/oracle-trees-controls.seed123456.json`.

- [ ] **Step 3: Add the validation**

Append to `test/treeOracle.spec.ts`:

```ts
import controlFixture from "./fixtures/oracle-trees-controls.seed123456.json";

describe("control:trees levers match the game", () => {
  const f = controlFixture as {
    seed0: number;
    treesFrequency: number;
    treesSize: number;
    positions: Array<{ x: number; y: number }>;
    values: Record<string, number[]>;
  };
  const fields = makeTreeSpeciesFields({
    seed0: f.seed0,
    treesFrequency: f.treesFrequency,
    treesSize: f.treesSize,
  });

  it.each(Object.keys(f.values))("reproduces %s at frequency 3 / size 2", (name) => {
    const field = fields.find((x) => x.species.name === name)!;
    let worst = 0;
    let label = "";
    f.positions.forEach((p, i) => {
      const err = Math.abs(field.evalAt(p.x, p.y) - f.values[name][i]);
      if (err > worst) {
        worst = err;
        label = `@(${p.x},${p.y})`;
      }
    });
    expect(worst, `${name} worst ${label}`).toBeLessThan(1e-3);
  });

  it("differs from the default-lever field, so the levers are actually live", () => {
    const base = makeTreeSpeciesFields({ seed0: f.seed0 });
    const name = "tree_01";
    const a = base.find((x) => x.species.name === name)!;
    const b = fields.find((x) => x.species.name === name)!;
    const differs = f.positions.some((p) => a.evalAt(p.x, p.y) !== b.evalAt(p.x, p.y));
    expect(differs).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm vp test test/treeOracle.spec.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add test/oracle/capture.ts test/fixtures/oracle-trees-controls.seed123456.json test/treeOracle.spec.ts
git commit -m "test(noise): pin the control:trees frequency and size levers"
```

---

### Task 7: The per-pixel early-out

Now that `makeTreeDensity` is oracle-trusted, optimize it - and prove the optimized
path is identical.

**Files:**
- Modify: `src/noise/trees/treeField.ts`
- Test: `test/treeFieldEarlyOut.spec.ts`

**Interfaces:**
- Consumes: `TreeSpeciesField` from Task 4.
- Produces: `BASIS_ABS_MAX` (exported for the bound test), and `makeTreeDensity` gains an internal fast path. The public signature does not change.

- [ ] **Step 1: Measure the basis bound**

Run this to find the largest `|basisNoise|` the tree octaves actually produce:

```bash
node --experimental-strip-types -e '
import("./src/noise/basisNoise.ts").then(({ basisNoise, basisNoiseTablesFromSeed }) => {
  let m = 0;
  for (const seed1 of [545692666, 3113208384, 140958580]) {
    const t = basisNoiseTablesFromSeed(123456, seed1);
    for (let i = 0; i < 400000; i++) {
      const x = (i % 997) * 0.37 - 200, y = Math.floor(i / 997) * 0.41 - 200;
      m = Math.max(m, Math.abs(basisNoise(x, y, t)));
    }
  }
  console.log("max |basisNoise| =", m);
});'
```

Record the number. `BASIS_ABS_MAX` is that value rounded **up** to the next 0.1,
which is the safety margin. Expect roughly 1.0-1.2.

- [ ] **Step 2: Write the failing test**

Create `test/treeFieldEarlyOut.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { basisNoise, basisNoiseTablesFromSeed } from "../src/noise/basisNoise";
import { BASIS_ABS_MAX, makeTreeDensity, makeTreeSpeciesFields } from "../src/noise/trees/treeField";
import { TREE_SPECIES } from "../src/noise/trees/treeCatalog";

/** The reference: full evaluation of every species, no skipping. */
const fullDensity =
  (seed0: number) =>
  (x: number, y: number): number => {
    const fields = makeTreeSpeciesFields({ seed0 });
    return Math.min(1, Math.max(0, ...fields.map((f) => f.evalAt(x, y))));
  };

describe("tree density early-out", () => {
  it("is bit-identical to full evaluation across seeds and regions", () => {
    for (const seed0 of [123456, 777771, 1]) {
      const fast = makeTreeDensity({ seed0 });
      const slow = fullDensity(seed0);
      for (let x = -3000; x <= 3000; x += 271) {
        for (let y = -3000; y <= 3000; y += 293) {
          const wx = x + 0.5;
          const wy = y + 0.25;
          expect(fast(wx, wy), `seed ${seed0} @(${wx},${wy})`).toBe(slow(wx, wy));
        }
      }
    }
  });

  it("is bit-identical at non-default control levers too", () => {
    const params = { seed0: 123456, treesFrequency: 3, treesSize: 2 };
    const fast = makeTreeDensity(params);
    const fields = makeTreeSpeciesFields(params);
    for (let x = -1500; x <= 1500; x += 173) {
      for (let y = -1500; y <= 1500; y += 181) {
        const wx = x + 0.5;
        const wy = y + 0.25;
        const slow = Math.min(1, Math.max(0, ...fields.map((f) => f.evalAt(wx, wy))));
        expect(fast(wx, wy), `@(${wx},${wy})`).toBe(slow);
      }
    }
  });

  it("bounds basisNoise conservatively", () => {
    // The early-out is only sound if no octave can exceed BASIS_ABS_MAX. Sample
    // the actual tree seeds hard and assert headroom remains.
    let observed = 0;
    for (const s of TREE_SPECIES.slice(0, 5)) {
      const t = basisNoiseTablesFromSeed(123456, s.seed1);
      for (let i = 0; i < 200000; i++) {
        const x = (i % 991) * 0.31 - 150;
        const y = Math.floor(i / 991) * 0.43 - 150;
        observed = Math.max(observed, Math.abs(basisNoise(x, y, t)));
      }
    }
    expect(observed).toBeLessThan(BASIS_ABS_MAX);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vp test test/treeFieldEarlyOut.spec.ts`
Expected: FAIL - `BASIS_ABS_MAX` is not exported from `treeField`.

- [ ] **Step 4: Implement the early-out**

In `src/noise/trees/treeField.ts`, add the constant near the top (replace `1.2`
with the value measured in Step 1, rounded up to the next 0.1):

```ts
/**
 * A conservative upper bound on `|basisNoise|`, used to bound each species' noise
 * term so the density max can skip evaluating octaves that cannot win.
 *
 * This is a MEASURED maximum plus a safety margin, not an analytic bound - the
 * basis range is not a clean +/-sqrt(3) (see docs/noise/basis-noise-NOTES.md).
 * treeFieldEarlyOut.spec.ts asserts both that the bound holds against hard
 * sampling AND that the early-out result is bit-identical to full evaluation, so
 * a wrong value fails loudly instead of silently clipping forests.
 */
export const BASIS_ABS_MAX = 1.2;
```

Restructure the species builder so the shared terms and the noise term are
separable. Replace the `evalAt` construction inside `makeTreeSpeciesFields` with:

```ts
    /** Everything except this species' own noise term. Bounds `evalAt` from above. */
    const cheapAt = (x: number, y: number): number => {
      const distance = distanceFromNearestPoint(x, y, startingPositions);
      const climate = Math.min(
        0,
        asymmetricRamps(temperature(x, y), ...species.tempRamp),
        asymmetricRamps(moisture(x, y), ...species.moistRamp),
      );
      return climate + Math.min(0, distance / 20 - 3) + sizeTerm + smallNoise(x, y) * 0.1;
    };

    const evalAt = (x: number, y: number): number =>
      Math.min(species.cap, forestPathCutoutFaded(x, y), cheapAt(x, y) + noise(x, y));

    return { species, evalAt, cheapAt, noiseAt: noise, maxNoise: maxNoiseFor(species) };
```

Extend the interface and add the bound helper:

```ts
export interface TreeSpeciesField {
  readonly species: TreeSpecies;
  readonly evalAt: (x: number, y: number) => number;
  /** The species value minus its own noise term - an upper bound on the sum. */
  readonly cheapAt: (x: number, y: number) => number;
  readonly noiseAt: (x: number, y: number) => number;
  /** The largest magnitude this species' noise term can reach. */
  readonly maxNoise: number;
}

/**
 * `|multioctave_noise|` cannot exceed `outputScale * norm * (sum of octave
 * amplitudes) * BASIS_ABS_MAX`. With octaves 3 and persistence 0.65 the octave
 * amplitudes are `norm * (1, 1/P, 1/P^2)`; `norm` is the RMS normalisation
 * multioctaveNoise applies. Mirrors multioctaveNoise.ts:70-99.
 */
function maxNoiseFor(species: TreeSpecies): number {
  const P = 0.65;
  const octaves = 3;
  const invP2 = 1 / (P * P);
  const norm = Math.sqrt((invP2 - 1) / (invP2 ** octaves - 1));
  let amps = 0;
  let amp = norm;
  for (let k = 0; k < octaves; k++) {
    amps += amp;
    amp /= P;
  }
  return species.outputScale * amps * BASIS_ABS_MAX;
}
```

Then rewrite `makeTreeDensity`'s loop to skip:

```ts
export function makeTreeDensity(params: TreeFieldParams): (x: number, y: number) => number {
  const fields = makeTreeSpeciesFields(params);
  return (x: number, y: number): number => {
    let best = 0;
    // The cutout is shared by every species and caps all of them; compute once.
    for (const f of fields) {
      // `cap` and the cutout both bound the species from above, as does
      // `cheap + maxNoise`. If none can beat `best`, the 3-octave noise cannot
      // change the answer - skip it. Catalog order (descending cap) raises `best`
      // early, which maximises how often this fires.
      if (f.species.cap <= best) continue;
      const cheap = f.cheapAt(x, y);
      if (cheap + f.maxNoise <= best) continue;
      const v = f.evalAt(x, y);
      if (v > best) best = v;
    }
    return clamp(best, 0, 1);
  };
}
```

Note `evalAt` recomputes `cheapAt`; that is deliberate for clarity and costs only
cheap arithmetic (the climate closures memoize nothing, but they are the same
shared closures every species calls, so the expensive noise is what matters). If
profiling in Task 11 shows the double `cheapAt` mattering, hoist it - the equality
test protects the refactor.

- [ ] **Step 5: Run both test files to verify**

Run: `pnpm vp test test/treeFieldEarlyOut.spec.ts test/treeField.spec.ts`
Expected: PASS. If the identity test fails, `BASIS_ABS_MAX` is too small - raise
it and re-run, do not weaken the assertion to `toBeCloseTo`.

- [ ] **Step 6: Commit**

```bash
pnpm vp check --fix
git add src/noise/trees/treeField.ts test/treeFieldEarlyOut.spec.ts
git commit -m "perf(noise): skip tree octaves that cannot win the density max"
```

---

### Task 8: The `renderTrees` overlay

**Files:**
- Create: `src/noise/preview/renderTrees.ts`
- Test: `test/renderTrees.spec.ts`

**Interfaces:**
- Consumes: `makeTreeDensity`/`TreeFieldParams`; `WATER_TILE_COLORS` from `./renderResources`.
- Produces:
  ```ts
  const TREE_MAP_COLOR: readonly [number, number, number];  // [48, 99, 48]
  const TREE_MAX_ALPHA: number;                             // 0.40
  interface RenderTreesOptions extends TreeFieldParams { originX?; originY?; tilesPerPixel?; }
  function renderTrees(base: ImageData, opts: RenderTreesOptions): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `test/renderTrees.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { TREE_MAP_COLOR, TREE_MAX_ALPHA, renderTrees } from "../src/noise/preview/renderTrees";
import { makeTreeDensity } from "../src/noise/trees/treeField";

const solid = (w: number, h: number, rgb: readonly [number, number, number]): ImageData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
};

const GRASS: readonly [number, number, number] = [99, 122, 44];

describe("renderTrees", () => {
  it("uses the game's own tree chart color and alpha", () => {
    // core/prototypes/utility-constants.lua:201 -
    //   default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}
    expect(TREE_MAP_COLOR).toEqual([48, 99, 48]);
    expect(TREE_MAX_ALPHA).toBeCloseTo(0.4, 12);
  });

  it("blends toward the tree color in proportion to density", () => {
    const img = solid(16, 16, GRASS);
    renderTrees(img, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1 });
    const density = makeTreeDensity({ seed0: 123456 });
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const o = (py * 16 + px) * 4;
        const a = TREE_MAX_ALPHA * density(px, py);
        for (let c = 0; c < 3; c++) {
          const expected = Math.round(GRASS[c] * (1 - a) + TREE_MAP_COLOR[c] * a);
          expect(img.data[o + c], `px(${px},${py}) ch${c}`).toBe(expected);
        }
        expect(img.data[o + 3]).toBe(255);
      }
    }
  });

  it("leaves water pixels untouched", () => {
    for (const water of WATER_TILE_COLORS) {
      const img = solid(8, 8, water);
      renderTrees(img, { seed0: 123456 });
      for (let i = 0; i < 8 * 8; i++) {
        expect(img.data[i * 4]).toBe(water[0]);
        expect(img.data[i * 4 + 1]).toBe(water[1]);
        expect(img.data[i * 4 + 2]).toBe(water[2]);
      }
    }
  });

  it("honors originX/originY and tilesPerPixel", () => {
    const a = solid(4, 4, GRASS);
    const b = solid(4, 4, GRASS);
    renderTrees(a, { seed0: 123456, originX: 500, originY: -300, tilesPerPixel: 2 });
    renderTrees(b, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1 });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));

    const density = makeTreeDensity({ seed0: 123456 });
    const alpha = TREE_MAX_ALPHA * density(500 + 2 * 3, -300 + 2 * 1);
    const o = (1 * 4 + 3) * 4;
    expect(a.data[o]).toBe(Math.round(GRASS[0] * (1 - alpha) + TREE_MAP_COLOR[0] * alpha));
  });

  it("is a no-op where density is zero", () => {
    // A pixel whose density is 0 must be byte-identical afterwards.
    const img = solid(64, 64, GRASS);
    const before = Array.from(img.data);
    renderTrees(img, { seed0: 123456 });
    const density = makeTreeDensity({ seed0: 123456 });
    let checked = 0;
    for (let py = 0; py < 64; py++) {
      for (let px = 0; px < 64; px++) {
        if (density(px, py) !== 0) continue;
        checked++;
        const o = (py * 64 + px) * 4;
        for (let c = 0; c < 4; c++) expect(img.data[o + c]).toBe(before[o + c]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/renderTrees.spec.ts`
Expected: FAIL - cannot resolve `../src/noise/preview/renderTrees`.

- [ ] **Step 3: Write the implementation**

Create `src/noise/preview/renderTrees.ts`:

```ts
/**
 * Composite the tree overlay onto a terrain ImageData: sweep the same pixel grid
 * as renderTerrain and blend the game's tree chart color over each pixel with an
 * alpha proportional to tree density. Mutates `base` in place.
 *
 * Why a blend and not a footprint (as resources/enemies/cliffs use): the game's
 * own map preview places real tree entities and charts each one with the RGBA
 * `default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}` - the 40% alpha is
 * the game blending trees over terrain. We cannot place individual trees without
 * the per-chunk placement roll (deferred - see docs/noise/placement-roll-NOTES.md),
 * so we draw the EXPECTED value instead: the density is exactly the probability
 * the game rolls against, because arbitration picks the max-probability entity per
 * tile and rolls once. See the design spec for the full RE.
 *
 * Trees do not place on water, so water pixels are skipped, reusing renderTerrain's
 * exact water decision via WATER_TILE_COLORS the same way renderResources does.
 * Cliff exclusion is not wired, matching the existing deferred ore-on-cliffs item.
 */
import { WATER_TILE_COLORS } from "./renderResources";
import { makeTreeDensity, type TreeFieldParams } from "../trees/treeField";

/** `{0.19, 0.39, 0.19}` in 8-bit - utility-constants.lua:201. */
export const TREE_MAP_COLOR: readonly [number, number, number] = [48, 99, 48];
/** The alpha component of the same constant: fully-forested tiles blend at 40%. */
export const TREE_MAX_ALPHA = 0.4;

export interface RenderTreesOptions extends TreeFieldParams {
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
}

export function renderTrees(base: ImageData, opts: RenderTreesOptions): void {
  const { width, height } = base;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const density = makeTreeDensity(opts);

  const isWater = (r: number, g: number, b: number): boolean => {
    for (const [wr, wg, wb] of WATER_TILE_COLORS) {
      if (r === wr && g === wg && b === wb) return true;
    }
    return false;
  };

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      if (isWater(base.data[o], base.data[o + 1], base.data[o + 2])) continue;
      const d = density(originX + px * tpp, wy);
      if (d <= 0) continue;
      const a = TREE_MAX_ALPHA * d;
      base.data[o] = Math.round(base.data[o] * (1 - a) + TREE_MAP_COLOR[0] * a);
      base.data[o + 1] = Math.round(base.data[o + 1] * (1 - a) + TREE_MAP_COLOR[1] * a);
      base.data[o + 2] = Math.round(base.data[o + 2] * (1 - a) + TREE_MAP_COLOR[2] * a);
      base.data[o + 3] = 255;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/renderTrees.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/preview/renderTrees.ts test/renderTrees.spec.ts
git commit -m "feat(preview): blend the tree overlay onto the terrain render"
```

---

### Task 9: Wire `view: "trees"` into the render request

**Files:**
- Modify: `src/noise/preview/elevationRenderRequest.ts` (view union at `:51`, the
  `renderTerrain` branch condition at `:150-156`, and a new dispatch block)
- Test: `test/elevationRenderRequest.spec.ts` (extend)

**Interfaces:**
- Consumes: `renderTrees`, `RenderTreesOptions`.
- Produces: `ElevationRenderRequest.view` gains `"trees"`; new optional
  `treeControls?: { frequency: number; size: number }`.

- [ ] **Step 1: Write the failing test**

Add to `test/elevationRenderRequest.spec.ts`:

```ts
describe("view: trees", () => {
  const base = {
    id: 1,
    seed0: 123456,
    width: 12,
    height: 12,
    originX: 0,
    originY: 0,
    tilesPerPixel: 4,
    waterLevel: 0,
    segmentationMultiplier: 1,
    startingPositions: [{ x: 0, y: 0 }],
    mapType: "nauvis" as const,
  };

  it("renders terrain with the tree overlay composited on top", () => {
    const terrain = runRenderRequest({ ...base, view: "terrain" });
    const trees = runRenderRequest({ ...base, view: "trees" });
    expect(Array.from(new Uint8ClampedArray(trees.buffer))).not.toEqual(
      Array.from(new Uint8ClampedArray(terrain.buffer)),
    );
  });

  it("includes trees in the all-composite", () => {
    const withoutTrees = runRenderRequest({ ...base, view: "cliffs" });
    const all = runRenderRequest({ ...base, view: "all" });
    expect(Array.from(new Uint8ClampedArray(all.buffer))).not.toEqual(
      Array.from(new Uint8ClampedArray(withoutTrees.buffer)),
    );
  });

  it("honors treeControls", () => {
    const a = runRenderRequest({ ...base, view: "trees" });
    const b = runRenderRequest({
      ...base,
      view: "trees",
      treeControls: { frequency: 3, size: 2 },
    });
    expect(Array.from(new Uint8ClampedArray(a.buffer))).not.toEqual(
      Array.from(new Uint8ClampedArray(b.buffer)),
    );
  });

  it("defaults treeControls to 1/1 when omitted", () => {
    const implicit = runRenderRequest({ ...base, view: "trees" });
    const explicit = runRenderRequest({
      ...base,
      view: "trees",
      treeControls: { frequency: 1, size: 1 },
    });
    expect(Array.from(new Uint8ClampedArray(implicit.buffer))).toEqual(
      Array.from(new Uint8ClampedArray(explicit.buffer)),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationRenderRequest.spec.ts`
Expected: FAIL - `"trees"` is not assignable to the `view` union.

- [ ] **Step 3: Implement the wiring**

In `src/noise/preview/elevationRenderRequest.ts`:

Add the import beside the others:

```ts
import { renderTrees } from "./renderTrees";
```

Extend the `view` union (line 51) to include `"trees"`:

```ts
  view?: "elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "trees" | "all";
```

Add the control field after `cliffSettings`:

```ts
  /**
   * The `trees` autoplace control's frequency/size (control:trees:*) - consumed
   * only when `view: "trees"` or `"all"`. Defaults to `{ frequency: 1, size: 1 }`.
   */
  treeControls?: { readonly frequency: number; readonly size: number };
```

Add `"trees"` to the terrain-branch condition:

```ts
  if (
    req.view === "terrain" ||
    req.view === "resources" ||
    req.view === "enemies" ||
    req.view === "cliffs" ||
    req.view === "trees" ||
    req.view === "all"
  ) {
```

Insert the tree dispatch **immediately after `renderTerrain`, before the
resources block** - trees are a background wash, so ore, bases and cliffs paint on
top of them:

```ts
    if (req.view === "trees" || req.view === "all") {
      renderTrees(image, {
        seed0: req.seed0,
        originX: req.originX,
        originY: req.originY,
        tilesPerPixel: req.tilesPerPixel,
        treesFrequency: req.treeControls?.frequency ?? 1,
        treesSize: req.treeControls?.size ?? 1,
        segmentationMultiplier: req.segmentationMultiplier,
        moistureFrequency: req.moistureFrequency,
        moistureBias: req.moistureBias,
        startingAreaMoistureSize: req.startingAreaMoistureSize,
        startingAreaMoistureFrequency: req.startingAreaMoistureFrequency,
        startingPositions: req.startingPositions,
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationRenderRequest.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/noise/preview/elevationRenderRequest.ts test/elevationRenderRequest.spec.ts
git commit -m "feat(preview): add the trees view and composite it under the overlays"
```

---

### Task 10: Tiled equality

Trees are evaluated per pixel with no neighbourhood query, so no halo is needed -
unlike cliffs. Prove that rather than assume it.

**Files:**
- Modify: `test/tiledEquality.spec.ts`

- [ ] **Step 1: Add the view to the existing gate**

In `test/tiledEquality.spec.ts:87`, add `"trees"` to the swept view list:

```ts
const VIEWS = ["elevation", "terrain", "resources", "enemies", "cliffs", "trees", "all"] as const;
```

- [ ] **Step 2: Run the test**

Run: `pnpm vp test test/tiledEquality.spec.ts`
Expected: PASS for all seven views. A `trees` failure would mean the overlay reads
outside its own pixel, which it must not - fix `renderTrees`, not the test.

- [ ] **Step 3: Commit**

```bash
pnpm vp check --fix
git add test/tiledEquality.spec.ts
git commit -m "test(preview): prove the tiled trees render equals the untiled one"
```

---

### Task 11: Derive `treeControls` from the preset

Control levers are derived in the model, not the component - `elevationCtxFromPreset`
is where `cliffControls`/`enemyControls`/`resourceControls` come from, and the
component only forwards them. Follow that.

**Files:**
- Modify: `src/model/elevationPreviewCtx.ts` (the `ElevationPreviewCtx` interface,
  and the return of `elevationCtxFromPreset` at `:97-110`)
- Test: `test/elevationPreviewCtx.spec.ts` (extend)

**Interfaces:**
- Produces: `ElevationPreviewCtx.treeControls: { frequency: number; size: number }`.

- [ ] **Step 1: Write the failing test**

Add to `test/elevationPreviewCtx.spec.ts`, matching the file's existing style for
the `enemyControls` / `cliffControls` cases:

```ts
it("reads treeControls off the trees autoplace control", () => {
  const preset = getBuiltinPreset("Default");
  preset.autoplaceControls.trees = { frequency: 3, size: 2, richness: 1 };
  expect(elevationCtxFromPreset(preset).treeControls).toEqual({ frequency: 3, size: 2 });
});

it("defaults treeControls to 1/1 when the trees control is absent", () => {
  const preset = getBuiltinPreset("Default");
  delete preset.autoplaceControls.trees;
  expect(elevationCtxFromPreset(preset).treeControls).toEqual({ frequency: 1, size: 1 });
});
```

Use whatever preset-construction helper the file already uses; if it does not
import `getBuiltinPreset`, follow its existing pattern rather than adding an import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: FAIL - `treeControls` does not exist on `ElevationPreviewCtx`.

- [ ] **Step 3: Implement**

Add to the `ElevationPreviewCtx` interface, beside `cliffControls`:

```ts
  /**
   * The `trees` autoplace control's frequency/size (control:trees:*) - consumed
   * only by the `view: "trees"` overlay (renderTrees). Absent defaults to
   * `{ frequency: 1, size: 1 }`. Faithful only on the Nauvis map type, same as the
   * terrain/resources/enemies/cliffs views.
   */
  treeControls: { readonly frequency: number; readonly size: number };
```

And in `elevationCtxFromPreset`, beside the `cc` lookup:

```ts
  const tc = preset.autoplaceControls.trees;
```

then in the returned object, after `cliffControls`:

```ts
    treeControls: tc ? { frequency: tc.frequency, size: tc.size } : { frequency: 1, size: 1 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationPreviewCtx.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/model/elevationPreviewCtx.ts test/elevationPreviewCtx.spec.ts
git commit -m "feat(model): derive treeControls from the trees autoplace control"
```

---

### Task 12: The Trees view toggle

**Files:**
- Modify: `src/components/ElevationPreviewPanel.vue` (the `view` ref at `:46`, the
  request build at `:109`, the `view-toggle` group in the template)
- Test: `test/elevationPreviewPanel.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `test/elevationPreviewPanel.spec.ts`, copying the shape of the existing
cliffs toggle test at `:207` verbatim (it uses the file's `stubCanvas`,
`okRenderer`, and `setup(mapTypeId, renderer)` helpers):

```ts
  it("passes view:'trees' + treeControls after selecting the Trees toggle (Nauvis)", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-trees"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-trees"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "trees", mapType: "nauvis" });
    expect(arg.treeControls).toEqual({ frequency: 1, size: 1 });
  });

  it("disables the Trees toggle on a non-Nauvis map type", async () => {
    stubCanvas();
    const w = setup("lakes", okRenderer());
    expect(w.find('[data-test="view-trees"]').attributes("disabled")).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL - no `view-trees` element.

- [ ] **Step 3: Add the toggle**

In `src/components/ElevationPreviewPanel.vue`, extend the `view` ref type (line 46):

```ts
const view = ref<
  "elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "trees" | "all"
>("all");
```

Forward the control where the other three are forwarded (after line 109):

```ts
        treeControls: info.treeControls,
```

Add a button to the `view-toggle` group, copying the structure of the existing
`view-cliffs` button (same classes, same `:disabled`/`:title` pattern keyed on
`terrainAvailable`):

```html
<button
  data-test="view-trees"
  :class="{ active: view === 'trees' }"
  :disabled="!terrainAvailable"
  :title="terrainAvailable ? undefined : 'Trees view is only available for the Nauvis map type'"
  @click="view = 'trees'"
>
  Trees
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm vp check --fix
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "feat(ui): add the Trees preview view toggle"
```

---

### Task 13: Measure, eyeball, and record

The spec requires the render cost to be measured and recorded, not assumed, and
the forests to be checked against the real game.

**Files:**
- Create: `docs/noise/trees-NOTES.md`
- Modify: `docs/noise/client-preview-ROADMAP.md` (the M4 trees line)

- [ ] **Step 1: Run the full suite**

Run: `pnpm vp test`
Expected: all green. Record the total test count.

- [ ] **Step 2: Measure the render cost**

Run: `pnpm perf`

Record the `terrain`, `all`, and (if the perf spec sweeps views) `trees` numbers.
Then measure in the browser, which is the number that counts - the Node bench runs
about 15% optimistic (see the `render-perf-tiling` note): run `pnpm vp dev`, enable
Debug, and take the median of 3 elapsed-ms readings at 1024x1024 for `all` with and
without trees.

- [ ] **Step 3: Eyeball against the real game**

Generate a reference preview at the same seed and region. These are the flags
`preview-service/container/render.mjs:12-24` actually uses - there is no
`--map-preview-scale`, and `--map-preview-size 1024` yields the same 1024-tile
origin-centered view the app renders (see the preview-lineup spec):

```bash
BIN="$HOME/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio"
echo '{"seed":123456}' > /tmp/trees-mgs.json
"$BIN" --generate-map-preview /tmp/trees-ref.png \
  --map-gen-settings /tmp/trees-mgs.json \
  --map-preview-planet nauvis \
  --map-gen-seed 123456 \
  --map-preview-size 1024
```

If the run collides with a running game, add an isolated `--config` INI whose
`write-data` points at a temp dir, the same trick `test/oracle/oracle.ts` uses.

Compare against the app's `all` view at the same seed. The bar is **"the same
forests in the same places with the same shape"** - the game's preview shows
stippled individual trees while ours shows expected density, so pixel agreement is
explicitly NOT the standard here. Pixel agreement is Phase 2's bar and is
unreachable without the placement roll.

If the forests are in visibly different places, that is a real finding - stop and
report rather than tuning constants.

- [ ] **Step 4: Write the notes file**

Create `docs/noise/trees-NOTES.md` recording, with real measured numbers:

- The map-preview RE (the `computeEntities` / `chartEntities` call chain and
  addresses, the `Chart::drawEntity` charting path, the tree chart color and its
  40% alpha, and the absence of a `DecorativeMapGenerationTask` symbol).
- The uniform species shape and a pointer to the catalog.
- The measured worst oracle residual per species from Task 5.
- The measured `BASIS_ABS_MAX` and the headroom observed in Task 7.
- The measured render cost with and without trees, and how much the early-out
  saved.
- What Phase 2 would need (the full autoplacer set, group order, jitter draws) and
  a pointer to `placement-roll-NOTES.md`.

- [ ] **Step 5: Update the roadmap**

In `docs/noise/client-preview-ROADMAP.md`, change the M4 line

```
- [ ] Trees / decoratives (optional for a preview).
```

to a `[x]` entry that states what shipped (density-shaded trees, 15 species,
oracle-validated), states that decoratives were proven out of scope by the binary,
and links `trees-NOTES.md` and the design spec. Follow the phrasing style of the
existing cliffs and enemy-bases entries.

- [ ] **Step 6: Commit**

```bash
pnpm vp check --fix
git add docs/noise/trees-NOTES.md docs/noise/client-preview-ROADMAP.md
git commit -m "docs(preview): record the tree port, its RE, and its measured cost"
```

---

## Verification

Before declaring the branch done:

```bash
pnpm vp test          # everything green
pnpm vp check --fix   # clean
pnpm vp build         # production build succeeds
```

Then confirm by looking at the app, not by assertion: forests appear on Nauvis,
absent on water, thinning at forest paths, and the Trees frequency/size sliders on
the Terrain tab visibly change them.

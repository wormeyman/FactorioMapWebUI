// Manual render-cost benchmark - NOT a pass/fail gate (timing is machine-
// dependent). Skipped by default so `vp test` stays fast; run it with:
//
//     pnpm perf
//
// which sets FMW_PERF=1, runs this file, and prints the table it writes to
// perf-result.txt (gitignored). This is the baseline to measure region-tiling
// (or any render optimization) against - see the render-tiling design doc.
import { writeFileSync } from "node:fs";
import { it } from "vite-plus/test";
import { runRenderRequest } from "../src/noise/preview/elevationRenderRequest";
import { renderTerrain } from "../src/noise/preview/renderTerrain";
import { renderResources } from "../src/noise/preview/renderResources";
import { renderEnemies } from "../src/noise/preview/renderEnemies";
import { renderCliffs } from "../src/noise/preview/renderCliffs";

// In the default suite FMW_PERF is unset -> this becomes it.skip (instant).
const perfIt = process.env.FMW_PERF ? it : it.skip;

const N = 1024;
const HALF = N / 2;
const SEED = 123456;
const base = {
  id: 0,
  seed0: SEED,
  width: N,
  height: N,
  originX: -HALF,
  originY: -HALF,
  tilesPerPixel: 1,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
  mapType: "nauvis" as const,
};

const median = (xs: number[]): number =>
  xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows: string[] = [];
const time = (label: string, fn: () => void, iters = 3): number => {
  fn(); // warm-up (JIT)
  const ts: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  const m = median(ts);
  rows.push(`${label.padEnd(30)} ${m.toFixed(0).padStart(6)} ms`);
  return m;
};

perfIt(
  "render cost by layer @ 1024x1024 / 1 tile-per-pixel",
  () => {
    const elev = time("elevation only", () => runRenderRequest({ ...base, view: "elevation" }));
    const terrain = time("terrain (elev+climate+tiles)", () =>
      runRenderRequest({ ...base, view: "terrain" }),
    );
    time("terrain + resources", () => runRenderRequest({ ...base, view: "resources" }));
    time("terrain + enemies", () => runRenderRequest({ ...base, view: "enemies" }));
    time("terrain + cliffs", () => runRenderRequest({ ...base, view: "cliffs" }));

    const terrainCtx = {
      seed0: SEED,
      width: N,
      height: N,
      originX: base.originX,
      originY: base.originY,
      tilesPerPixel: 1,
      ctx: { segmentationMultiplier: 1, startingPositions: base.startingPositions },
    };
    const oc = {
      seed0: SEED,
      originX: base.originX,
      originY: base.originY,
      tilesPerPixel: 1,
      segmentationMultiplier: 1,
      waterLevel: 0,
      startingPositions: base.startingPositions,
    };
    const all = time("ALL (terrain + 3 overlays)", () => {
      const img = renderTerrain(terrainCtx);
      renderResources(img, { ...oc, controls: {} });
      renderEnemies(img, {
        seed0: SEED,
        originX: base.originX,
        originY: base.originY,
        tilesPerPixel: 1,
        controls: { frequency: 1, size: 1 },
        startingPositions: base.startingPositions,
      });
      renderCliffs(img, {
        ...oc,
        controls: { frequency: 1, continuity: 1 },
        settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
      });
    });

    const header = `render cost @ ${N}x${N}, tpp 1, seed ${SEED} (median of 3)`;
    const summary = [
      "",
      `climate+tiles portion of terrain: ~${(terrain - elev).toFixed(0)} ms (the tiling target)`,
      `all 3 overlays add over terrain:  ~${(all - terrain).toFixed(0)} ms`,
    ].join("\n");
    writeFileSync(
      "perf-result.txt",
      `${header}\n${"-".repeat(header.length)}\n${rows.join("\n")}\n${summary}\n`,
    );
  },
  600000,
);

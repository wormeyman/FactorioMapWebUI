import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-biomes.seed123456.json";
import { withCtxDefaults } from "../src/noise/eval/ctx";
import { makeVulcanusBiomes } from "../src/noise/expressions/vulcanusBiomes";
import { makeVulcanusCracks } from "../src/noise/expressions/vulcanusCracks";
import { makeVulcanusHelpers } from "../src/noise/expressions/vulcanusHelpers";
import { makeVulcanusSpawn } from "../src/noise/expressions/vulcanusSpawn";

describe("makeVulcanusBiomes", () => {
  const ctx = withCtxDefaults({ seed0: fixture.seed0 });
  const helpers = makeVulcanusHelpers(ctx);
  const spawn = makeVulcanusSpawn(ctx, helpers);
  const cracks = makeVulcanusCracks(ctx, helpers);
  const biomes = makeVulcanusBiomes(ctx, helpers, spawn, cracks);
  const positions = fixture.positions;
  const v = fixture.values;

  // Each bound is the measured worst residual (rounded up with modest headroom),
  // NOT a loosened tolerance. Residuals are dominated by the far-from-origin f32
  // coordinate floor (the same one documented across the elevation/vulcanus specs);
  // the volcano-spot cone field additionally carries the ~f32 cone-edge residual
  // the resource patches document (rendered in the game's f32 noise machine). The
  // whole chain lands well under 3.1e-4 - the spot-noise field itself matches to
  // 3.8e-5, which is the strong signal that the spot_noise arg mapping is correct.
  const check = (fn: (x: number, y: number) => number, want: number[], bound: number): void => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      worst = Math.max(worst, Math.abs(fn(p.x, p.y) - want[i]));
    }
    expect(worst).toBeLessThan(bound);
  };

  it("mountain_volcano_spots matches the oracle (spot-noise volcano field)", () => {
    check(biomes.mountainVolcanoSpots, v.mountain_volcano_spots, 1e-4);
  });

  it("vulcanus_mountains_raw_volcano matches the oracle", () => {
    check(biomes.mountainsRawVolcano, v.vulcanus_mountains_raw_volcano, 5e-4);
  });

  it("vulcanus_mountains_biome_full matches the oracle", () => {
    check(biomes.mountainsBiomeFull, v.vulcanus_mountains_biome_full, 5e-4);
  });

  it("vulcanus_ashlands_biome_full matches the oracle", () => {
    check(biomes.ashlandsBiomeFull, v.vulcanus_ashlands_biome_full, 5e-4);
  });

  it("vulcanus_basalts_biome_full matches the oracle", () => {
    check(biomes.basaltsBiomeFull, v.vulcanus_basalts_biome_full, 5e-4);
  });

  it("vulcanus_mountains_biome (clamped 0-1) matches the oracle", () => {
    check(biomes.mountainsBiome, v.vulcanus_mountains_biome, 5e-4);
  });

  it("vulcanus_ashlands_biome (clamped 0-1) matches the oracle", () => {
    check(biomes.ashlandsBiome, v.vulcanus_ashlands_biome, 5e-4);
  });

  it("vulcanus_basalts_biome (clamped 0-1) matches the oracle", () => {
    check(biomes.basaltsBiome, v.vulcanus_basalts_biome, 5e-4);
  });
});

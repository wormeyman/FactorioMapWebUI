import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-elevation.seed123456.json";
import temperatureFixture from "./fixtures/oracle-vulcanus-temperature.seed123456.json";
import { withCtxDefaults } from "../src/noise/eval/ctx";
import { makeVulcanusBiomes } from "../src/noise/expressions/vulcanusBiomes";
import { makeVulcanusClimate } from "../src/noise/expressions/vulcanusClimate";
import { makeVulcanusCracks } from "../src/noise/expressions/vulcanusCracks";
import {
  makeVulcanusElevation,
  makeVulcanusTemperature,
} from "../src/noise/expressions/vulcanusElevation";
import { makeVulcanusHelpers } from "../src/noise/expressions/vulcanusHelpers";
import { makeVulcanusSpawn } from "../src/noise/expressions/vulcanusSpawn";

describe("makeVulcanusElevation", () => {
  const ctx = withCtxDefaults({ seed0: fixture.seed0 });
  const helpers = makeVulcanusHelpers(ctx);
  const spawn = makeVulcanusSpawn(ctx, helpers);
  const cracks = makeVulcanusCracks(ctx, helpers);
  const biomes = makeVulcanusBiomes(ctx, helpers, spawn, cracks);
  const climate = makeVulcanusClimate(ctx, helpers, cracks);
  const elevation = makeVulcanusElevation(ctx, helpers, biomes, cracks, climate);
  const positions = fixture.positions;

  // Each bound is the MEASURED worst residual (rounded up with modest headroom),
  // NOT a loosened tolerance. Elevation is an amplified sum (the mountains blend
  // reaches ~1000, ashlands ~300), so the same far-from-origin f32 coordinate floor
  // that shows up at ~1e-4 in the unit-scale climate/biome fields is scaled up here.
  // The proof this is the coordinate floor (not a blend/multisample bug): near-spawn
  // (|x|,|y|<300) matches to 7.2e-3 on values up to ~1000 (relative ~1e-5), and every
  // worst point is a far ring point (r=1500/3000); the single worst (1.33e-1) sits at
  // a lerp near-cancellation (answer ~-12) where f32 input error is amplified. A
  // mis-ordered lerp or wrong multisample neighbours would break near-spawn too.
  // Measured worst: 1.33e-1 (both elev and its max(-500,...) clamp coincide - the
  // clamp never triggers on this grid, min elev ~-59).
  const check = (fn: (x: number, y: number) => number, want: number[], bound: number): void => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      worst = Math.max(worst, Math.abs(fn(p.x, p.y) - want[i]));
    }
    expect(worst).toBeLessThan(bound);
  };

  it("vulcanus_elev (raw) matches the oracle to the elevation-scale f32 floor", () => {
    check(elevation.elev, fixture.elev, 1.5e-1);
  });

  it("vulcanus_elevation (= max(-500, elev)) matches the oracle", () => {
    check(elevation.elevation, fixture.elevation, 1.5e-1);
  });

  // Task 7's deferred temperature, now that vulcanus_elev exists. It reads the RAW
  // elev, so it inherits the same amplified far-field f32 floor (the elev term is the
  // dominant one; -min(elev, elev/100) contributes the elev magnitude directly).
  // Measured worst: 1.33e-1 (own fixture, same far r=3000 point; near-spawn 1.4e-3),
  // at control:temperature:bias = 0.
  it("vulcanus_temperature matches the oracle (closes Task 7's deferral)", () => {
    const temperature = makeVulcanusTemperature(ctx, climate, biomes, elevation);
    let worst = 0;
    const tPositions = temperatureFixture.positions;
    for (let i = 0; i < tPositions.length; i++) {
      const p = tPositions[i];
      worst = Math.max(worst, Math.abs(temperature(p.x, p.y) - temperatureFixture.temperature[i]));
    }
    expect(worst).toBeLessThan(1.5e-1);
  });
});

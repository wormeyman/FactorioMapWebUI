import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-spawn.seed123456.json";
import { withCtxDefaults } from "../src/noise/eval/ctx";
import { makeVulcanusHelpers } from "../src/noise/expressions/vulcanusHelpers";
import { makeVulcanusSpawn } from "../src/noise/expressions/vulcanusSpawn";

describe("makeVulcanusSpawn", () => {
  const ctx = withCtxDefaults({ seed0: fixture.seed0 });
  const helpers = makeVulcanusHelpers(ctx);
  const spawn = makeVulcanusSpawn(ctx, helpers);
  const positions = fixture.positions;

  it("vulcanus_starting_area matches the oracle to the f32 floor", () => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const got = spawn.startingArea(p.x, p.y);
      const want = fixture.startingArea[i];
      worst = Math.max(worst, Math.abs(got - want));
    }
    // Measured worst 2.03e-6 over the 410-point grid spanning spawn.
    expect(worst).toBeLessThan(1e-4);
  });

  it("vulcanus_starting_circle matches the oracle to the f32 floor", () => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const got = spawn.startingCircle(p.x, p.y);
      const want = fixture.startingCircle[i];
      worst = Math.max(worst, Math.abs(got - want));
    }
    // Measured worst 1.17e-6 (pure arithmetic over `distance`, no noise).
    expect(worst).toBeLessThan(1e-4);
  });

  it("vulcanus_ashlands_start matches the oracle to the f32 floor", () => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const got = spawn.ashlandsStart(p.x, p.y);
      const want = fixture.ashlandsStart[i];
      worst = Math.max(worst, Math.abs(got - want));
    }
    // Measured worst 4.26e-6 over the 410-point grid spanning spawn.
    expect(worst).toBeLessThan(1e-4);
  });

  it("computes starting_direction and ashlands_angle from the seed vars", () => {
    // Cross-check against the ctx's own seed-derived free vars (Task 2), not a
    // hand-picked number - this is the exact expression the game uses.
    expect(spawn.startingDirection).toBe(-1 + 2 * (ctx.mapSeedSmall & 1));
    expect(spawn.ashlandsAngle).toBe(ctx.mapSeedNormalized * 3600);
    expect(spawn.mountainsAngle).toBe(spawn.ashlandsAngle + 120 * spawn.startingDirection);
    expect(spawn.basaltsAngle).toBe(spawn.ashlandsAngle + 240 * spawn.startingDirection);
  });
});

import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-starting-spot.seed123456.json";
import { startingSpotAtAngle } from "../src/noise/expressions/vulcanusShared";

// starting_spot_at_angle (core/prototypes/noise-functions.lua):
//   angle_rad = angle / 180 * pi
//   delta_x   = distance * sin(angle_rad) - x_from_start + x_distortion
//   delta_y   = -distance * cos(angle_rad) - y_from_start + y_distortion
//   result    = 1 - (delta_x*delta_x + delta_y*delta_y)^0.5 / radius
//
// Expectations below are hand-derived directly from that formula (not copied
// from the implementation), picked so the trig terms either vanish exactly
// (sin(90deg) = 1, cos(90deg) ~ 0) or cancel to a clean Pythagorean triple.
describe("startingSpotAtAngle reproduces starting_spot_at_angle", () => {
  it("is 1 exactly on-center (x_from_start cancels distance*sin at angle=90)", () => {
    // angle_rad = pi/2, sin = 1, cos ~ 0 (negligible, ~6.12e-17).
    // delta_x = 170*1 - 170 + 0 = 0; delta_y = -170*~0 - 0 + 0 ~ 0.
    const result = startingSpotAtAngle({
      angle: 90,
      distance: 170,
      radius: 350,
      xDistortion: 0,
      yDistortion: 0,
      xFromStart: 170,
      yFromStart: 0,
    });
    expect(result).toBeCloseTo(1, 10);
  });

  it("is 0 exactly at `radius` distance (pure x_distortion offset, angle=0/distance=0)", () => {
    // angle_rad = 0, sin = 0, cos = 1.
    // delta_x = 0*0 - 0 + 350 = 350; delta_y = -0*1 - 0 + 0 = 0.
    // sqrt(350^2 + 0^2) = 350; result = 1 - 350/350 = 0.
    const result = startingSpotAtAngle({
      angle: 0,
      distance: 0,
      radius: 350,
      xDistortion: 350,
      yDistortion: 0,
      xFromStart: 0,
      yFromStart: 0,
    });
    expect(result).toBeCloseTo(0, 10);
  });

  it("matches a distorted case built on a 3-4-5 (scaled) triangle", () => {
    // angle_rad = pi/2, sin = 1, cos ~ 0 (negligible).
    // delta_x = 50*1 - 5 + 3 = 48; delta_y = -50*~0 - 4 + 40 ~ 36.
    // sqrt(48^2 + 36^2) = sqrt(2304 + 1296) = sqrt(3600) = 60.
    // result = 1 - 60/100 = 0.4.
    const result = startingSpotAtAngle({
      angle: 90,
      distance: 50,
      radius: 100,
      xDistortion: 3,
      yDistortion: 40,
      xFromStart: 5,
      yFromStart: 4,
    });
    expect(result).toBeCloseTo(0.4, 9);
  });
});

describe("startingSpotAtAngle against the oracle (Factorio 2.1.12, Space Age, Vulcanus)", () => {
  it("matches every fixture point/config to the f32 coordinate floor", () => {
    // x_from_start/y_from_start resolve to the raw world (x, y) at this
    // default origin spawn (Task 2 finding), so callers pass the sampled
    // position itself for both.
    let worst = 0;
    let worstLabel = "";
    for (const c of fixture.cases) {
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const result = startingSpotAtAngle({
          angle: c.angle,
          distance: c.distance,
          radius: c.radius,
          xDistortion: c.xDistortion,
          yDistortion: c.yDistortion,
          xFromStart: p.x,
          yFromStart: p.y,
        });
        const err = Math.abs(result - c.values[i]);
        if (err > worst) {
          worst = err;
          worstLabel = `angle=${c.angle} distance=${c.distance} @(${p.x},${p.y})`;
        }
      }
    }
    // No fastapprox noise term here (pure arithmetic + real sin/cos), so the
    // residual is far below the elevation f32-coordinate floor (8e-3) used
    // elsewhere in this preview. Observed worst here is ~1.41e-6
    // (@(12345.75, 6789.125), the deep-field point, angle=0/distance=100);
    // calibrated just above it - never loosen this without a new
    // observed-worst measurement to justify it.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(3e-6);
  });
});

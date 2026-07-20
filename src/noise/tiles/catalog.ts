/**
 * The 21 Nauvis autoplace tiles as data (Task 9): name, `map_color`, and a
 * `probability(env)` closure transcribed verbatim from the design spec's tile
 * table (docs/superpowers/specs/2026-07-19-milestone2-climate-terrain-design.md,
 * "The 21 Nauvis tiles" section), which is itself transcribed from the game's
 * `base/prototypes/tile/tiles.lua` `probability_expression` + `map_color` fields.
 *
 * Tile selection is a pure argmax over these 21 `probability(env)` values (Task
 * 10's `resolveTile`); this module only builds the catalog, it does not resolve.
 *
 * Every land tile's expression is `expression_in_range_base(...)` (climate box
 * over aux/moisture) plus a per-tile `noise_layer_noise(N)` jitter, some as a
 * `max(...)` of two climate boxes. The two water tiles use `water_base` only -
 * no noise layer, no climate dependence. `sand-1` additionally ORs in an
 * unbounded (`peakMaximum = Infinity`) coastal `expression_in_range` term over
 * (elevation, aux) - see `expressionInRange`'s doc comment for why the plateau
 * is uncapped there.
 */

import { max } from "../eval/math";
import { expressionInRange } from "./expressionInRange";
import { expressionInRangeBase, makeNoiseLayerNoise, waterBase } from "./helpers";

export interface TileEnv {
  x: number;
  y: number;
  elevation: number;
  aux: number;
  moisture: number;
}

export interface Tile {
  name: string;
  /** `[r, g, b, 255]`, 0-255 verbatim from the spec's `map_color` column. */
  color: [number, number, number, number];
  probability(env: TileEnv): number;
}

/**
 * Builds the 21-tile catalog for a given map seed (`seed0`). Each land tile's
 * `noise_layer_noise(N)` closure is constructed once here (via
 * `makeNoiseLayerNoise(seed0, N)`) and captured by that tile's `probability`,
 * rather than rebuilt per call.
 */
export function makeTileCatalog(seed0: number): Tile[] {
  // noise_layer_noise seeds used across the 19 land tiles: 6-13, 19-22, 30-33, 36-38.
  const noiseLayer6 = makeNoiseLayerNoise(seed0, 6);
  const noiseLayer7 = makeNoiseLayerNoise(seed0, 7);
  const noiseLayer8 = makeNoiseLayerNoise(seed0, 8);
  const noiseLayer9 = makeNoiseLayerNoise(seed0, 9);
  const noiseLayer10 = makeNoiseLayerNoise(seed0, 10);
  const noiseLayer11 = makeNoiseLayerNoise(seed0, 11);
  const noiseLayer12 = makeNoiseLayerNoise(seed0, 12);
  const noiseLayer13 = makeNoiseLayerNoise(seed0, 13);
  const noiseLayer19 = makeNoiseLayerNoise(seed0, 19);
  const noiseLayer20 = makeNoiseLayerNoise(seed0, 20);
  const noiseLayer21 = makeNoiseLayerNoise(seed0, 21);
  const noiseLayer22 = makeNoiseLayerNoise(seed0, 22);
  const noiseLayer30 = makeNoiseLayerNoise(seed0, 30);
  const noiseLayer31 = makeNoiseLayerNoise(seed0, 31);
  const noiseLayer32 = makeNoiseLayerNoise(seed0, 32);
  const noiseLayer33 = makeNoiseLayerNoise(seed0, 33);
  const noiseLayer36 = makeNoiseLayerNoise(seed0, 36);
  const noiseLayer37 = makeNoiseLayerNoise(seed0, 37);
  const noiseLayer38 = makeNoiseLayerNoise(seed0, 38);

  return [
    {
      // water_base(-2, 200)
      name: "deepwater",
      color: [38, 64, 73, 255],
      probability: (env) => waterBase(env.elevation, -2, 200),
    },
    {
      // water_base(0, 100)
      name: "water",
      color: [51, 83, 95, 255],
      probability: (env) => waterBase(env.elevation, 0, 100),
    },
    {
      // expression_in_range_base(-10,0.7,11,11) + noise_layer_noise(19)
      name: "grass-1",
      color: [55, 53, 11, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.7, 11, 11) + noiseLayer19(env.x, env.y),
    },
    {
      // expression_in_range_base(0.45,0.45,11,0.8) + noise_layer_noise(20)
      name: "grass-2",
      color: [66, 57, 15, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, 0.45, 0.45, 11, 0.8) +
        noiseLayer20(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.6,0.65,0.9) + noise_layer_noise(21)
      name: "grass-3",
      color: [65, 52, 28, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.6, 0.65, 0.9) +
        noiseLayer21(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.5,0.55,0.7) + noise_layer_noise(22)
      name: "grass-4",
      color: [59, 40, 18, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.5, 0.55, 0.7) +
        noiseLayer22(env.x, env.y),
    },
    {
      // expression_in_range_base(0.45,-10,0.55,0.35) + noise_layer_noise(13)
      name: "dry-dirt",
      color: [94, 66, 37, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, 0.45, -10, 0.55, 0.35) +
        noiseLayer13(env.x, env.y),
    },
    {
      // max(expression_in_range_base(-10,0.25,0.45,0.3), expression_in_range_base(0.4,-10,0.45,0.25)) + noise_layer_noise(6)
      name: "dirt-1",
      color: [141, 104, 60, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, -10, 0.25, 0.45, 0.3),
          expressionInRangeBase(env.aux, env.moisture, 0.4, -10, 0.45, 0.25),
        ) + noiseLayer6(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.3,0.45,0.35) + noise_layer_noise(7)
      name: "dirt-2",
      color: [136, 96, 59, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.3, 0.45, 0.35) +
        noiseLayer7(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.35,0.55,0.4) + noise_layer_noise(8)
      name: "dirt-3",
      color: [133, 92, 53, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.35, 0.55, 0.4) +
        noiseLayer8(env.x, env.y),
    },
    {
      // max(expression_in_range_base(0.55,-10,0.6,0.35), expression_in_range_base(0.6,0.3,11,0.35)) + noise_layer_noise(9)
      name: "dirt-4",
      color: [103, 72, 43, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, 0.55, -10, 0.6, 0.35),
          expressionInRangeBase(env.aux, env.moisture, 0.6, 0.3, 11, 0.35),
        ) + noiseLayer9(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.4,0.55,0.45) + noise_layer_noise(10)
      name: "dirt-5",
      color: [91, 63, 38, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.4, 0.55, 0.45) +
        noiseLayer10(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.45,0.55,0.5) + noise_layer_noise(11)
      name: "dirt-6",
      color: [80, 55, 31, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.45, 0.55, 0.5) +
        noiseLayer11(env.x, env.y),
    },
    {
      // expression_in_range_base(-10,0.5,0.55,0.55) + noise_layer_noise(12)
      name: "dirt-7",
      color: [80, 54, 28, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, -10, 0.5, 0.55, 0.55) +
        noiseLayer12(env.x, env.y),
    },
    {
      // max(expression_in_range_base(-10,-10,0.25,0.15),
      //     expression_in_range(5, inf, elevation, aux, -1.5, 0.5, 1.5, 1)) + noise_layer_noise(36)
      name: "sand-1",
      color: [138, 103, 58, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, -10, -10, 0.25, 0.15),
          expressionInRange(5, Infinity, [env.elevation, env.aux], [-1.5, 0.5], [1.5, 1]),
        ) + noiseLayer36(env.x, env.y),
    },
    {
      // max(expression_in_range_base(-10,0.15,0.3,0.2), expression_in_range_base(0.25,-10,0.3,0.15)) + noise_layer_noise(37)
      name: "sand-2",
      color: [128, 93, 52, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, -10, 0.15, 0.3, 0.2),
          expressionInRangeBase(env.aux, env.moisture, 0.25, -10, 0.3, 0.15),
        ) + noiseLayer37(env.x, env.y),
    },
    {
      // max(expression_in_range_base(-10,0.2,0.4,0.25), expression_in_range_base(0.3,-10,0.4,0.2)) + noise_layer_noise(38)
      name: "sand-3",
      color: [115, 83, 47, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, -10, 0.2, 0.4, 0.25),
          expressionInRangeBase(env.aux, env.moisture, 0.3, -10, 0.4, 0.2),
        ) + noiseLayer38(env.x, env.y),
    },
    {
      // expression_in_range_base(0.55,0.35,11,0.5) + noise_layer_noise(30)
      name: "red-desert-0",
      color: [103, 70, 32, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, 0.55, 0.35, 11, 0.5) +
        noiseLayer30(env.x, env.y),
    },
    {
      // max(expression_in_range_base(0.6,-10,0.7,0.3), expression_in_range_base(0.7,0.25,11,0.3)) + noise_layer_noise(31)
      name: "red-desert-1",
      color: [116, 81, 39, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, 0.6, -10, 0.7, 0.3),
          expressionInRangeBase(env.aux, env.moisture, 0.7, 0.25, 11, 0.3),
        ) + noiseLayer31(env.x, env.y),
    },
    {
      // max(expression_in_range_base(0.7,-10,0.8,0.25), expression_in_range_base(0.8,0.2,11,0.25)) + noise_layer_noise(32)
      name: "red-desert-2",
      color: [116, 84, 43, 255],
      probability: (env) =>
        max(
          expressionInRangeBase(env.aux, env.moisture, 0.7, -10, 0.8, 0.25),
          expressionInRangeBase(env.aux, env.moisture, 0.8, 0.2, 11, 0.25),
        ) + noiseLayer32(env.x, env.y),
    },
    {
      // expression_in_range_base(0.8,-10,11,0.2) + noise_layer_noise(33)
      name: "red-desert-3",
      color: [128, 93, 52, 255],
      probability: (env) =>
        expressionInRangeBase(env.aux, env.moisture, 0.8, -10, 11, 0.2) +
        noiseLayer33(env.x, env.y),
    },
  ];
}

import { clamp } from "../eval/math";
import { makeQuickMultioctaveNoise } from "../quickMultioctaveNoise";

export interface TemperatureParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:temperature:frequency; default 1. */
  readonly frequency?: number;
  /** control:temperature:bias; default 0. */
  readonly bias?: number;
}

/**
 * Compile the `temperature` (= `temperature_basic`) climate tree for one seed into
 * a `(x, y) => temperature` evaluator:
 *
 *   clamp(15 + bias + quick_multioctave_noise{...}, -20, 50)
 *
 * where `15` is the `sea_level_temperature` constant and the noise term is a
 * 4-octave `quick_multioctave_noise` (seed1 = 5), input_scale = frequency/32,
 * output_scale = 1/20, offset_x = 40000/frequency, octave_output_scale_multiplier
 * = 3, octave_input_scale_multiplier = 1/3. Mirrors core/prototypes/noise-programs.lua.
 */
export function makeTemperature(params: TemperatureParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const frequency = params.frequency ?? 1;
  const bias = params.bias ?? 0;

  const quick = makeQuickMultioctaveNoise({
    seed0,
    seed1: 5,
    octaves: 4,
    inputScale: frequency / 32,
    outputScale: 1 / 20,
    offsetX: 40000 / frequency,
    octaveOutputScaleMultiplier: 3,
    octaveInputScaleMultiplier: 1 / 3,
  });

  return (x: number, y: number): number => clamp(15 + bias + quick(x, y), -20, 50);
}

import { clamp } from "../eval/math";
import { makeNauvisShared } from "./nauvisShared";
import { makeQuickMultioctaveNoise } from "../quickMultioctaveNoise";

export interface AuxParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. Threads into nauvis_plateaus via makeNauvisShared. */
  readonly segmentationMultiplier?: number;
  /** control:aux:frequency; default 1. */
  readonly frequency?: number;
  /** control:aux:bias; default 0. */
  readonly bias?: number;
}

/**
 * Compile the `aux` (= `aux_nauvis`, "terrain type") climate tree for one seed
 * into an `(x, y) => aux` evaluator:
 *
 *   clamp(0.5 + bias + 0.06 * (nauvis_plateaus - 0.4) + quick_multioctave_noise{...}, 0, 1)
 *
 * `nauvis_plateaus` is the shared Nauvis sub-tree (also used by
 * `elevation_nauvis`) - see {@link makeNauvisShared}. The noise term is a
 * 4-octave `quick_multioctave_noise` (seed1 = 7), input_scale = frequency/2048,
 * output_scale = 0.25, offset_x = 20000/frequency, octave_output_scale_multiplier
 * = 0.5, octave_input_scale_multiplier = 3. Mirrors core/prototypes/noise-programs.lua.
 */
export function makeAux(params: AuxParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const segmentationMultiplier = params.segmentationMultiplier ?? 1;
  const frequency = params.frequency ?? 1;
  const bias = params.bias ?? 0;

  const { plateaus } = makeNauvisShared({ seed0, segmentationMultiplier });

  const auxNoise = makeQuickMultioctaveNoise({
    seed0,
    seed1: 7,
    octaves: 4,
    inputScale: frequency / 2048,
    outputScale: 0.25,
    offsetX: 20000 / frequency,
    octaveOutputScaleMultiplier: 0.5,
    octaveInputScaleMultiplier: 3,
  });

  return (x: number, y: number): number =>
    clamp(0.5 + bias + 0.06 * (plateaus(x, y) - 0.4) + auxNoise(x, y), 0, 1);
}

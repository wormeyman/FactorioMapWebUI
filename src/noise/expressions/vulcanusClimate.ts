/**
 * Vulcanus's climate fields - `vulcanus_aux` and `vulcanus_moisture` - transcribed
 * verbatim from `space-age/prototypes/planet/planet-vulcanus-map-gen.lua`
 * (`~/GitHub/factorio-data`, tag 2.1.11, lines ~117-159).
 *
 * `vulcanus_temperature` is deliberately NOT ported here: it depends on
 * `vulcanus_elev` (built in a later task, once elevation exists) and on
 * `vulcanus_ashlands_biome` / `mountain_volcano_spots` (already available from
 * Task 8's biome system, but there is no point wiring temperature half-finished).
 * A later task adds `temperature(x, y)` to this same module once `vulcanus_elev`
 * exists, and validates it end to end.
 *
 * Verbatim:
 *
 *   vulcanus_aux = clamp(min(abs(multioctave_noise{seed0 = map_seed, seed1 = 2,
 *                                                   octaves = 5, persistence = 0.6,
 *                                                   input_scale = 0.2, output_scale = 0.6}),
 *                             0.3 - 0.6 * vulcanus_flood_paths),
 *                        0, 1)
 *
 *   vulcanus_moisture = clamp(1
 *                             - abs(multioctave_noise{seed0 = map_seed, seed1 = 4,
 *                                                      octaves = 2, persistence = 0.6,
 *                                                      input_scale = 0.025, output_scale = 0.25})
 *                             - abs(multioctave_noise{seed0 = map_seed, seed1 = 400,
 *                                                      octaves = 3, persistence = 0.62,
 *                                                      input_scale = 0.051144353, output_scale = 0.25})
 *                             - 0.2 * vulcanus_flood_cracks_a,
 *                             0, 1)
 *
 * Both are bare `multioctave_noise` calls (no world-space offset, unlike Nauvis's
 * `quick_multioctave_noise`-based `moisture`/`aux`), so they go straight through
 * {@link makeMultioctaveNoise} - no shared-helper wrapper needed the way
 * `vulcanus_detail_noise`/`vulcanus_plasma` are. `vulcanus_flood_paths` and
 * `vulcanus_flood_cracks_a` are Task 8's crack/flood helpers
 * ({@link makeVulcanusCracks}).
 *
 * Oracle-validated to the f32 floor - see `test/vulcanusClimate.spec.ts` /
 * `test/fixtures/oracle-vulcanus-climate.seed123456.json`.
 */
import type { EvalCtx } from "../eval/ctx";
import { clamp, min } from "../eval/math";
import { memoXY } from "../eval/memoXY";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import type { VulcanusCracks } from "./vulcanusCracks";
import type { VulcanusHelpers } from "./vulcanusHelpers";

export interface VulcanusClimate {
  /** `vulcanus_moisture`. */
  moisture(x: number, y: number): number;
  /** `vulcanus_aux`. */
  aux(x: number, y: number): number;
}

/** Build the Vulcanus climate closures for one seed/ctx. */
export function makeVulcanusClimate(
  ctx: EvalCtx,
  _helpers: VulcanusHelpers,
  cracks: VulcanusCracks,
): VulcanusClimate {
  const seed0 = ctx.seed0;

  const auxNoise = makeMultioctaveNoise({
    seed0,
    seed1: 2,
    octaves: 5,
    persistence: 0.6,
    inputScale: 0.2,
    outputScale: 0.6,
  });

  const moistureNoiseA = makeMultioctaveNoise({
    seed0,
    seed1: 4,
    octaves: 2,
    persistence: 0.6,
    inputScale: 0.025,
    outputScale: 0.25,
  });

  const moistureNoiseB = makeMultioctaveNoise({
    seed0,
    seed1: 400,
    octaves: 3,
    persistence: 0.62,
    inputScale: 0.051144353,
    outputScale: 0.25,
  });

  const aux = memoXY((x: number, y: number): number =>
    clamp(min(Math.abs(auxNoise(x, y)), 0.3 - 0.6 * cracks.floodPaths(x, y)), 0, 1),
  );

  const moisture = memoXY((x: number, y: number): number =>
    clamp(
      1 -
        Math.abs(moistureNoiseA(x, y)) -
        Math.abs(moistureNoiseB(x, y)) -
        0.2 * cracks.floodCracksA(x, y),
      0,
      1,
    ),
  );

  return { moisture, aux };
}

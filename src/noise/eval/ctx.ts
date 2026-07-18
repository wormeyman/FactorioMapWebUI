import type { Point } from "../distanceFromNearestPoint";

export type { Point };

/**
 * The complete free-variable environment the `elevation_lakes` tree needs. Every
 * field maps to a game noise variable: `seed0 = map_seed`,
 * `waterLevel = 10*log2(control:water:size)`, `segmentationMultiplier =
 * control:water:frequency`, and the two spawn/lake point lists. `distance` is NOT
 * stored - it is derived from `startingPositions` at evaluation time (single source
 * of truth). No `control:*` constant is referenced by elevation_lakes, so none are
 * plumbed.
 */
export interface EvalCtx {
  x: number;
  y: number;
  seed0: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  startingLakePositions: Point[];
}

/** Everything except the required `seed0` may be omitted and defaulted. */
export type EvalCtxInput = { seed0: number } & Partial<Omit<EvalCtx, "seed0">>;

/** The far-from-spawn MVP defaults (see the M1 design spec). */
export const DEFAULT_CTX_FIELDS = {
  x: 0,
  y: 0,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }] as Point[],
  startingLakePositions: [] as Point[],
};

/** Apply the M1 defaults over a partial input. Array defaults are fresh per call. */
export function withCtxDefaults(input: EvalCtxInput): EvalCtx {
  return {
    x: input.x ?? DEFAULT_CTX_FIELDS.x,
    y: input.y ?? DEFAULT_CTX_FIELDS.y,
    seed0: input.seed0,
    waterLevel: input.waterLevel ?? DEFAULT_CTX_FIELDS.waterLevel,
    segmentationMultiplier:
      input.segmentationMultiplier ?? DEFAULT_CTX_FIELDS.segmentationMultiplier,
    startingPositions: input.startingPositions ?? [{ x: 0, y: 0 }],
    startingLakePositions: input.startingLakePositions ?? [],
  };
}

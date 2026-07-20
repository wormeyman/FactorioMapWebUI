import { basisNoiseTablesFromSeed } from "../basisNoise";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp } from "../eval/math";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import type { BasisNoiseTables } from "../basisNoise";

export interface NauvisSharedParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
}

export interface NauvisShared {
  /** `1.5 * segmentationMultiplier` - the scale every nauvis noise sub-node uses. */
  readonly nauvisSeg: number;
  /** `nauvis_hills`: abs of a 4-octave multioctave noise (seed1 900). */
  readonly hills: (x: number, y: number) => number;
  /** `nauvis_hills_cliff_level`: a basis-noise term clamped to [0.15, 1.15]. */
  readonly cliffLevel: (x: number, y: number) => number;
  /** `nauvis_plateaus`: `0.5 + clamp((hills - cliffLevel) * 10, -0.5, 0.5)`. */
  readonly plateaus: (x: number, y: number) => number;
  /** `nauvis_bridge_billows`: abs of a 4-octave multioctave noise (seed1 700). */
  readonly bridgeBillows: (x: number, y: number) => number;
  /** New: abs of a 4-octave multioctave noise (seed1 1800), no offset_x. */
  readonly forestPathBillows: (x: number, y: number) => number;
}

/**
 * Shared Nauvis noise internals (`nauvis_hills`, `nauvis_hills_cliff_level`,
 * `nauvis_plateaus`, `nauvis_bridge_billows`, plus the new `forest_path_billows`),
 * extracted from `makeElevationNauvis` so `elevation_nauvis` and the Nauvis climate
 * expressions (`moisture_nauvis`, `aux_nauvis`) can reuse the same closures instead
 * of re-deriving them. See noise-programs.lua and the M2 climate/terrain design spec.
 *
 * None of these builders take or apply `offset_x` - `elevation_nauvis`'s
 * `offsetX = 10000/nauvisSeg` is specific to its `detail`/`persistance` terms and
 * must not be routed in here.
 */
export function makeNauvisShared(params: NauvisSharedParams): NauvisShared {
  const seed0 = params.seed0;
  const seg = params.segmentationMultiplier ?? 1;
  const nauvisSeg = 1.5 * seg;

  const hillsNoise = makeMultioctaveNoise({
    seed0,
    seed1: 900,
    octaves: 4,
    persistence: 0.5,
    inputScale: nauvisSeg / 90,
    outputScale: 1,
  });
  const cliffLevelTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, 99584);
  const bridgeBillowsNoise = makeMultioctaveNoise({
    seed0,
    seed1: 700,
    octaves: 4,
    persistence: 0.5,
    inputScale: nauvisSeg / 150,
    outputScale: 1,
  });
  const forestPathBillowsNoise = makeMultioctaveNoise({
    seed0,
    seed1: 1800,
    octaves: 4,
    persistence: 0.5,
    inputScale: nauvisSeg / 100,
    outputScale: 1,
  });

  const hills = (x: number, y: number): number => Math.abs(hillsNoise(x, y));

  const cliffLevel = (x: number, y: number): number =>
    clamp(
      0.65 +
        basisNoiseExpr(
          x,
          y,
          { seed0, seed1: 99584, inputScale: nauvisSeg / 500, outputScale: 0.6 },
          cliffLevelTables,
        ),
      0.15,
      1.15,
    );

  const plateaus = (x: number, y: number): number =>
    0.5 + clamp((hills(x, y) - cliffLevel(x, y)) * 10, -0.5, 0.5);

  const bridgeBillows = (x: number, y: number): number => Math.abs(bridgeBillowsNoise(x, y));

  const forestPathBillows = (x: number, y: number): number =>
    Math.abs(forestPathBillowsNoise(x, y));

  return { nauvisSeg, hills, cliffLevel, plateaus, bridgeBillows, forestPathBillows };
}

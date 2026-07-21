import { basisNoise, basisNoiseTablesFromSeed } from "../basisNoise";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp } from "../eval/math";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import type { BasisNoiseTables } from "../basisNoise";

/**
 * `basis_noise` `seed1` for `nauvis_hills_offset_raw_x` - the game passes the
 * STRING `'nauvis_offset_x'`, which Factorio hashes into the numeric seed1 with
 * standard CRC32 (identical to `src/codec/crc32.ts`). Resolved once and hardcoded
 * (spike-confirmed against the oracle, ~1e-7):
 * `crc32(utf8("nauvis_offset_x")) = 593691028` (0x2360A1D4). See docs/noise/cliffs-NOTES.md.
 */
export const NAUVIS_OFFSET_X_SEED1 = 593691028;
/**
 * `basis_noise` `seed1` for `nauvis_hills_offset_raw_y` - the string
 * `'nauvis_offset_y'` hashed with CRC32:
 * `crc32(utf8("nauvis_offset_y")) = 1415852290` (0x5460AAC2).
 */
export const NAUVIS_OFFSET_Y_SEED1 = 1415852290;

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
  /**
   * `nauvis_hills_offset`: the `hills` seed1=900 multioctave field re-evaluated at
   * a domain-warped coordinate `(x + 12*nx, y + 12*ny)`, then abs. `nx`/`ny` come
   * from two `basis_noise` warp fields (seed1 = crc32("nauvis_offset_x"/"_y")).
   */
  readonly hillsOffset: (x: number, y: number) => number;
  /**
   * `nauvis_cliff_ringbreak`: `abs(hills(x,y) - hillsOffset(x,y))` - the
   * `base_cliffiness` input. Low along a band perpendicular to the offset
   * direction, which breaks small ring features.
   */
  readonly cliffRingbreak: (x: number, y: number) => number;
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

  // The two `basis_noise` warp fields (`nauvis_hills_offset_raw_x/raw_y`), used to
  // domain-warp the seed1=900 hills field into `nauvis_hills_offset`. input_scale
  // = nauvisSeg / 500; string seed1s resolve to the crc32 constants above.
  const offsetXTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, NAUVIS_OFFSET_X_SEED1);
  const offsetYTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, NAUVIS_OFFSET_Y_SEED1);
  const offsetInputScale = nauvisSeg / 500;

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

  // `normalize(primary, secondary, bias=0.001)` from noise-programs.lua:
  // primary / sqrt(bias + primary^2 + secondary^2).
  const normalize = (a: number, b: number): number => a / Math.sqrt(0.001 + a * a + b * b);

  const hillsOffset = (x: number, y: number): number => {
    const rawX = basisNoise(x * offsetInputScale, y * offsetInputScale, offsetXTables);
    const rawY = basisNoise(x * offsetInputScale, y * offsetInputScale, offsetYTables);
    const nx = normalize(rawX, rawY);
    const ny = normalize(rawY, rawX);
    // Re-evaluate the seed1=900 octave field (same params as `hills`) at the WARPED
    // coordinate - NOT the abs-wrapped `hills(x,y)`, which is memoized at (x,y).
    return Math.abs(hillsNoise(x + 12 * nx, y + 12 * ny));
  };

  const cliffRingbreak = (x: number, y: number): number =>
    Math.abs(hills(x, y) - hillsOffset(x, y));

  return {
    nauvisSeg,
    hills,
    cliffLevel,
    plateaus,
    bridgeBillows,
    forestPathBillows,
    hillsOffset,
    cliffRingbreak,
  };
}

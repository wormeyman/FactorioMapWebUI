import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "../basisNoise";

export interface BasisExprParams {
  /** Map seed (basis seed word). */
  readonly seed0: number;
  /** Per-call seed selector (e.g. 123 for finish_elevation's basis term). */
  readonly seed1: number;
  /** Noise units per world tile. */
  readonly inputScale: number;
  /** Overall output multiplier. */
  readonly outputScale: number;
  /** World-space x translation applied before input_scale. Default 0. */
  readonly offsetX?: number;
}

/**
 * `basis_noise{input_scale, output_scale, offset_x}` in expression form. The raw
 * {@link basisNoise} takes noise-space coords and has no output scale, so this
 * adapter maps world `(x, y)` through `((x + offset_x) * input_scale, y *
 * input_scale)` and multiplies by `output_scale` - exactly the game's DSL. Pass
 * prebuilt `tables` to skip the per-seed derivation when sweeping a grid.
 */
export function basisNoiseExpr(
  x: number,
  y: number,
  params: BasisExprParams,
  tables: BasisNoiseTables = basisNoiseTablesFromSeed(params.seed0, params.seed1),
): number {
  const offsetX = params.offsetX ?? 0;
  return (
    params.outputScale *
    basisNoise((x + offsetX) * params.inputScale, y * params.inputScale, tables)
  );
}

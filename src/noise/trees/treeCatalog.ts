/**
 * The 15 Nauvis tree species autoplace probability expressions, as data.
 *
 * Every species in base/prototypes/entity/trees.lua @ 2.1.11 shares exactly one
 * expression shape, so a species is fully described by a parameter row:
 *
 *   min(cap,
 *       trees_forest_path_cutout_faded,
 *       min(0, asymmetric_ramps{input=temperature, ...tempRamp},
 *              asymmetric_ramps{input=moisture, ...moistRamp})
 *       + min(0, distance/20 - 3)
 *       - sizeOffset + 0.2 * control:trees:size
 *       + tree_small_noise * 0.1
 *       + multioctave_noise{persistence 0.65, octaves 3, seed1 = <seed1Name>,
 *                           input_scale = (1/inputScaleDiv) * control:trees:frequency,
 *                           output_scale = outputScale})
 *
 * `sizeOffset` is 0.5 for 13 of the 15 species and 0.45 for `tree_05`/`tree_07`
 * (see the field doc below) - the one genuinely per-species term.
 *
 * That shape claim is checked by `treeCatalogExpressions.spec.ts`, which rebuilds
 * each row's Lua string and diffs it against the checked-in game data character
 * for character. Do NOT re-verify this by filtering common terms out of the Lua
 * and eyeballing the remainder: that is what was done originally, the filter
 * dropped every line containing `control:trees:size`, and `sizeOffset` - the one
 * term that varies - was the one term excluded from the check.
 *
 * `seed1` is a STRING in the Lua; Factorio hashes it with crc32 (see
 * nauvisShared.ts:9). The numbers here are those hashes, precomputed so this
 * module has no runtime dependency on the codec. treeCatalog.spec.ts asserts each
 * one against `crc32`, and the oracle fixtures prove the whole assumption.
 *
 * Rows are ordered by descending `cap`; treeField's early-out converges faster
 * that way. Order does not affect the result (the composition is a max).
 */
export interface TreeSpecies {
  /** The game's noise-expression name, e.g. "tree_01" (used for oracle sampling). */
  readonly name: string;
  /** The string passed as `seed1` in the Lua, e.g. "tree-01". */
  readonly seed1Name: string;
  /** `crc32(utf8(seed1Name))` - the numeric seed1 the game actually uses. */
  readonly seed1: number;
  /** The species' upper bound (the leading `min(cap, ...)`). */
  readonly cap: number;
  /** `asymmetric_ramps{input=temperature}` args: from_bottom, from_top, to_top, to_bottom. */
  readonly tempRamp: readonly [number, number, number, number];
  /** `asymmetric_ramps{input=moisture}` args: from_bottom, from_top, to_top, to_bottom. */
  readonly moistRamp: readonly [number, number, number, number];
  /** `input_scale = (1 / inputScaleDiv) * control:trees:frequency`. */
  readonly inputScaleDiv: number;
  /** The species noise term's `output_scale`. */
  readonly outputScale: number;
  /**
   * The constant additive term in `- sizeOffset + 0.2 * control:trees:size`.
   *
   * Verified against `~/GitHub/factorio-data` @ tag 2.1.11,
   * `base/prototypes/entity/trees.lua`: `tree_05` and `tree_07` use `0.45`; the
   * other 13 species use `0.5`. This was the one genuinely per-species term
   * hiding in an otherwise-uniform expression shape - every other term (the
   * distance term, `tree_small_noise * 0.1`, persistence 0.65, octaves 3, and
   * the `trees_forest_path_cutout_faded` bound) is uniform across all 15
   * species. Caught by the oracle: modeling this as a shared constant made
   * tree_05 and tree_07 disagree with the real game by a near-constant 5.01e-2
   * everywhere (see test/treeOracle.spec.ts).
   */
  readonly sizeOffset: number;
}

/** `tree_small_noise`'s seed1: `crc32(utf8("tree-small"))`. */
export const TREE_SMALL_NOISE_SEED1 = 2343395516;

export const TREE_SPECIES: readonly TreeSpecies[] = [
  {
    name: "tree_01",
    seed1Name: "tree-01",
    seed1: 545692666,
    cap: 0.45,
    tempRamp: [0, 10, 14, 15],
    moistRamp: [0.6, 0.7, 1, 2],
    inputScaleDiv: 25,
    outputScale: 0.8,
    sizeOffset: 0.5,
  },
  {
    name: "tree_04",
    seed1Name: "tree-04",
    seed1: 1357672309,
    cap: 0.45,
    tempRamp: [13, 14, 16, 17],
    moistRamp: [0.7, 0.9, 1, 2],
    inputScaleDiv: 30,
    outputScale: 0.8,
    sizeOffset: 0.5,
  },
  {
    name: "tree_05",
    seed1Name: "tree-05",
    seed1: 669736931,
    cap: 0.45,
    tempRamp: [15, 16, 35, 45],
    moistRamp: [0.6, 0.7, 1, 2],
    inputScaleDiv: 40,
    outputScale: 0.8,
    sizeOffset: 0.45,
  },
  {
    name: "tree_02",
    seed1Name: "tree-02",
    seed1: 3113208384,
    cap: 0.4,
    tempRamp: [0, 10, 14, 15],
    moistRamp: [0.4, 0.5, 0.7, 0.8],
    inputScaleDiv: 25,
    outputScale: 0.75,
    sizeOffset: 0.5,
  },
  {
    name: "tree_03",
    seed1Name: "tree-03",
    seed1: 3465083606,
    cap: 0.4,
    tempRamp: [15, 16, 35, 45],
    moistRamp: [0.4, 0.5, 0.7, 0.8],
    inputScaleDiv: 35,
    outputScale: 0.75,
    sizeOffset: 0.5,
  },
  {
    name: "tree_07",
    seed1Name: "tree-07",
    seed1: 3387244239,
    cap: 0.4,
    tempRamp: [13, 14, 16, 17],
    moistRamp: [0.5, 0.6, 0.9, 1],
    inputScaleDiv: 40,
    outputScale: 0.75,
    sizeOffset: 0.45,
  },
  {
    name: "tree_02_red",
    seed1Name: "tree-02-red",
    seed1: 2142693989,
    cap: 0.3,
    tempRamp: [0, 10, 14, 15],
    moistRamp: [0.2, 0.3, 0.5, 0.6],
    inputScaleDiv: 25,
    outputScale: 0.7,
    sizeOffset: 0.5,
  },
  {
    name: "tree_08",
    seed1Name: "tree-08",
    seed1: 1499079518,
    cap: 0.3,
    tempRamp: [13, 14, 16, 17],
    moistRamp: [0.3, 0.4, 0.6, 0.7],
    inputScaleDiv: 30,
    outputScale: 0.7,
    sizeOffset: 0.5,
  },
  {
    name: "tree_09",
    seed1Name: "tree-09",
    seed1: 777851848,
    cap: 0.3,
    tempRamp: [15, 16, 35, 45],
    moistRamp: [0.2, 0.3, 0.5, 0.6],
    inputScaleDiv: 25,
    outputScale: 0.7,
    sizeOffset: 0.5,
  },
  {
    name: "tree_06",
    seed1Name: "tree-06",
    seed1: 3202485849,
    cap: 0.2,
    tempRamp: [0, 10, 14, 15],
    moistRamp: [0.1, 0.2, 0.3, 0.4],
    inputScaleDiv: 22,
    outputScale: 0.6,
    sizeOffset: 0.5,
  },
  {
    name: "tree_08_brown",
    seed1Name: "tree-08-brown",
    seed1: 3606254248,
    cap: 0.2,
    tempRamp: [13, 14, 16, 17],
    moistRamp: [0.2, 0.3, 0.4, 0.5],
    inputScaleDiv: 30,
    outputScale: 0.6,
    sizeOffset: 0.5,
  },
  {
    name: "tree_09_brown",
    seed1Name: "tree-09-brown",
    seed1: 1887705372,
    cap: 0.2,
    tempRamp: [15, 16, 35, 45],
    moistRamp: [0.1, 0.2, 0.3, 0.4],
    inputScaleDiv: 25,
    outputScale: 0.6,
    sizeOffset: 0.5,
  },
  {
    name: "tree_06_brown",
    seed1Name: "tree-06-brown",
    seed1: 2261543413,
    cap: 0.1,
    tempRamp: [0, 10, 14, 15],
    moistRamp: [0, 0.1, 0.2, 0.3],
    inputScaleDiv: 22,
    outputScale: 0.5,
    sizeOffset: 0.5,
  },
  {
    name: "tree_08_red",
    seed1Name: "tree-08-red",
    seed1: 889647812,
    cap: 0.1,
    tempRamp: [13, 14, 16, 17],
    moistRamp: [0.1, 0.2, 0.3, 0.4],
    inputScaleDiv: 30,
    outputScale: 0.5,
    sizeOffset: 0.5,
  },
  {
    name: "tree_09_red",
    seed1Name: "tree-09-red",
    seed1: 140958580,
    cap: 0.1,
    tempRamp: [15, 16, 35, 45],
    moistRamp: [0, 0.1, 0.2, 0.3],
    inputScaleDiv: 25,
    outputScale: 0.5,
    sizeOffset: 0.5,
  },
];

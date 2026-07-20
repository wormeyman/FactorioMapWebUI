/**
 * The six Nauvis resources and their `resource_autoplace_settings` params, copied
 * from base/prototypes/entity/resources.lua plus the defaults in
 * core/lualib/resource-autoplace.lua. One entry per resource, in the order they are
 * registered by `initialize_patch_set` (iron, copper, coal, stone, crude-oil,
 * uranium) - which is also their `regular_patch_set_index`.
 *
 * Lua math folded into the stored values:
 * - `regularRqFactor = regular_rq_factor_multiplier / 10`
 * - `mapColor` = the prototype's `map_color` (0..1 floats) scaled to 0..255, rounded.
 * Defaults applied here: base_spots_per_km2 2.5, candidate_spot_count 21, seed1 100,
 * random_probability 1, random_spot_size 0.25..2, additional/minimum richness 0,
 * richness_post_multiplier 1.
 */
export interface ResourceParams {
  /** Entity/prototype name, e.g. "iron-ore". */
  readonly name: string;
  /** Autoplace control name (= name for base resources); the control:<x>:* levers. */
  readonly controlName: string;
  /** Autoplace order: "b" resources beat "c" (oil/uranium yield) in the overlay. */
  readonly order: "b" | "c";
  /** regular_patch_set_index (init order 0..5); also the skip_offset in the regular set. */
  readonly patchSetIndex: number;
  readonly baseDensity: number;
  readonly baseSpotsPerKm2: number;
  readonly candidateSpotCount: number;
  /** regular_rq_factor = regular_rq_factor_multiplier / 10. */
  readonly regularRqFactor: number;
  readonly seed1: number;
  readonly randomProbability: number;
  readonly randomSpotSizeMin: number;
  readonly randomSpotSizeMax: number;
  readonly additionalRichness: number;
  readonly minimumRichness: number;
  readonly richnessPostMultiplier: number;
  readonly hasStartingAreaPlacement: boolean;
  /** map_color, scaled to 0..255 (rounded). */
  readonly mapColor: readonly [number, number, number];
}

/** map_color (0..1) -> 0..255, rounded, matching the game's preview tint. */
function color255(r: number, g: number, b: number): readonly [number, number, number] {
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Defaults for a base solid ore (order "b", starting placement, no specials). */
function solidOre(
  name: string,
  patchSetIndex: number,
  baseDensity: number,
  regularRqFactorMultiplier: number,
  candidateSpotCount: number,
  mapColor: readonly [number, number, number],
): ResourceParams {
  return {
    name,
    controlName: name,
    order: "b",
    patchSetIndex,
    baseDensity,
    baseSpotsPerKm2: 2.5,
    candidateSpotCount,
    regularRqFactor: regularRqFactorMultiplier / 10,
    seed1: 100,
    randomProbability: 1,
    randomSpotSizeMin: 0.25,
    randomSpotSizeMax: 2,
    additionalRichness: 0,
    minimumRichness: 0,
    richnessPostMultiplier: 1,
    hasStartingAreaPlacement: true,
    mapColor,
  };
}

export const RESOURCE_CATALOG: readonly ResourceParams[] = [
  solidOre("iron-ore", 0, 10, 1.1, 22, color255(0.415, 0.525, 0.58)),
  solidOre("copper-ore", 1, 8, 1.1, 22, color255(0.803, 0.388, 0.215)),
  solidOre("coal", 2, 8, 1.0, 21, color255(0, 0, 0)),
  solidOre("stone", 3, 4, 1.0, 21, color255(0.69, 0.611, 0.427)),
  {
    name: "crude-oil",
    controlName: "crude-oil",
    order: "c",
    patchSetIndex: 4,
    baseDensity: 8.2,
    baseSpotsPerKm2: 1.8,
    candidateSpotCount: 21,
    regularRqFactor: 1 / 10,
    seed1: 100,
    randomProbability: 1 / 48,
    randomSpotSizeMin: 1,
    randomSpotSizeMax: 1,
    additionalRichness: 220000,
    minimumRichness: 0,
    richnessPostMultiplier: 1,
    hasStartingAreaPlacement: false,
    mapColor: color255(0.78, 0.2, 0.77),
  },
  {
    name: "uranium-ore",
    controlName: "uranium-ore",
    order: "c",
    patchSetIndex: 5,
    baseDensity: 0.9,
    baseSpotsPerKm2: 1.25,
    candidateSpotCount: 21,
    regularRqFactor: 1 / 10,
    seed1: 100,
    randomProbability: 1,
    randomSpotSizeMin: 2,
    randomSpotSizeMax: 4,
    additionalRichness: 0,
    minimumRichness: 0,
    richnessPostMultiplier: 1,
    hasStartingAreaPlacement: false,
    mapColor: color255(0, 0.7, 0),
  },
];

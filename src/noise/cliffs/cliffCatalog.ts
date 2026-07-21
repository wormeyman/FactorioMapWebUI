/**
 * Cliff catalog: wire/gameplay constants and the pure slider/lever math the
 * game's map-gen GUI uses for the Cliffs autoplace control (frequency ->
 * elevation interval, continuity/richness -> cliff richness).
 *
 * See docs/superpowers/sdd/ for the cliffs design spec and RE notes. Cliff
 * placement itself (`isCliffPlaced`) is a later task - this module is just
 * constants + the three one-line math functions.
 */

/** Wire name of the Nauvis cliff autoplace control. */
export const CLIFF_CONTROL_NAME = "nauvis_cliff";

/** In-game map_color for cliff tiles. */
export const CLIFF_MAP_COLOR: readonly [number, number, number] = [144, 119, 87];

/** Cliff placement grid cell size, in tiles. */
export const CLIFF_GRID_SIZE = 4;

/** Y offset of the cliff placement grid, in tiles. */
export const CLIFF_GRID_OFFSET_Y = 0.5;

/** X coordinate of a cliff cell's center, in cell-local tiles. */
export const CLIFF_CELL_CENTER_X = 2;

/** Y coordinate of a cliff cell's center, in cell-local tiles. */
export const CLIFF_CELL_CENTER_Y = 2.5;

/** Default `cliff_elevation_0` map-gen setting (elevation of the first cliff band). */
export const CLIFF_ELEVATION_0_DEFAULT = 10;

/** Default `cliff_elevation_interval` map-gen setting, before the frequency lever. */
export const CLIFF_ELEVATION_INTERVAL_DEFAULT = 40;

/** seed1 for the low-frequency cliffiness basis noise. */
export const LOW_FREQ_CLIFFINESS_SEED1 = 86883;

/** Y offset applied to a cliff cell corner. */
export const CLIFF_CORNER_OFFSET_Y = 0.5;

/** The `nauvis_cliff` autoplace control's frequency/size sliders (size doubles as continuity). */
export interface CliffControls {
  frequency: number;
  continuity: number;
}

/** The cliff-related MapGenSettings fields that feed the lever math. */
export interface CliffSettingsInput {
  cliffElevation0: number;
  cliffElevationInterval: number;
  richness: number;
}

/**
 * Maps a geometric slider value (1/6..6, with 1 = 100%/midpoint) to a linear
 * value in `[lo, hi]`. Mirrors the game's `slider_to_linear` GUI helper.
 */
export function sliderToLinear(v: number, lo: number, hi: number): number {
  return lo + 0.5 * (hi - lo) * (1 + Math.log2(v) / Math.log2(6));
}

/** Higher frequency -> tighter (smaller) elevation bands between cliff lines. */
export function getModifiedElevationInterval(baseInterval: number, frequency: number): number {
  return baseInterval / frequency;
}

/** Continuity scales cliff richness directly; 0 disables cliffs entirely. */
export function getModifiedRichness(baseRichness: number, continuity: number): number {
  return baseRichness * continuity;
}

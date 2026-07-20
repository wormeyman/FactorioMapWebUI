// Enemy base catalog: constants and math functions from Factorio's enemy_base_probability expression

export const ENEMY_CONTROL_NAME = "enemy-base";
export const ENEMY_SEED1 = 123;
export const ENEMY_REGION_SIZE = 512;
export const ENEMY_CANDIDATE_SPOT_COUNT = 100;
export const ENEMY_SPACING = 45.254833995939045;
export const ENEMY_BASEMENT = -1000;
export const ENEMY_MAX_SPOT_BASEMENT_RADIUS = 128;
export const ENEMY_PLACEMENT_CAP = 0.25;
export const STARTING_AREA_RADIUS = 150;
export const ENEMY_MAP_COLOR = [255, 26, 26] as const;
export const ENEMY_FOOTPRINT_THRESHOLD = 0.05;

export type EnemyControls = {
  frequency: number;
  size: number;
};

// Utility: clamp a value to [lo, hi]
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Enemy intensity as a function of distance from spawn.
 * intensity = clamp(distance, 0, 2400) / 325
 */
export function enemyIntensity(distance: number): number {
  return clamp(distance, 0, 2400) / 325;
}

/**
 * Enemy spot radius as a function of distance and size control.
 * radius = max(0, sqrt(size) * (15 + 4*intensity))
 */
export function enemySpotRadius(distance: number, controls: EnemyControls): number {
  const intensity = enemyIntensity(distance);
  return Math.max(0, Math.sqrt(controls.size) * (15 + 4 * intensity));
}

/**
 * Enemy spot quantity (number of enemies per spot).
 * quantity = (PI/90) * radius^3
 */
export function enemySpotQuantity(distance: number, controls: EnemyControls): number {
  const radius = enemySpotRadius(distance, controls);
  return (Math.PI / 90) * radius ** 3;
}

/**
 * Enemy frequency (spawn probability per tile).
 * frequency = (1e-5 + 3e-6*intensity) * controls.frequency
 */
export function enemyFrequency(distance: number, controls: EnemyControls): number {
  const intensity = enemyIntensity(distance);
  return (1e-5 + 3e-6 * intensity) * controls.frequency;
}

/**
 * Enemy density (enemies per tile).
 * density = enemySpotQuantity * max(0, enemyFrequency)
 */
export function enemyDensity(distance: number, controls: EnemyControls): number {
  const quantity = enemySpotQuantity(distance, controls);
  const frequency = enemyFrequency(distance, controls);
  return quantity * Math.max(0, frequency);
}

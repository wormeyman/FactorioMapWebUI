/**
 * Factorio's discrete frequency / size / richness (and starting-area) scale.
 * Stored as float32 in the map-exchange string, so each step is Math.fround of
 * an exact fraction; storing these keeps re-emitted strings byte-identical.
 */
const FRACTIONS = [1 / 6, 1 / 4, 1 / 3, 1 / 2, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4, 6];

export interface PercentStep {
  /** The float32 multiplier stored in the exchange string. */
  value: number;
  /** The display percentage, e.g. 17, 100, 600. */
  percent: number;
}

export const PERCENT_STEPS: readonly PercentStep[] = FRACTIONS.map((f) => {
  const value = Math.fround(f);
  return { value, percent: Math.round(value * 100) };
});

export function stepValue(index: number): number {
  const i = Math.min(PERCENT_STEPS.length - 1, Math.max(0, Math.round(index)));
  return PERCENT_STEPS[i].value;
}

/**
 * Index of the closest step to `value`, measured by log-ratio distance (the
 * scale is geometric). Ties resolve to the higher step (via `<=`); a
 * non-positive value clamps to index 0.
 */
export function nearestStepIndex(value: number): number {
  if (!(value > 0)) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PERCENT_STEPS.length; i++) {
    const dist = Math.abs(Math.log(value / PERCENT_STEPS[i].value));
    if (dist <= bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

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

/**
 * A discrete slider scale: a fixed set of notches with a nearest-notch snap,
 * a display formatter, and an aria-label. Lets one slider widget serve both
 * the geometric percentage steps and the uniform bias steps.
 */
export interface StepScale {
  /** Number of notches (input range is 0..count-1). */
  readonly count: number;
  /** Index of the notch nearest to a raw value. */
  nearestIndex(value: number): number;
  /** Raw value at a notch index (clamped to range). */
  valueAt(index: number): number;
  /** Human label for a value, e.g. "150%" or "+0.05". */
  format(value: number): string;
  /** aria-label for the range input. */
  readonly ariaLabel: string;
}

/** The 12 geometric percentage notches; the widget's default scale. */
export const PERCENT_SCALE: StepScale = {
  count: PERCENT_STEPS.length,
  nearestIndex: nearestStepIndex,
  valueAt: stepValue,
  format: formatPercent,
  ariaLabel: "Percentage",
};

const BIAS_COUNT = 21;
const BIAS_STEP = 0.05;

/** The 21 uniform bias notches: -0.50, -0.45, ..., 0, ..., +0.45, +0.50. */
export const BIAS_SCALE: StepScale = {
  count: BIAS_COUNT,
  nearestIndex(value: number): number {
    const i = Math.round(value / BIAS_STEP) + 10;
    return Math.min(BIAS_COUNT - 1, Math.max(0, i));
  },
  valueAt(index: number): number {
    const i = Math.min(BIAS_COUNT - 1, Math.max(0, Math.round(index)));
    return (i - 10) / 20;
  },
  format(value: number): string {
    const fixed = value.toFixed(2);
    return value > 0 ? `+${fixed}` : fixed;
  },
  ariaLabel: "Bias",
};

/** The single wire formatter for all climate values: fixed 6 decimals. */
export function formatWire6(n: number): string {
  return n.toFixed(6);
}

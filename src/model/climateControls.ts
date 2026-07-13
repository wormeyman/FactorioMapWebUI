import { BIAS_SCALE, PERCENT_SCALE, formatWire6 } from "./controlScale";

/**
 * A Factorio "climate control." Unlike autoplace controls, these have no
 * dedicated MapGenSettings floats; their Scale and Bias live purely as
 * `property_expression_names` overrides. `aux` (terrain type) encodes
 * identically to `moisture` (confirmed against in-game captures).
 */
export interface ClimateControl {
  readonly freqKey: string;
  readonly biasKey: string;
}

export const MOISTURE: ClimateControl = {
  freqKey: "control:moisture:frequency",
  biasKey: "control:moisture:bias",
};

export const TERRAIN_TYPE: ClimateControl = {
  freqKey: "control:aux:frequency",
  biasKey: "control:aux:bias",
};

type Pen = Record<string, string>;

/**
 * Scale multiplier shown by the GUI. The wire stores frequency (the inverse),
 * so scale = 1 / frequency. Absent key => default multiplier 1 (100%).
 * Non-mutating: an off-notch stored string is read but never rewritten.
 */
export function readScale(pen: Pen, c: ClimateControl): number {
  return 1 / Number(pen[c.freqKey] ?? "1");
}

/**
 * Snap to the nearest percent notch and store its inverse frequency. Landing
 * on the default 100% notch deletes the key (matching the game's empty dict).
 */
export function writeScale(pen: Pen, c: ClimateControl, scaleMultiplier: number): void {
  const snapped = PERCENT_SCALE.valueAt(PERCENT_SCALE.nearestIndex(scaleMultiplier));
  if (snapped === 1) {
    delete pen[c.freqKey];
  } else {
    pen[c.freqKey] = formatWire6(1 / snapped);
  }
}

/** Stored bias, read directly. Absent key => default 0. Non-mutating. */
export function readBias(pen: Pen, c: ClimateControl): number {
  return Number(pen[c.biasKey] ?? "0");
}

/**
 * Snap to the nearest bias notch and store it. Landing on the default 0 notch
 * deletes the key.
 */
export function writeBias(pen: Pen, c: ClimateControl, bias: number): void {
  const snapped = BIAS_SCALE.valueAt(BIAS_SCALE.nearestIndex(bias));
  if (snapped === 0) {
    delete pen[c.biasKey];
  } else {
    pen[c.biasKey] = formatWire6(snapped);
  }
}

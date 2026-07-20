/**
 * The `distance`-dependent local functions and scalar local_expressions of
 * `resource_autoplace_all_patches` (core/prototypes/noise-functions.lua), ported
 * verbatim. Pure math, no RNG - the spot RNG lives in regularPatches.ts.
 *
 * `controls` are the frequency_multiplier / size_multiplier (= control:<x>:frequency
 * / control:<x>:size). `sign` mirrors the Lua `has_starting_area_placement` ternary
 * argument: -1 (no special starting area), 0 (false), 1 (true). None of the six base
 * resources pass nil, so `sign` is 1 (iron/copper/coal/stone) or 0 (oil/uranium) -
 * and the `sign === -1` branches never fire for them, but are kept for fidelity.
 */
import { fastCbrt } from "../fastApprox";
import type { ResourceParams } from "./resourceCatalog";

export const DOUBLE_DENSITY_DISTANCE = 1300;
export const REGULAR_PATCH_FADE_IN_DISTANCE = 300;
export const STARTING_RESOURCE_PLACEMENT_RADIUS = 120;
/** (params.regular_blob_amplitude_multiplier or 1) / 8 - constant for the 6 base resources. */
const REGULAR_BLOB_AMPLITUDE_MULTIPLIER = 1 / 8;
/** (params.starting_blob_amplitude_multiplier or 1) / 8. */
const STARTING_BLOB_AMPLITUDE_MULTIPLIER = 1 / 8;
const STARTING_PATCHES_SPLIT = 0.5;

/** control:<x>:frequency and control:<x>:size, as the noise-function multipliers. */
export interface ResourceControls {
  readonly frequency: number;
  readonly size: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** -1 (no starting area), 0 (false), 1 (true). Base resources are only 1 or 0. */
function startingSign(params: ResourceParams): -1 | 0 | 1 {
  return params.hasStartingAreaPlacement ? 1 : 0;
}

/** size_effective_distance_at(distance). */
export function sizeEffectiveDistanceAt(distance: number, params: ResourceParams): number {
  return startingSign(params) === -1 ? distance : distance - REGULAR_PATCH_FADE_IN_DISTANCE;
}

/** regular_density_at(distance): base density scaled by controls, spawn fade-in, and the double-density ramp. */
export function regularDensityAt(
  distance: number,
  params: ResourceParams,
  controls: ResourceControls,
): number {
  const fadeIn =
    startingSign(params) === -1
      ? 1
      : clamp(
          (distance - STARTING_RESOURCE_PLACEMENT_RADIUS) / REGULAR_PATCH_FADE_IN_DISTANCE,
          0,
          1,
        );
  const doubleUp =
    1 + clamp(sizeEffectiveDistanceAt(distance, params) / DOUBLE_DENSITY_DISTANCE, 0, 1);
  return params.baseDensity * controls.frequency * controls.size * fadeIn * doubleUp;
}

/** regular_spot_quantity_base_at(distance): stuff-per-spot before the random_penalty jitter. */
export function regularSpotQuantityBaseAt(
  distance: number,
  params: ResourceParams,
  controls: ResourceControls,
): number {
  return (
    (1000000 / params.baseSpotsPerKm2 / controls.frequency) *
    regularDensityAt(distance, params, controls)
  );
}

/** regular_spot_height_typical_at(distance): the typical cone peak at that distance. */
export function regularSpotHeightTypicalAt(
  distance: number,
  params: ResourceParams,
  controls: ResourceControls,
): number {
  const meanSize = (params.randomSpotSizeMin + params.randomSpotSizeMax) / 2;
  const q = meanSize * regularSpotQuantityBaseAt(distance, params, controls);
  // The game's noise machine evaluates this cube root through its fastapprox `pow`
  // (docs/noise/random-penalty-NOTES.md, the fastapprox-cbrt residual) - exact
  // Math.cbrt leaves a ~7e-5 relative error that dominates the blob term.
  return fastCbrt(q) / ((Math.PI / 3) * params.regularRqFactor * params.regularRqFactor);
}

/** regular_blob_amplitude_maximum_distance. */
export function regularBlobAmplitudeMaximumDistance(params: ResourceParams): number {
  return startingSign(params) === -1
    ? DOUBLE_DENSITY_DISTANCE
    : DOUBLE_DENSITY_DISTANCE + REGULAR_PATCH_FADE_IN_DISTANCE;
}

/** regular_blob_amplitude_at(distance). */
export function regularBlobAmplitudeAt(
  distance: number,
  params: ResourceParams,
  controls: ResourceControls,
): number {
  const atMax = regularSpotHeightTypicalAt(
    regularBlobAmplitudeMaximumDistance(params),
    params,
    controls,
  );
  const atD = regularSpotHeightTypicalAt(distance, params, controls);
  return REGULAR_BLOB_AMPLITUDE_MULTIPLIER * Math.min(atMax, atD);
}

/** starting_amount: total resource "stuff" allotted to the starting area, before the split. */
export function startingAmount(params: ResourceParams, controls: ResourceControls): number {
  return 20000 * params.baseDensity * (controls.frequency + 1) * controls.size;
}

/** starting_area_spot_quantity: starting_amount spread across the starting-area spots. */
export function startingAreaSpotQuantity(
  params: ResourceParams,
  controls: ResourceControls,
): number {
  return startingAmount(params, controls) / STARTING_PATCHES_SPLIT / controls.frequency;
}

/** starting_modulation(distance): 1 inside the starting-area placement radius, 0 outside (inclusive of the boundary). */
export function startingModulation(distance: number): number {
  return distance < STARTING_RESOURCE_PLACEMENT_RADIUS ? 1 : 0;
}

/** starting_density_at(distance): starting_amount spread over the starting-area disc, gated by starting_modulation. */
export function startingDensityAt(
  distance: number,
  params: ResourceParams,
  controls: ResourceControls,
): number {
  return (
    (startingAmount(params, controls) /
      (Math.PI * STARTING_RESOURCE_PLACEMENT_RADIUS * STARTING_RESOURCE_PLACEMENT_RADIUS)) *
    startingModulation(distance)
  );
}

/** starting_spot_radius: the typical starting-area spot radius (fastapprox cube root, matching regularSpotHeightTypicalAt). */
export function startingSpotRadius(params: ResourceParams, controls: ResourceControls): number {
  return params.startingRqFactor * fastCbrt(startingAreaSpotQuantity(params, controls));
}

/**
 * starting_favorability_base_at(distance, elevation_lakes): the non-random part of the
 * starting-area spot favorability. The `random_penalty_at(0.5, 1)` batch term (Task 3)
 * is added to this by the caller.
 */
// _params/_controls: unused today (this is purely the distance/elevation term), but kept
// in the signature for a stable (distance, elevationLakes, params, controls) shape across
// the starting-patch local functions - random_penalty_at (Task 3) will need them here too.
export function startingFavorabilityBaseAt(
  distance: number,
  elevationLakes: number,
  _params: ResourceParams,
  _controls: ResourceControls,
): number {
  return clamp((elevationLakes - 1) / 10, 0, 1) * startingModulation(distance) * 2 - distance / 120;
}

/** starting_blob_amplitude - a scalar; referenced by basement_value even for regular-only. */
export function startingBlobAmplitude(params: ResourceParams, controls: ResourceControls): number {
  return (
    (STARTING_BLOB_AMPLITUDE_MULTIPLIER /
      ((Math.PI / 3) * params.startingRqFactor * params.startingRqFactor)) *
    fastCbrt(startingAreaSpotQuantity(params, controls))
  );
}

/**
 * basement_value = -6 * max(regular_blob_amplitude_at(max_distance), starting_blob_amplitude).
 * The constant floor the spot field is initialized to and clamped at; both spot_noise
 * calls in the expression share it, so it references the starting term even here.
 */
export function basementValue(params: ResourceParams, controls: ResourceControls): number {
  const regular = regularBlobAmplitudeAt(
    regularBlobAmplitudeMaximumDistance(params),
    params,
    controls,
  );
  return -6 * Math.max(regular, startingBlobAmplitude(params, controls));
}

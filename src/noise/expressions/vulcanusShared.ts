/**
 * `starting_spot_at_angle` (core/prototypes/noise-functions.lua) - the radial-
 * placement backbone Vulcanus's biome/resource expressions build on: a soft
 * disc of radius `radius`, centered `distance` tiles from spawn at `angle`
 * degrees (measured clockwise from north, since `sin` drives x and `-cos`
 * drives y), optionally re-centered by `(x_distortion, y_distortion)`.
 * Verbatim:
 *
 *   angle_rad = angle / 180 * pi
 *   delta_x   = distance * sin(angle_rad) - x_from_start + x_distortion
 *   delta_y   = -distance * cos(angle_rad) - y_from_start + y_distortion
 *   result    = 1 - (delta_x*delta_x + delta_y*delta_y)^0.5 / radius
 *
 * `x_from_start`/`y_from_start` are the engine's own per-point free vars
 * (`distance_from_nearest_point_x/_y(x, y, starting_positions)` -
 * core/prototypes/noise-programs.lua). Task 2 found they equal the raw world
 * `(x, y)` at the default origin spawn on a freshly `create_surface()`'d
 * Vulcanus surface (no offset) - so callers here pass the current `(x, y)` as
 * `xFromStart`/`yFromStart` explicitly, keeping this function pure and correct
 * even if a non-origin spawn ever appears.
 */
import { cos, PI, sin } from "../eval/math";

export interface StartingSpotAtAngleParams {
  /** Angle in degrees, clockwise from north (sin drives x, -cos drives y). */
  readonly angle: number;
  /** Distance in tiles from spawn to the disc's center, before distortion. */
  readonly distance: number;
  /** Radius in tiles of the soft disc (1 at the center, 0 at the edge). */
  readonly radius: number;
  /** Added to the center's x position after the angle/distance projection. */
  readonly xDistortion: number;
  /** Added to the center's y position after the angle/distance projection. */
  readonly yDistortion: number;
  /** `x_from_start`: the world x at the default origin spawn (Task 2 finding). */
  readonly xFromStart: number;
  /** `y_from_start`: the world y at the default origin spawn (Task 2 finding). */
  readonly yFromStart: number;
}

/** `starting_spot_at_angle{angle, distance, radius, x_distortion, y_distortion}`. */
export function startingSpotAtAngle(params: StartingSpotAtAngleParams): number {
  const angleRad = (params.angle / 180) * PI;
  const deltaX = params.distance * sin(angleRad) - params.xFromStart + params.xDistortion;
  const deltaY = -params.distance * cos(angleRad) - params.yFromStart + params.yDistortion;
  return 1 - Math.sqrt(deltaX * deltaX + deltaY * deltaY) / params.radius;
}

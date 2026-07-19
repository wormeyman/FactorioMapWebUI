/**
 * Factorio's `starting_lake_positions`, reverse-engineered from
 * `MapGenSettings::getStartingLakePositions() const` (non-stripped 2.1.11 Mach-O,
 * arm64 0x10160a2fc). One lake per starting position, in order: a single taus88
 * draw picks an angle; the lake sits at a FIXED radius of 75 tiles around the
 * spawn. Verified exact against test/fixtures/oracle-elevation-lakes.seed123456
 * (lake (45,-59) reproduces all 9 near-spawn distances to 0). See
 * docs/superpowers/specs/2026-07-18-starting-lake-positions-design.md.
 *
 * NOT random beyond the angle: radius, phase-quantisation and the fast-sine poly
 * are all fixed. The intermediate f32 round-trip (Math.fround) and truncation
 * toward zero (Math.trunc) are load-bearing - do not "clean them up".
 */
import { seededState, taus88Next } from "./taus88";
import type { Point } from "./distanceFromNearestPoint";

const MIN_SEED_WORD = 0x155;
const TWO_POW_NEG32 = 2.3283064365386963e-10; // 0x3DF0000000000000
const TWO_PI = 6.283185307179586; // 0x401921FB54442D18
const INV_TWO_PI = 0.15915494309189535; // 0x3FC45F306DC9C883
const RADIUS = 75.0; // 0x4052C00000000000

// Minimax coefficients (0x4044ABBC02329376 .. 0x4043D4243780214B).
const C1 = 41.34167506665737;
const C2 = 6.283185269630412;
const C3 = 76.56887678023256;
const C4 = 81.60201529595571;
const C5 = 39.65735524898863;

/** Inlined fast approximation of cos(2*pi*t) for t in turns (matches the game). */
function sinlike(t: number): number {
  const r = Math.trunc(t + (t > 0 ? 0.5 : -0.5));
  const x = 0.25 - Math.abs(t - r);
  const x2 = x * x;
  const x4 = x2 * x2;
  const x8 = x4 * x4;
  let poly = C2 - x2 * C1 + x4 * (C4 - x2 * C3);
  poly = x8 * C5 + poly;
  return x * poly;
}

/**
 * The game's `starting_lake_positions`: one lake per starting position, computed
 * from `(seed0, startingPositions)` alone. Positions are world tiles.
 */
export function startingLakePositions(
  seed0: number,
  startingPositions: readonly Point[],
): Point[] {
  const word = Math.max(seed0 >>> 0, MIN_SEED_WORD);
  const st = seededState(word);
  const lakes: Point[] = [];
  for (const spawn of startingPositions) {
    const u = taus88Next(st) * TWO_POW_NEG32;
    const t = Math.fround(u * TWO_PI) * INV_TWO_PI;
    lakes.push({
      x: Math.trunc(spawn.x + RADIUS * sinlike(t)),
      y: Math.trunc(spawn.y + RADIUS * sinlike(t - 0.25)),
    });
  }
  return lakes;
}

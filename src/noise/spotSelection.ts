/**
 * Factorio's `spot_noise` spot-selection phase, reverse-engineered.
 *
 * Sits on top of the candidate RNG in spotCandidates.ts and turns the infinite
 * candidate stream of a region into the finite list of spots the game renders.
 * Verified against Factorio 2.1.11 across 55 probe configurations (see
 * docs/noise/spot-noise-NOTES.md, "Spot selection - SOLVED"):
 *
 * 1. Dart-throw. Walk candidates in generation order. A candidate is accepted
 *    if its squared distance to every previously accepted spot is >= a
 *    threshold that starts at spacing^2 and is multiplied by 15/16 on every
 *    rejection ("suggested minimum spacing ... to try to achieve"). The walk
 *    ends when candidate_spot_count * skip_span spots have been accepted.
 * 2. Skip. Accepted spot j (acceptance order) belongs to set j mod skip_span;
 *    the expression renders the set matching its skip_offset.
 * 3. Target. The regional quantity target is the mean of density_expression
 *    over the set's accepted spots, times the region area.
 * 4. Trim. Stable-sort the set by favorability (evaluated at the spot)
 *    descending, then keep spots while accumulated quantity < target. With
 *    hard_region_target_quantity the last kept spot's quantity is cut to hit
 *    the target exactly, and its cone shrinks self-similarly: radius and peak
 *    both scale by (q'/q)^(1/3).
 */
import { spotSeedWord, type SpotRegionKey } from "./spotCandidates";

/** Per-rejection decay of the SQUARED spacing threshold (measured exactly:
 * sqrt(15/16) on distances beat 61/63 and e^-1/31 on 12/12 discriminating
 * seeds - the game works in squared space and knocks 1/16 off per rejection). */
const SPACING_SQ_DECAY = 15 / 16;

/** Safety valve only - the game showed no cap through ~170 tried candidates,
 * but a degenerate config (huge spacing, tiny region) must not spin forever. */
const MAX_TRIED = 100_000;

export interface SpotExpressions {
  /** quantity per unit area, evaluated at accepted spot positions */
  density: (x: number, y: number) => number;
  quantity: (x: number, y: number) => number;
  favorability: (x: number, y: number) => number;
  /**
   * Optional batched spot quantity, evaluated over ALL skip-set accepted spots at
   * once (in acceptance order), before the sort/trim. Overrides `quantity` when
   * present. Needed for `spot_quantity_expression`s that contain a `random_penalty`
   * (a batch op whose per-spot value depends on the whole spot list + its order -
   * the game evaluates these expressions at the skip-set spots as one batch). The
   * returned array aligns with the input spots.
   */
  quantityBatch?: (spots: readonly { x: number; y: number }[]) => number[];
}

export interface SpotSelectParams extends SpotExpressions {
  regionSize: number;
  candidateSpotCount: number;
  /** suggested_minimum_candidate_point_spacing */
  spacing: number;
  skipSpan?: number;
  skipOffset?: number;
  hardRegionTargetQuantity?: boolean;
}

export interface SelectedSpot {
  x: number;
  y: number;
  quantity: number;
  /** 1 for full spots; (q'/q)^(1/3) for a hard-target-shrunk last spot -
   * multiply the spot's radius and peak by this when rendering the cone. */
  coneScale: number;
}

/** The spots of one region, in favorability order (the order the trim ran in). */
export function selectSpots(key: SpotRegionKey, p: SpotSelectParams): SelectedSpot[] {
  const span = p.skipSpan ?? 1;
  const offset = p.skipOffset ?? 0;
  const rs = p.regionSize;
  const half = Math.floor(rs / 2);
  const needed = p.candidateSpotCount * span;

  // taus88 stream, inlined so we can draw lazily
  const word = spotSeedWord(key);
  const st = { s1: word, s2: word, s3: word };
  const next = (): number => {
    st.s1 = ((((st.s1 & 0xfffffffe) << 12) >>> 0) ^ ((((st.s1 << 13) >>> 0) ^ st.s1) >>> 19)) >>> 0;
    st.s2 = ((((st.s2 & 0xfffffff8) << 4) >>> 0) ^ ((((st.s2 << 2) >>> 0) ^ st.s2) >>> 25)) >>> 0;
    st.s3 = ((((st.s3 & 0xfffffff0) << 17) >>> 0) ^ ((((st.s3 << 3) >>> 0) ^ st.s3) >>> 11)) >>> 0;
    return (st.s1 ^ st.s2 ^ st.s3) >>> 0;
  };

  // phase 1: dart-throw with decaying squared threshold
  const accepted: Array<{ x: number; y: number }> = [];
  let spacingSq = p.spacing * p.spacing;
  for (let tried = 0; accepted.length < needed && tried < MAX_TRIED; tried++) {
    const x = key.regionX * rs + (next() % rs) - half;
    const y = key.regionY * rs + (next() % rs) - half;
    let ok = true;
    for (const a of accepted) {
      const dx = x - a.x;
      const dy = y - a.y;
      if (dx * dx + dy * dy < spacingSq) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push({ x, y });
    else spacingSq *= SPACING_SQ_DECAY;
  }

  // phase 2: this expression's skip set
  const mine = accepted.filter((_, j) => j % span === offset);

  // phase 3: regional target from density at the set's spots
  const target =
    mine.length === 0
      ? 0
      : (mine.reduce((s, a) => s + p.density(a.x, a.y), 0) / mine.length) * rs * rs;

  // Spot quantities: batched over the whole skip set (in acceptance order) when a
  // quantityBatch is given (for random_penalty-bearing expressions), else per-spot.
  const qBatch = p.quantityBatch ? p.quantityBatch(mine) : null;

  // phase 4: stable sort by favorability desc, accumulate to target
  const ranked = mine
    .map((a, j) => ({ ...a, j, fav: p.favorability(a.x, a.y) }))
    .sort((a, b) => b.fav - a.fav || a.j - b.j);
  const out: SelectedSpot[] = [];
  let acc = 0;
  for (const s of ranked) {
    if (acc >= target) break;
    let q = qBatch ? qBatch[s.j] : p.quantity(s.x, s.y);
    // The game skips a spot with non-positive quantity (or radius, which for
    // radius = rq*cbrt(q) is equivalent): "not emitted, not counted toward the
    // target" (docs/noise/spot-noise-NOTES.md). Near spawn, regular resource
    // density fades to 0 so its spots get quantity 0 - if emitted they render as a
    // degenerate flat cone=0 disk across the whole cull radius. Skip before the
    // accumulation so a zero spot neither renders nor consumes the target budget.
    if (q <= 0) continue;
    let coneScale = 1;
    if (p.hardRegionTargetQuantity && acc + q > target) {
      const q2 = target - acc;
      coneScale = Math.cbrt(q2 / q);
      q = q2;
    }
    out.push({ x: s.x, y: s.y, quantity: q, coneScale });
    acc += q;
  }
  return out;
}

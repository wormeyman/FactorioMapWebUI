/**
 * Order-priority overlay resolver: at a world tile, which resource patch (if any)
 * is drawn. The game places resources in autoplace `order` sequence and a later
 * patch overwrites an earlier one where they overlap; the map preview mirrors that
 * by letting the FIRST resource in order-priority whose `probability >= 0.5` win
 * (M3a solid-footprint - the per-tile stipple roll is deferred to M3.5).
 *
 * Priority = autoplace `order` ("b" before "c"), then `patchSetIndex` (init order)
 * within an order. All six resources share one candidate stream partitioned by
 * `skip_span = 6` / `skip_offset = patchSetIndex` (regular set), so each resource's
 * field is built with those skip params (unlike the pure-regular oracle, which uses
 * span 1). See docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md T5.
 */
import type { Point } from "../distanceFromNearestPoint";
import { makeRegularPatches, type RegularPatches } from "./regularPatches";
import { RESOURCE_CATALOG, type ResourceParams } from "./resourceCatalog";

/** control:<res>:frequency|size|richness levers for one resource. */
export interface ResourceControlLevers {
  readonly frequency: number;
  readonly size: number;
  readonly richness: number;
}

export interface ResourceResolverCtx {
  readonly seed0: number;
  /** Per-resource control levers, keyed by `controlName`; missing => all-default. */
  readonly controls: Record<string, ResourceControlLevers>;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

const DEFAULT_LEVERS: ResourceControlLevers = { frequency: 1, size: 1, richness: 1 };

/** The regular set shares one candidate stream across all 6 resources. */
const REGULAR_SKIP_SPAN = 6;

const orderRank = (o: "b" | "c"): number => (o === "b" ? 0 : 1);

/**
 * The order-priority winner among the resources present (`probability >= 0.5`) at a
 * tile: "b" before "c", then lower `patchSetIndex`. Returns `null` if none present.
 * Pure - the field evaluation lives in {@link makeResourceResolver}.
 */
export function pickWinner(present: readonly ResourceParams[]): ResourceParams | null {
  let best: ResourceParams | null = null;
  for (const p of present) {
    if (
      best === null ||
      orderRank(p.order) < orderRank(best.order) ||
      (orderRank(p.order) === orderRank(best.order) && p.patchSetIndex < best.patchSetIndex)
    ) {
      best = p;
    }
  }
  return best;
}

/**
 * Build a resolver `(x, y) => ResourceParams | null` over all catalog resources whose
 * `size` control is > 0, returning the order-priority winner where `probability >= 0.5`.
 */
export function makeResourceResolver(
  ctx: ResourceResolverCtx,
): (x: number, y: number) => ResourceParams | null {
  const fields: { params: ResourceParams; patches: RegularPatches }[] = [];
  for (const params of RESOURCE_CATALOG) {
    const levers = ctx.controls[params.controlName] ?? DEFAULT_LEVERS;
    if (levers.size <= 0) continue; // a disabled resource never appears
    fields.push({
      params,
      patches: makeRegularPatches(params, {
        seed0: ctx.seed0,
        controls: levers,
        startingPositions: ctx.startingPositions,
        skipSpan: REGULAR_SKIP_SPAN,
        skipOffset: params.patchSetIndex,
      }),
    });
  }
  // Evaluate in priority order so the first present resource is the winner - no need
  // to build the full `present` list per tile.
  fields.sort(
    (a, b) =>
      orderRank(a.params.order) - orderRank(b.params.order) ||
      a.params.patchSetIndex - b.params.patchSetIndex,
  );

  return (x, y) => {
    for (const f of fields) {
      if (f.patches.probability(x, y) >= 0.5) return f.params;
    }
    return null;
  };
}

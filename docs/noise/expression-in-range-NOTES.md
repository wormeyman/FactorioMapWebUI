# `expression_in_range` - reverse-engineering notes

The native Factorio builtin
`expression_in_range(peak_multiplier, peak_maximum, expr_1..N, from_1..N, to_1..N)`
has no published formula. It was recovered from the headless oracle
(`test/oracle/capture.ts expression-in-range`, fixture
`test/fixtures/oracle-expression-in-range.seed123456.json`, seed 123456).

Arg order per the game docs (and confirmed by the probes): `peak_multiplier`,
`peak_maximum`, then ALL exprs, then ALL froms, then ALL tos. So the 2-D probe is
`expression_in_range(pm, pmax, expr1, expr2, from1, from2, to1, to2)`.

## Derived formula

```
m      = min over all dims i of min(value_i - from_i, to_i - value_i)
result = min(peak_maximum, peak_multiplier * m)
```

- Per dimension, `min(value - from, to - value)` is the signed distance to the
  nearer edge of `[from, to]`: positive inside the range, exactly 0 on an edge,
  negative outside.
- Combining dimensions with `min` makes the N-D box a hard AND: any single dim out
  of range pulls the whole result down (it becomes the binding term).
- `peak_multiplier` is the falloff slope (per unit of edge distance).
- The plateau is clamped from above at `peak_maximum`. There is NO lower clamp -
  outside the range the value falls linearly without bound (reaches
  `-peak_multiplier * distance`).
- `peak_maximum = Infinity` leaves the plateau uncapped, so in-range values exceed
  1 (this is what lets sand-1's coastal term win over land tiles that top out near
  1). The implementation must not clamp that case.

## Evidence

Three oracle sweeps (each probe routed onto `elevation`, sampled via
`calculate_tile_properties`):

### 1-D bounded, `(pm=20, pmax=1)`, `expr = x/1000`, range `[-0.5, 0.5]`

Sweep `x` from -1500 to 1500 (step 25). Observed:

- Inside `[-0.5, 0.5]`: value is exactly `1` (= `peak_maximum`; the raw peak
  `20 * min(...)` reaches 10 at center and is clamped to 1).
- On the edges (`expr = ±0.5`): value `0`.
- Just outside (`expr = -0.475`): `0.5` = `20 * min(0.025, 0.975)`. This fixes the
  slope at `peak_multiplier`.
- Far outside (`expr = -1.5`): `-20` = `20 * min(-1.0, 2.0)`. Confirms no lower
  clamp.

### 1-D unbounded, `(pm=5, pmax=inf)`, same range

Identical triangular shape but with NO upper clamp: peak reaches `2.5` at center
(`5 * 0.5`), confirming the `peak_maximum = inf` branch. The parity test asserts the
in-range max exceeds 1.

### 2-D combination, `(pm=20, pmax=1)`, both ranges `[-0.5, 0.5]`

Hold `expr1 = x/1000 = 0.2` (intermediate, in range) and sweep `expr2 = y/1000`
across and beyond its range; plus a diagonal `x=y` sweep. This distinguishes the
combination rule decisively. Against the held-`x` family, the three candidates
predict (before the `pmax` clamp):

| `ey`   | oracle | `min` | `product` | `sum` |
|--------|--------|-------|-----------|-------|
| -1.000 | -10.0  | -10.0 | -60.0     | -4.0  |
| -0.750 |  -5.0  |  -5.0 | -30.0     |  1.0  |
| -0.525 |  -0.5  |  -0.5 |  -3.0     |  1.0  |

`min` matches exactly; `product` and `sum` diverge by wide margins. The N-D rule is
`min` across dimensions.

## Residuals

Worst absolute residual of the derived formula vs. the oracle, over ALL points of
all three sweeps: **9.5e-7** (at `x = -1300` in the bounded 1-D sweep). This is pure
f32 noise from the game's pipeline - the formula is exact. Parity bound in
`test/expressionInRange.spec.ts` is the standard `8e-3` elevation f32 floor; the
observed worst sits ~4 orders of magnitude under it.

## Port

`src/noise/tiles/expressionInRange.ts`:

```ts
export function expressionInRange(
  peakMultiplier: number,
  peakMaximum: number,
  values: number[],
  froms: number[],
  tos: number[],
): number {
  let m = Infinity;
  for (let i = 0; i < values.length; i++) {
    const edgeDistance = Math.min(values[i] - froms[i], tos[i] - values[i]);
    if (edgeDistance < m) m = edgeDistance;
  }
  return Math.min(peakMaximum, peakMultiplier * m);
}
```

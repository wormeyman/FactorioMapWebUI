# Vulcanus seed variables: `map_seed_normalized`, `map_seed_small`, `x_from_start`, `y_from_start`

Task 2 of the Vulcanus-port plan. These four are the engine builtins behind
`vulcanus_ashlands_angle = map_seed_normalized * 3600` and
`vulcanus_starting_direction = -1 + 2*(map_seed_small & 1)`
(`~/GitHub/factorio-data` tag `2.1.11`,
`space-age/prototypes/planet/planet-vulcanus-map-gen.lua` around line 172).

## Where the formulas come from

Two of the four are actually **documented**, not pure engine mysteries: the
game's own bundled docs (`.../factorio.app/Contents/doc-html/auxiliary/noise-expressions.html`,
"Built-in constants" section) list, verbatim:

- `map_seed` (Number): 32-bit unsigned integer
- `map_seed_small` (Number): 16 least significant bits from `map_seed`
- `map_seed_normalized` (Number): 0-1 normalized value of `map_seed`

That text alone doesn't pin an exact formula (`& 0xFFFF` vs. some other
16-bit derivation; `/2^31` vs `/2^32`; f32 vs f64 rounding), so this task
still captured real oracle data and fit it, rather than shipping the prose
description as-is. The repo's usual `factorioLuaAPI/` mirror is absent in this
sandbox (git-ignored); the bundled install copy at
`~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/doc-html`
was used instead (same source Task 1 used).

`x_from_start`/`y_from_start` are NOT undocumented builtins with zero source -
`~/GitHub/factorio-data`, `core/prototypes/noise-programs.lua` lines 594-601,
defines them as ordinary named noise-expressions:

```lua
{ type = "noise-expression", name = "x_from_start",
  expression = "distance_from_nearest_point_x(x, y, starting_positions)" },
{ type = "noise-expression", name = "y_from_start",
  expression = "distance_from_nearest_point_y(x, y, starting_positions)" }
```

So the only genuine "no Lua source" primitives underneath them are the native
functions `distance_from_nearest_point_x`/`_y` themselves (siblings of
`distance_from_nearest_point`, already RE'd for M1 - see
`docs/noise/basis-noise-NOTES.md`/`src/noise/distanceFromNearestPoint.ts`).
This task did not need to RE those natives directly, because at a freshly
created planet surface `starting_positions` resolves to a single point at the
origin (see below) - so `x_from_start == x` and `y_from_start == y` fell out
directly without needing the general nearest-point-component formula.

## Capture

`test/oracle/capture.ts` `captureSeedVars()`, gated as `want("seed-vars")`.
Samples all four expressions at ONE fixed point (`{x: 300.5, y: -700.25}` -
chosen off-axis and off-integer so a coincidental `x==0`/`y==0` degenerate
match is ruled out) across 12 seeds, through
`{ spaceAge: true, planet: "vulcanus" }` (a real
`game.planets["vulcanus"].create_surface()`, per-call seed via the
read-modify-write `mgs.seed` pattern - see `buildSpaceAgeControlLua`).

Seeds (12, spanning the full 32-bit range, including all the brief's required
values): `123456, 0, 1, 2, 0xFFFFFFFF, 42, 654321, 424242, 100000,
0x7FFFFFFF, 3000000000, 999999999`.

Regenerate: `node --experimental-strip-types test/oracle/capture.ts seed-vars`
Fixture: `test/fixtures/oracle-seed-vars.multi.json`.

Ran for real against the local Factorio 2.1.12 (Space Age) install - this is
genuine ground truth, not synthesized.

## Results table

| seed0 | oracle mapSeedNormalized | oracle mapSeedSmall | xFromStart | yFromStart |
|---|---|---|---|---|
| 123456 | 0.00002874433994293213 | 57920 | 300.5 | -700.25 |
| 0 | 0 | 0 | 300.5 | -700.25 |
| 1 | 2.3283064365386963e-10 | 1 | 300.5 | -700.25 |
| 2 | 4.656612873077393e-10 | 2 | 300.5 | -700.25 |
| 4294967295 (0xFFFFFFFF) | 1 | 65535 | 300.5 | -700.25 |
| 42 | 9.778887033462524e-9 | 42 | 300.5 | -700.25 |
| 654321 | 0.00015234597958624363 | 64497 | 300.5 | -700.25 |
| 424242 | 0.00009877653792500496 | 31026 | 300.5 | -700.25 |
| 100000 | 0.000023283064365386963 | 34464 | 300.5 | -700.25 |
| 2147483647 (0x7FFFFFFF) | 0.5 | 65535 | 300.5 | -700.25 |
| 3000000000 | 0.6984919309616089 | 24064 | 300.5 | -700.25 |
| 999999999 | 0.23283064365386963 | 51711 | 300.5 | -700.25 |

`xFromStart`/`yFromStart` are `300.5`/`-700.25` for every single seed - exactly
the sampled point, with zero deviation across all 12 seeds.

## Derivation: `map_seed_normalized`

Candidate from the brief: `seed0 / 2^32` (double) vs. `Math.fround(seed0 / 2^32)`
(f32-rounded, per this codebase's established convention - see
`Math.fround` usage in `src/noise/fastApprox.ts`, `src/noise/startingLakes.ts`,
etc. - the game's noise VM runs in f32).

Checked both against every row (`node -e` one-liner, see below) via strict
`===`:

- Plain double `seed0 / 2^32`: matches 9 of 12 rows exactly. Fails at
  `seed0 = 0xFFFFFFFF` (raw = `0.9999999997671694`, oracle = `1`),
  `0x7FFFFFFF` (raw = `0.49999999976716936`, oracle = `0.5`), and
  `999999999` (raw = `0.23283064342103899`, oracle = `0.23283064365386963`).
- `Math.fround(seed0 / 2^32)`: matches **all 12 of 12** rows exactly
  (residual 0 in every case - not "close", bit-identical).

**Formula: `mapSeedNormalized(seed0) = Math.fround(seed0 / 4294967296)`.**
`4294967296 === 2**32`.

The three double-only mismatches are exactly where the fraction sits within
one f32 ULP of a round value (`1`, `0.5`) or where the f64 and f32 roundings
of a general fraction simply differ in the last couple of bits - both
textbook "the noise VM is f32" behavior seen everywhere else in this port
(basis noise, multioctave noise, etc.), not a new phenomenon.

**Contract note, not a bug**: the interface says "`seedNormalized(seed0)` in
`[0,1)`" (a half-open unit interval, as you'd expect from "normalize a 32-bit
uint"). The f32 rounding breaks that at the very top of the range:
`seedNormalized(0xFFFFFFFF) === 1` exactly, not something-just-under-1. This
is not a formula error - it's what the game itself computes (verified above),
so `[0, 1]` (closed) is the honest range, at least at that one boundary seed.
Downstream consumers (`vulcanus_ashlands_angle = map_seed_normalized * 3600`)
tolerate a closed range fine (max angle 3600 instead of "just under 3600",
and callers already normalize angles mod 360 elsewhere), so this is recorded
here as a finding, not treated as a reason to clamp or adjust the formula.

## Derivation: `map_seed_small`

Candidate from the brief: `seed0 & 0xFFFF` vs. "the low 32 bits" (i.e. the
whole seed - clearly wrong per the doc's own "16 least significant bits" and
ruled out immediately: every oracle value is `<= 65535`, but `seed0` itself
goes up to `4294967295`).

Checked `seed0 % 65536` (equivalent to `seed0 & 0xFFFF` but avoids any JS
32-bit-signed bitwise ambiguity for `seed0` near `2^31`/`2^32`) against every
row: **12 of 12 exact matches**, e.g. `654321 % 65536 = 64497` (oracle
`64497`), `0xFFFFFFFF % 65536 = 65535` (oracle `65535`).

**Formula: `mapSeedSmall(seed0) = seed0 & 0xFFFF`** (implemented with `&`,
which JS's `ToInt32` coercion makes bit-identical to `% 65536` for any
`seed0` in `[0, 2^32)` - verified for all 12 fixture rows including the two
that exceed `2^31`).

Only the parity (`& 1`) of this value is consumed downstream
(`vulcanus_starting_direction`), and both `654321 & 1` etc. trivially agree
between the `& 0xFFFF` and `% 65536` formulations, so there was never a
disagreement to arbitrate there - the two candidates coincide completely on
this data.

## Finding: `x_from_start` / `y_from_start`

`x_from_start == x` and `y_from_start == y` **exactly**, for every one of the
12 seeds, at the single sampled point `(300.5, -700.25)` - no offset, no
seed-dependence. Per `core/prototypes/noise-programs.lua`, `x_from_start =
distance_from_nearest_point_x(x, y, starting_positions)`, so this means
`starting_positions` resolves to a single point at the surface origin `(0, 0)`
on a freshly-`create_surface()`'d Vulcanus surface, regardless of seed -
consistent with the game not having actually resolved a real spawn point yet
(no chunks were generated in this probe; `starting_positions` is presumably
seeded from `MapGenSettings` at a default `(0,0)` until real spawn-search runs
against generated terrain). This matches the "far-from-spawn" caveat already
recorded for the Nauvis `elevation_lakes`/`elevation_nauvis` oracle fixtures
(`docs/noise/m1-elevation-lakes...` lineage in MEMORY) and the client-side
model's own existing default (`distanceFromNearestPoint(x, y,
startingPositions)` callers elsewhere in `src/noise/` already default the
spawn list to `[{x: 0, y: 0}]` absent a resolved real spawn) - so this is a
**confirmation**, not a new offset to account for. No code change was needed
for this finding: `x_from_start`/`y_from_start` are not exposed as functions
in `src/noise/expressions/vulcanusSeed.ts` (out of this task's interface
scope - see the brief), but any later task that needs
`distance_from_nearest_point_x/_y` in general (not just at the default spawn)
can reuse `src/noise/distanceFromNearestPoint.ts`'s existing point-list
machinery and simply return the signed component instead of the magnitude.

## Verification one-liner (for reproducibility)

```js
node -e '
const seeds = [123456,0,1,2,0xffffffff,42,654321,424242,100000,0x7fffffff,3000000000,999999999];
const oracleNorm = {123456:0.00002874433994293213,0:0,1:2.3283064365386963e-10,2:4.656612873077393e-10,4294967295:1,42:9.778887033462524e-9,654321:0.00015234597958624363,424242:0.00009877653792500496,100000:0.000023283064365386963,2147483647:0.5,3000000000:0.6984919309616089,999999999:0.23283064365386963};
const oracleSmall = {123456:57920,0:0,1:1,2:2,4294967295:65535,42:42,654321:64497,424242:31026,100000:34464,2147483647:65535,3000000000:24064,999999999:51711};
for (const s of seeds) {
  console.log(s,
    "norm fround-match=", Math.fround(s/4294967296)===oracleNorm[s],
    "small-match=", (s & 0xffff)===oracleSmall[s]);
}
'
```

All 12 rows print `true`/`true`.

## Conclusion

Both formulas are exact (tolerance 0) integer/f32 relations, over-determined
by 12 seeds. No STOP condition triggered.

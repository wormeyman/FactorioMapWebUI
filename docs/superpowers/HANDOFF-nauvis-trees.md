# Handoff - Nauvis trees phase 1 (`feat/nauvis-trees`)

Written 2026-07-21 end of session. Live until the branch merges, then delete it.

## State in one line

All 13 planned tasks, two fidelity fixes, **and the whole-branch review with all
seven of its findings fixed** are implemented, committed and green (906 passing /
2 skipped) on `feat/nauvis-trees`. **Not merged, not pushed, not deployed.** The
only thing left is the merge decision, then deploy.

Run `pnpm vp test` on arrival to confirm the suite is still green before trusting
any of this.

## Session 2 (2026-07-22): review + the perf fix

Two reviewers covered the branch (noise core / render + UI). **Neither found a
Critical.** The noise core got the strongest available validation: all 15 species
expressions were reconstructed from the catalog and matched character-for-character
against real 2.1.11 game data, and `BASIS_ABS_MAX = 1.8` was shown to be a genuine
*analytic* bound (1.771875), not merely measured.

**The one real defect was performance, and it was a spec deviation.** The design
doc said the shared per-pixel terms "are computed once per pixel"; they were
computed once per *species*, 15x over, and `evalAt` recomputed `cheapAt` a second
time. The climate stack costs more than the species noise the early-out was
saving, so this dominated the whole render.

Browser-measured, seed 123456, 1024^2, median of 5 (`all` composite):

| | before | after | main, no trees |
| --- | --- | --- | --- |
| `all` | 6,965 ms | **2,214 ms** | 1,844 ms |

Trees' marginal cost over the no-trees baseline went **5,121 ms -> 370 ms**. The
density field alone is 9.5-10.4x faster, with **identical checksums** in three
regions - the fix had to be bit-identical, so term order is preserved deliberately
(float addition is not associative; see the comment in `treeField.ts`).

The seven findings, all fixed:

1. `0adf590` - the perf hoist above.
2. `b1f8762` - the composite-ordering assertion was order-INVARIANT (it held even
   if trees composited last and washed the ore green). Now pinned; mutation-checked.
3. `b1f8762` - `pnpm perf`'s headline `ALL` row never imported `renderTrees`, so it
   measured a composite the app does not render. Fixed, plus a `terrain + trees` row.
4. `b1f8762` - `control:temperature:*` was parsed by `climateReads` and silently
   dropped. Nothing consumed `temperature` before trees, so an imported exchange
   string carrying an override rendered the wrong forests with no signal. Threaded
   through; there is no UI for it, so the new tests are the only thing holding the
   wiring, and both were mutation-checked.
5. `29d9a56` - the per-species `cap` was validated by nothing (it binds at 0 of 390
   oracle points). Closed by checking in the game's expression strings and
   reconstructing them from the catalog character-for-character, which pins `cap`
   plus every ramp/scale/seed/offset without needing a Factorio install.
6. `b1f8762` - two docs claimed the five excluded dead/dry trees "feed decorative
   prototypes". Verified false against 2.1.11: they are real `type = "tree"`
   entities on `control = "trees"` that the game's preview charts. They are excluded
   on **measured** contribution (max gain 0.038). Both docs corrected.
7. `b1f8762` - stale "all five toggles" comment (six now), duplicated roadmap bullet.

Deferred minors from `.superpowers/sdd/progress.md` were triaged by both reviewers;
the remainder are explicitly "ship as-is", including the pre-existing
`CliffSettings` looseness in `test/elevationPreviewCtx.spec.ts`.

**Still open, not blocking:** the kernel in `renderTrees.ts` is only physically
correct at `tilesPerPixel = 1` (the app is hard-pinned there, but a future zoom
feature would inherit a wrong model silently). Phase 2 (placement stipple) remains
deferred.

## What shipped

Nauvis forests now render in the client-side preview: 15 tree species probability
fields, composed into a per-pixel density, drawn as a green overlay with its own
`view: "trees"` and included in the `"all"` composite, wired to the Trees
frequency/size sliders, Nauvis-gated like the other overlays.

Commits, oldest first:

| commit | what |
| --- | --- |
| `9b8a3b1` | `asymmetric_ramps` helper |
| `1bbc04c` | 15-species catalog with crc32 seed1s |
| `1cfc48a` | `tree_small_noise` + forest-path cutout chain |
| `dd232ee` | `makeTreeDensity` (full evaluation, no early-out) |
| `7ae041c` | test hardening: prove the size lever is live |
| `e71886e` | oracle capture + validation of all 15 species |
| `d03ab88` | **fix: per-species `sizeOffset`** (the bug the oracle caught) |
| `a3b8c9d` | corrected the false uniformity claim in spec + plan |
| `9f8b502` | `control:trees` frequency/size lever fixture |
| `197857a` | per-pixel early-out (`BASIS_ABS_MAX = 1.8`, ~59% skip) |
| `61ebb59` | `renderTrees` overlay |
| `78a9c25` | `view: "trees"` dispatch, composited under the other overlays |
| `9c57542` | tiled-equality gate covers trees |
| `2ea5cf2` | `treeControls` derived from the preset |
| `5adce23` | doc comment fix |
| `69de9e7` | Trees UI toggle |
| `38f955b` | **fix: paint trees over their charted footprint** |
| `26bf853` | **fix: overlapping trees compound their blend** |
| `fcd04f2` | docs: notes + roadmap |

## Read these first - authoritative, do not re-derive

- `/Users/ericjohnson/GitHub/FactorioMapWebUI/docs/noise/trees-NOTES.md` - the
  full reverse-engineering writeup, including the map-preview call chain, the
  `drawRectangle` rasterization, the charted-box determination, and the two-seed
  validation. **This is the file that matters.**
- `/Users/ericjohnson/GitHub/FactorioMapWebUI/docs/superpowers/specs/2026-07-21-nauvis-trees-design.md`
  - the design, including a correction section recording a methodology error.
- `/Users/ericjohnson/GitHub/FactorioMapWebUI/.superpowers/sdd/progress.md` - the
  task-by-task ledger with every review verdict, all deferred minors, and the
  measurement numbers. Git-ignored scratch, so read it before any `git clean`.
- `/Users/ericjohnson/GitHub/FactorioMapWebUI/docs/noise/placement-roll-NOTES.md`
  - the deferred Phase 2 (stipple) research.

## The three findings worth remembering

1. **The oracle caught a real bug that the spec said was impossible.** `tree_05`
   and `tree_07` use `-0.45 + 0.2 * control:trees:size` where the other 13 species
   use `-0.5`. The spec asserted all 15 shared exactly one shape, "verified
   mechanically" - but that verification filtered out every line containing
   `control:trees:size`, so the one field that varies was the one field excluded
   from the check. Four tasks were built on the wrong premise. Fixed via a
   `sizeOffset` catalog field with a regression guard pinning the exception set.

2. **The game's preview places real entities, then charts them.**
   `MapPreviewGenerator::Worker::computeEntities` builds a real
   `EntityMapGenerationTask`. There is no probability-shading path in the binary.
   Pixel-exact trees therefore require the deferred M3.5 placement roll.

3. **A tree paints every pixel its box touches, not one pixel.**
   `ChartingInterface::drawRectangle` rasterizes floor-to-ceil and blends each
   touched pixel at full alpha. Modelling one pixel per tree left the overlay
   **4.2x under-inked**. Fixed with the RE-derived `[0.5, 1.0, 0.5]` kernel plus
   compounding blends. Validated against real game renders on two seeds:

   | seed | game ink | our ink | ratio |
   | --- | --- | --- | --- |
   | 123456 | 5.70 | 4.67 | 1.22x |
   | 777771 | 7.89 | 6.89 | 1.14x |

   The residual ~1.2x is the expected-value-vs-discrete difference and only Phase
   2's stipple can close it. **Do not tune further - that would be overfitting.**

## Next steps, in order

1. ~~Final whole-branch review~~ - done 2026-07-22, all seven findings fixed.
2. ~~Look at it in a browser~~ - done; rendered and measured (numbers above).
   Eric has not personally eyeballed it yet, so that is worth doing before deploy.
3. **Merge decision** via `superpowers:finishing-a-development-branch`. This is the
   next action.
4. Only then deploy (`pnpm run deploy`) - device testing was deliberately deferred
   to the deployed site.

To re-measure the composite against a no-trees baseline, do NOT symlink
`node_modules` into a `main` worktree - `vp` resolves the project root through it
and silently serves the *branch* code from the main repo's cwd (this produced a
bogus baseline once, caught only because `main` showed a Trees toggle it could not
have). Run a real `pnpm install` in the worktree; it takes ~1.3 s off the store.

## Conventions and gotchas

- Tests: `pnpm vp test`. **Never** a bare `vp` or `npx vp` - `devEngines` pins
  pnpm and a bare invocation fails with `EBADDEVENGINES`.
- Lint: `pnpm vp check --fix`. There is no `vue-tsc` type-check for `.vue` files
  (deliberate, documented in CLAUDE.md).
- Game data: `~/GitHub/factorio-data` @ tag **2.1.11**. Never
  `~/Downloads/factorio 4/data` (2.0.77, stale).
- `test/fixtures/*` is ground truth captured from the real game. **Read-only.** If
  code disagrees with a fixture, the code is wrong.
- `makeTreeDensity` in `src/noise/trees/treeField.ts` must stay the pure per-tile
  probability field - it is oracle-validated and Phase 2 consumes it unchanged.
  Rendering concerns (the footprint kernel, the blend) live in `renderTrees.ts`.
- Prose and comments use hyphens (-), never em or en dashes.
- **Do not weaken a tolerance or edit a fixture to make a test pass.** Three real
  defects on this branch were caught precisely because agents refused to.
- **HIPAA constraint (2026-07-21):** this machine is subject to Eric's obligations
  as an insurance broker. Do not expose dev servers to the network, do not add
  `node` to the macOS firewall allowlist, and do not use public tunnels
  (`cloudflared` and similar). Localhost-only is fine. Device testing waits for the
  Cloudflare deploy.

## Open, deferred, not blocking

- Browser render timing for trees (see step 2 above).
- The committed `pnpm perf` bench (`test/render-cost.perf.spec.ts`) hand-assembles
  its `all` row and so does **not** cover the trees-inclusive composite. A scratch
  spec measuring it was written during task 13 and deleted as intended; if the
  trees cost turns out to matter, adding a real trees row to that bench is the
  clean fix rather than re-creating a scratch file.
- Deferred minors are listed at the bottom of `.superpowers/sdd/progress.md` -
  including a pre-existing `CliffSettings` type looseness in
  `test/elevationPreviewCtx.spec.ts` that predates this branch.
- Phase 2 (per-tile placement stipple) remains deferred; it would upgrade trees,
  resources and enemy bases from shading/footprint to faithful stipple in one go.

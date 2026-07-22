# Handoff - Nauvis trees phase 1 (`feat/nauvis-trees`)

Written 2026-07-21 end of session. Live until the branch merges, then delete it.

## State in one line

All 13 planned tasks plus two follow-up fidelity fixes are **implemented,
reviewed, committed, and green** (883 passing / 2 skipped) on `feat/nauvis-trees`,
tip `fcd04f2`. **Not merged, not pushed, not deployed.** The only thing left is
the final whole-branch review, then the merge decision.

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

1. **Final whole-branch review.** Not yet run. Use
   `superpowers:requesting-code-review` against `git merge-base main HEAD`..`HEAD`,
   and point it at the deferred-minors list at the bottom of
   `.superpowers/sdd/progress.md` so it can triage which must be fixed before merge.
2. **Look at it in a browser.** No human has seen this render in the app yet.
   `pnpm vp dev` (localhost only - see the constraint below), enable Debug, click
   Trees and All. Take the median of 3 elapsed-ms readings at 1024x1024 for `all`
   with and without trees. The Node bench is ~15% optimistic vs the browser, so the
   browser number is the one that counts and it has **not** been taken for trees.
3. **Merge decision** via `superpowers:finishing-a-development-branch`.
4. Only then deploy (`pnpm run deploy`) - device testing was deliberately deferred
   to the deployed site.

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

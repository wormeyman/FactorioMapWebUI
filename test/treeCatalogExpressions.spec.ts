import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/tree-expressions.2.1.11.json";
import { TREE_SPECIES, type TreeSpecies } from "../src/noise/trees/treeCatalog";

/**
 * Reconstruct-and-compare: rebuild each species' Lua expression string from its
 * catalog row and diff it against the real game data, character for character.
 *
 * This exists because the ORIGINAL uniformity claim was "verified mechanically"
 * by filtering the common terms out of every `tree_0*` block and observing that
 * nothing was left - but the filter dropped every line containing
 * `control:trees:size`, which is exactly where the one per-species divergence
 * lived (tree_05/tree_07 use -0.45, not -0.5). Four tasks were built on that
 * wrong premise before the oracle caught it.
 *
 * A filter-then-compare check can only find what its filter lets through. This
 * one has no filter: if a single constant in the game's string is not accounted
 * for by a catalog field, the strings differ and the test fails. It also needs
 * no Factorio install - the fixture is checked in.
 */
const EXPRESSIONS: Record<string, string> = fixture.expressions;

/** Lua prints 1 as "1", not "1.0" - match its number formatting. */
const num = (n: number): string => String(n);

/**
 * The shape every one of the 15 species shares. Mirrors the layout in
 * `base/prototypes/entity/trees.lua`; the whitespace looks odd because Lua's
 * `\z` swallowed the newline plus the following indentation.
 */
function reconstruct(s: TreeSpecies): string {
  const [tb, tt, tot, tob] = s.tempRamp;
  const [mb, mt, mot, mob] = s.moistRamp;
  return (
    `min(${num(s.cap)}, trees_forest_path_cutout_faded,` +
    `min(0,` +
    `asymmetric_ramps{input=temperature, from_bottom=${num(tb)}, from_top=${num(tt)}, ` +
    `to_top=${num(tot)}, to_bottom=${num(tob)}},` +
    `asymmetric_ramps{input=moisture, from_bottom=${num(mb)}, from_top=${num(mt)}, ` +
    `to_top=${num(mot)}, to_bottom=${num(mob)}})` +
    `+ min(0, distance/20 - 3)` +
    `- ${num(s.sizeOffset)} + 0.2 * control:trees:size` +
    `+ tree_small_noise * 0.1` +
    `+ multioctave_noise{x = x,y = y,persistence = 0.65,seed0 = map_seed,` +
    `seed1 = '${s.seed1Name}',octaves = 3,` +
    `input_scale = 1/${num(s.inputScaleDiv)} * control:trees:frequency,` +
    `output_scale = ${num(s.outputScale)}})`
  );
}

describe("tree catalog vs. the real 2.1.11 expressions", () => {
  it.each(TREE_SPECIES.map((s) => [s.name, s] as const))(
    "%s reconstructs the game's expression exactly",
    (name, species) => {
      expect(EXPRESSIONS[name], `${name} missing from the fixture`).toBeDefined();
      expect(reconstruct(species)).toBe(EXPRESSIONS[name]);
    },
  );

  // The five the port deliberately leaves out. They are NOT decoratives (a claim
  // the docs used to make): all five are real `type = "tree"` entity prototypes
  // on `control = "trees"` that the game's preview charts like any other tree.
  // They are excluded on measured contribution - max density gain 0.038, ~1.5%
  // of max alpha. `tree_dry` is not even an independent species; it is derived,
  // `0.2 * max(tree_01, tree_09, ...)`. See docs/noise/trees-NOTES.md.
  const EXCLUDED = [
    "tree_dead_desert",
    "tree_dead_dry_hairy",
    "tree_dead_grey_trunk",
    "tree_dry",
    "tree_dry_hairy",
  ];

  it("accounts for every tree_* expression in the game data", () => {
    // If 2.1.x ever adds a 16th species, it lands in neither list and this fails
    // rather than being silently absent from the render.
    const ported = TREE_SPECIES.map((s) => s.name);
    expect([...ported, ...EXCLUDED].sort()).toEqual(Object.keys(EXPRESSIONS).sort());
  });

  it("pins the sizeOffset exception set", () => {
    // Belt-and-braces with treeCatalog.spec.ts: prove from the GAME DATA (not the
    // catalog) that exactly tree_05 and tree_07 carry the -0.45 offset.
    const fromGame = Object.entries(EXPRESSIONS)
      .filter(([, e]) => e.includes("- 0.45 + 0.2 * control:trees:size"))
      .map(([n]) => n)
      .sort();
    expect(fromGame).toEqual(["tree_05", "tree_07"]);
  });
});

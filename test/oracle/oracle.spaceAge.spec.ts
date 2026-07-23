import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  buildModList,
  buildSpaceAgeControlLua,
  buildSpaceAgeModList,
  oracleAvailable,
  PROBE_NAME,
  sampleExpression,
} from "./oracle";

describe("Space-Age oracle - pure builders", () => {
  it("buildSpaceAgeModList enables base, space-age, elevated-rails, quality and the probe", () => {
    const modList = buildSpaceAgeModList() as { mods: { name: string; enabled: boolean }[] };
    const names = modList.mods.map((m) => m.name);
    expect(names).toEqual(["base", "space-age", "elevated-rails", "quality", PROBE_NAME]);
    expect(modList.mods.every((m) => m.enabled)).toBe(true);
  });

  it("the non-Space-Age buildModList is unaffected (only base + probe)", () => {
    const modList = buildModList() as { mods: { name: string }[] };
    expect(modList.mods.map((m) => m.name)).toEqual(["base", PROBE_NAME]);
  });

  it("buildSpaceAgeControlLua creates the planet's own surface and routes the property onto it", () => {
    const lua = buildSpaceAgeControlLua(
      [
        { x: 0.5, y: 0.25 },
        { x: -3.5, y: 7.125 },
      ],
      { property: "elevation", planet: "vulcanus", seed: 123456 },
    );
    expect(lua).toContain('game.planets["vulcanus"].create_surface()');
    expect(lua).toContain("mgs.seed = 123456");
    expect(lua).toContain(`mgs.property_expression_names["elevation"] = "${PROBE_NAME}"`);
    expect(lua).toContain("surface.map_gen_settings = mgs");
    // property_names come FIRST in calculate_tile_properties (the HTML docs are wrong).
    expect(lua).toContain('surface.calculate_tile_properties({"elevation"}');
    expect(lua).toContain("x = 0.5");
    expect(lua).toContain("y = 7.125");
    expect(lua).toContain("DUMPED-OK");
  });

  it("buildSpaceAgeControlLua defaults planet to vulcanus and seed to 123456", () => {
    const lua = buildSpaceAgeControlLua([{ x: 0, y: 0 }]);
    expect(lua).toContain('game.planets["vulcanus"].create_surface()');
    expect(lua).toContain("mgs.seed = 123456");
  });
});

describe("Space-Age oracle integration (gated on a local Factorio + Space Age install)", () => {
  // Runs the REAL game with Space Age loaded (~1.7s+). Proves the surface/planet
  // routing actually resolves vulcanus_* named noise expressions end to end, by
  // checking the two documented CONSTANT expressions come back as their known
  // values - a wrong surface (e.g. still Nauvis) would either error out (no
  // vulcanus_* context) or simply prove nothing, since these two happen to be
  // literal-arithmetic expressions with no surface dependency; the exact match
  // still confirms the whole spaceAge/planet plumbing (mod-list, control.lua,
  // create_surface, map_gen_settings rewrite) works, not just that Factorio ran.
  it.skipIf(!oracleAvailable())(
    "samples vulcanus_starting_area_radius and vulcanus_ore_spacing against a real Vulcanus surface",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "oracle-vulcanus-"));
      try {
        const positions = [{ x: 0.5, y: 0.25 }];

        const [radius] = await sampleExpression("vulcanus_starting_area_radius", positions, {
          workDir,
          seed: 123456,
          spaceAge: true,
          planet: "vulcanus",
        });
        // 0.7 * 0.75: not assumed bit-exact in floating point, but must land on 0.525.
        expect(radius).toBeCloseTo(0.525, 6);

        const [spacing] = await sampleExpression("vulcanus_ore_spacing", positions, {
          workDir,
          seed: 123456,
          spaceAge: true,
          planet: "vulcanus",
        });
        expect(spacing).toBe(128);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

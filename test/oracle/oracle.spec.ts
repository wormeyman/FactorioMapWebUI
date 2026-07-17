import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { basisNoise, basisNoiseTablesFromSeed } from "../../src/noise/basisNoise";
import basisFixture from "../fixtures/oracle-basis.seed123456.json";
import {
  buildControlLua,
  buildDataLua,
  buildFactorioArgs,
  buildMapGenSettings,
  DUMP_FILE,
  oracleAvailable,
  parseDump,
  PROBE_NAME,
  type Position,
  sampleExpression,
  type SpawnResult,
} from "./oracle";

describe("oracle harness - pure builders", () => {
  it("buildDataLua registers the probe as a noise-expression, embedding the expression verbatim", () => {
    // Expression carries the exact metacharacters real trees use: braces, quotes,
    // var('...'). A naive quoted Lua string would break; a long bracket must not.
    const expr = "clamp(0.5 + var('control:aux:bias') + basis_noise{x = x, y = y}, 0, 1)";
    const lua = buildDataLua(expr);
    expect(lua).toContain('type = "noise-expression"');
    expect(lua).toContain(`name = "${PROBE_NAME}"`);
    expect(lua).toContain(expr);
  });

  it("buildControlLua dumps the routed property and exits with the DUMPED-OK sentinel", () => {
    const lua = buildControlLua([
      { x: 0.5, y: 0.5 },
      { x: -3.5, y: 7.125 },
    ]);
    // property_names come FIRST in calculate_tile_properties (the HTML docs are wrong).
    expect(lua).toContain('calculate_tile_properties({"elevation"}');
    expect(lua).toContain("x = 0.5");
    expect(lua).toContain("y = 7.125");
    expect(lua).toContain(DUMP_FILE);
    expect(lua).toContain("DUMPED-OK");
  });

  it("buildMapGenSettings routes the probe onto the target property and carries the seed", () => {
    const mgs = buildMapGenSettings({ seed: 987654, property: "elevation" }) as {
      seed: number;
      property_expression_names: Record<string, string>;
    };
    expect(mgs.seed).toBe(987654);
    expect(mgs.property_expression_names.elevation).toBe(PROBE_NAME);
  });

  it("buildFactorioArgs assembles the headless create CLI in order", () => {
    const args = buildFactorioArgs({
      savePath: "/w/probe.zip",
      mapGenPath: "/w/mgs.json",
      seed: 123456,
      modDir: "/w/mods",
      configPath: "/w/config.ini",
    });
    expect(args).toEqual([
      "--create",
      "/w/probe.zip",
      "--map-gen-settings",
      "/w/mgs.json",
      "--map-gen-seed",
      "123456",
      "--mod-directory",
      "/w/mods",
      "--config",
      "/w/config.ini",
    ]);
  });

  it("parseDump returns positions paired with their values", () => {
    const json = JSON.stringify({
      values: [0.1, -0.2],
      positions: [
        { x: 0.5, y: 0.5 },
        { x: 1.5, y: 2.5 },
      ],
    });
    const parsed = parseDump(json);
    expect(parsed.values).toEqual([0.1, -0.2]);
    expect(parsed.positions).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 2.5 },
    ]);
  });
});

describe("oracle harness - sampleExpression wiring", () => {
  it("writes the mod tree, invokes factorio, and returns the parsed values", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-wire-"));
    try {
      // Fake factorio: assert the args are what we built, then write the dump the
      // real game would have written, so we exercise the full read-back path.
      const fakeSpawn = (_bin: string, args: readonly string[]) => ({
        async done(): Promise<SpawnResult> {
          const savePath = args[args.indexOf("--create") + 1];
          const writeDir = join(savePath, "..");
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(join(writeDir, "script-output"), { recursive: true });
          await writeFile(
            join(writeDir, "script-output", DUMP_FILE),
            JSON.stringify({
              values: [11, 22],
              positions: [
                { x: 0.5, y: 0.5 },
                { x: 1.5, y: 2.5 },
              ],
            }),
          );
          return { code: 1, stderr: "control.lua:13: DUMPED-OK" };
        },
      });

      const values = await sampleExpression(
        "basis_noise{x = x, y = y, seed0 = map_seed, seed1 = 0, input_scale = 0.125}",
        [
          { x: 0.5, y: 0.5 },
          { x: 1.5, y: 2.5 },
        ],
        { workDir, factorioBin: "/fake/factorio", dataDir: "/fake/data", spawnFn: fakeSpawn },
      );

      expect(values).toEqual([11, 22]);
      // The mod files must actually be on disk for the real game to load them.
      const dataLua = await readFile(
        join(workDir, "mods", `${PROBE_NAME}_0.0.1`, "data.lua"),
        "utf8",
      );
      expect(dataLua).toContain("input_scale = 0.125");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("oracle fixture is genuine ground truth", () => {
  // CI-safe: no Factorio needed. If our pure basisNoise reproduces the committed
  // dump, the harness captured real game values (and basisNoise is still correct).
  it("pure basisNoise reproduces the committed oracle-basis fixture to the noise floor", () => {
    const tables = basisNoiseTablesFromSeed(basisFixture.seed0, basisFixture.seed1);
    let worst = 0;
    for (const p of basisFixture.points) {
      const got = basisNoise(p.x * basisFixture.inputScale, p.y * basisFixture.inputScale, tables);
      worst = Math.max(worst, Math.abs(got - p.v));
    }
    // ~2e-6 is the game's own fastapprox self-consistency floor.
    expect(worst).toBeLessThan(2e-6);
  });
});

describe("oracle integration (gated on a local Factorio install)", () => {
  // Runs the REAL game (~1.7s). Proves the committed harness still reproduces the
  // committed fixture bit-for-bit - catches drift in the recipe or a game update.
  it.skipIf(!oracleAvailable())(
    "live oracle reproduces the committed fixture exactly",
    async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const workDir = await mkdtemp(join(tmpdir(), "oracle-live-"));
      try {
        const positions: Position[] = basisFixture.points.map((p) => ({ x: p.x, y: p.y }));
        const values = await sampleExpression(basisFixture.expression, positions, {
          workDir,
          seed: basisFixture.seed0,
        });
        expect(values.length).toBe(basisFixture.points.length);
        for (let i = 0; i < values.length; i++) {
          // Same game, same seed, same positions -> identical bytes.
          expect(values[i]).toBe(basisFixture.points[i].v);
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

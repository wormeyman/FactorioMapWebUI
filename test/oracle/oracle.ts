/**
 * A reusable headless "oracle" for the noise reverse-engineering work: it routes
 * an arbitrary named noise expression onto a map-gen property (default
 * `elevation`), runs Factorio 2.1 headless for ~1.7 s, and reads the exact values
 * the game computed via `LuaSurface.calculate_tile_properties`. This is the ground
 * truth every noise primitive and every ported expression is validated against.
 *
 * The recipe (proven in docs/noise/basis-noise-NOTES.md, re-derived each session
 * until now): a tiny mod registers the probe expression at the data stage; a
 * `--map-gen-settings` JSON points `property_expression_names.<property>` at it; an
 * `on_init` handler samples the property, writes the values as JSON, and
 * `error("DUMPED-OK")`s to exit immediately.
 *
 * Pure builders are exported and unit-tested without Factorio; {@link
 * sampleExpression} wires them to disk and an (injectable) spawn, so the real run
 * is gated on a local install via {@link oracleAvailable}. Not shipped in the app.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Name the probe noise-expression is registered under. */
export const PROBE_NAME = "oracle_probe";
/** File the mod writes into `<write-data>/script-output/`. */
export const DUMP_FILE = "oracle-dump.json";
const MOD_VERSION = "0.0.1";

/** A map position, in world tiles (fractional allowed). */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** What a spawned Factorio process resolves to. Mirrors preview-service/render.mjs. */
export interface SpawnResult {
  readonly code: number | null;
  readonly stderr: string;
}

/** Injectable spawn: `(bin, args) => { done(): Promise<SpawnResult> }`. */
export type SpawnFn = (bin: string, args: readonly string[]) => { done(): Promise<SpawnResult> };

// ---------------------------------------------------------------------------
// Pure builders (unit-testable, no Factorio needed).
// ---------------------------------------------------------------------------

/** The mod's `info.json`. `factorio_version` must be "2.1" or the game skips it. */
export function buildInfoJson(): object {
  return {
    name: PROBE_NAME,
    version: MOD_VERSION,
    title: "Noise Oracle Probe",
    author: "FactorioMapWebUI",
    factorio_version: "2.1",
  };
}

/**
 * The data-stage `data.lua` that registers the probe. The expression is embedded
 * in a Lua long bracket (`[==[ ... ]==]`) so its braces, quotes and `var('...')`
 * survive verbatim - a plain quoted string would break on the first inner quote.
 */
export function buildDataLua(expression: string, probeName = PROBE_NAME): string {
  return `data:extend{{
  type = "noise-expression",
  name = "${probeName}",
  expression = [==[${expression}]==]
}}
`;
}

/** `mod-list.json` enabling `base` plus the probe. */
export function buildModList(probeName = PROBE_NAME): object {
  return {
    mods: [
      { name: "base", enabled: true },
      { name: probeName, enabled: true },
    ],
  };
}

/**
 * The runtime `control.lua`: on map creation, sample `property` at every position
 * and write `{ values, positions }` JSON, then `error(DUMPED-OK)` to exit. The dump
 * always keys the sampled array as `values`, whatever property was routed.
 */
export function buildControlLua(
  positions: readonly Position[],
  opts: { property?: string; dumpFile?: string } = {},
): string {
  const property = opts.property ?? "elevation";
  const dumpFile = opts.dumpFile ?? DUMP_FILE;
  const posLua = positions.map((p) => `    {x = ${p.x}, y = ${p.y}}`).join(",\n");
  return `script.on_init(function()
  local positions = {
${posLua}
  }
  local surface = game.surfaces[1]
  -- property_names come FIRST; the HTML docs list positions first and are wrong.
  local props = surface.calculate_tile_properties({"${property}"}, positions)
  helpers.write_file("${dumpFile}",
    helpers.table_to_json({ values = props["${property}"], positions = positions }), false)
  error("DUMPED-OK")
end)
`;
}

/**
 * The `--map-gen-settings` JSON object. Routes the probe onto `property` and pins
 * the seed (which the probe reads as `map_seed` -> `seed0`). Extra map-gen fields
 * merge in via `overrides`.
 */
export function buildMapGenSettings(
  opts: {
    seed?: number;
    property?: string;
    probeName?: string;
    overrides?: Record<string, unknown>;
  } = {},
): object {
  const property = opts.property ?? "elevation";
  const probeName = opts.probeName ?? PROBE_NAME;
  return {
    seed: opts.seed ?? 123456,
    property_expression_names: { [property]: probeName },
    ...opts.overrides,
  };
}

/**
 * The isolated `config.ini`. `read-data` points at the game's bundled data
 * (default: the `__PATH__executable__` token, which resolves next to the binary);
 * `write-data` is our scratch dir, so `script-output/` (and the dump) land there,
 * clear of the real install.
 */
export function buildConfigIni(
  writeDataDir: string,
  readDataDir = "__PATH__executable__/../data",
): string {
  return `[path]
read-data=${readDataDir}
write-data=${writeDataDir}
[general]
[other]
`;
}

/** The headless `--create` argument vector, in order. */
export function buildFactorioArgs(p: {
  savePath: string;
  mapGenPath: string;
  seed: number;
  modDir: string;
  configPath: string;
}): string[] {
  return [
    "--create",
    p.savePath,
    "--map-gen-settings",
    p.mapGenPath,
    "--map-gen-seed",
    String(p.seed),
    "--mod-directory",
    p.modDir,
    "--config",
    p.configPath,
  ];
}

/** Parse the mod's dump into positions paired with their sampled values. */
export function parseDump(jsonText: string): { positions: Position[]; values: number[] } {
  const parsed = JSON.parse(jsonText) as { positions: Position[]; values: number[] };
  return { positions: parsed.positions, values: parsed.values };
}

// ---------------------------------------------------------------------------
// Integration: run the real (or a fake) Factorio and read the values back.
// ---------------------------------------------------------------------------

/** The known macOS Steam install, used when `FACTORIO_BIN` is unset. */
export const DEFAULT_FACTORIO_BIN =
  process.env.FACTORIO_BIN ??
  `${process.env.HOME ?? ""}/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio`;

/** Bundled data dir sits next to the binary (`Contents/MacOS/factorio` -> `Contents/data`). */
export function defaultDataDir(bin: string): string {
  return join(dirname(bin), "..", "data");
}

/** True when a runnable Factorio binary is present, for gating the integration tests. */
export function oracleAvailable(bin: string = DEFAULT_FACTORIO_BIN): boolean {
  return existsSync(bin);
}

/** Default spawn wrapper around `node:child_process`. */
const nodeSpawn: SpawnFn = (bin, args) => ({
  done: () =>
    new Promise<SpawnResult>((resolve, reject) => {
      import("node:child_process")
        .then(({ spawn }) => {
          const child = spawn(bin, args as string[], { stdio: ["ignore", "ignore", "pipe"] });
          let stderr = "";
          child.stderr.on("data", (d) => {
            stderr += String(d);
          });
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stderr }));
        })
        .catch(reject);
    }),
});

export interface OracleOptions {
  /** Scratch working dir (caller owns/cleans it). Mods, config, save, dump live here. */
  workDir: string;
  /** Map seed -> `seed0`. Default 123456. */
  seed?: number;
  /** Property the probe is routed onto. Default "elevation". */
  property?: string;
  /** Factorio binary. Default `FACTORIO_BIN` or the macOS Steam path. */
  factorioBin?: string;
  /** Bundled data dir. Default derived from the binary. */
  dataDir?: string;
  /** Extra `--map-gen-settings` fields (control levers, etc.). */
  mapGenOverrides?: Record<string, unknown>;
  /** Injectable spawn (default: real `node:child_process`). */
  spawnFn?: SpawnFn;
}

/**
 * Sample a named noise `expression` at `positions` through the real game, returning
 * the values the game computed (aligned with `positions`). ~1.7 s per call. Throws
 * if the binary is missing (gate calls with {@link oracleAvailable}) or if no dump
 * was produced.
 */
export async function sampleExpression(
  expression: string,
  positions: readonly Position[],
  opts: OracleOptions,
): Promise<number[]> {
  const seed = opts.seed ?? 123456;
  const property = opts.property ?? "elevation";
  const factorioBin = opts.factorioBin ?? DEFAULT_FACTORIO_BIN;
  const dataDir = opts.dataDir ?? defaultDataDir(factorioBin);
  const spawnFn = opts.spawnFn ?? nodeSpawn;

  const { workDir } = opts;
  const modDir = join(workDir, "mods");
  const modFilesDir = join(modDir, `${PROBE_NAME}_${MOD_VERSION}`);
  const writeDataDir = join(workDir, "write");
  const savePath = join(writeDataDir, "probe.zip");
  const mapGenPath = join(workDir, "map-gen-settings.json");
  const configPath = join(workDir, "config.ini");

  await mkdir(modFilesDir, { recursive: true });
  await mkdir(writeDataDir, { recursive: true });
  await writeFile(join(modFilesDir, "info.json"), JSON.stringify(buildInfoJson(), null, 2));
  await writeFile(join(modFilesDir, "data.lua"), buildDataLua(expression));
  await writeFile(join(modFilesDir, "control.lua"), buildControlLua(positions, { property }));
  await writeFile(join(modDir, "mod-list.json"), JSON.stringify(buildModList(), null, 2));
  await writeFile(
    mapGenPath,
    JSON.stringify(buildMapGenSettings({ seed, property, overrides: opts.mapGenOverrides })),
  );
  await writeFile(configPath, buildConfigIni(writeDataDir, dataDir));

  const args = buildFactorioArgs({ savePath, mapGenPath, seed, modDir, configPath });
  const { stderr } = await spawnFn(factorioBin, args).done();

  const dumpPath = join(writeDataDir, "script-output", DUMP_FILE);
  let jsonText: string;
  try {
    jsonText = await readFile(dumpPath, "utf8");
  } catch {
    throw new Error(
      `oracle produced no dump at ${dumpPath}. Factorio stderr tail:\n${stderr.slice(-2000)}`,
    );
  }
  return parseDump(jsonText).values;
}

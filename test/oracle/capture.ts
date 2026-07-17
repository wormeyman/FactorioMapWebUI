/**
 * Capture committed oracle fixtures. Run deliberately (not in CI) when a fixture
 * needs (re)generating; it needs a local Factorio 2.1 install.
 *
 *   node --experimental-strip-types test/oracle/capture.ts
 *
 * It writes JSON ground-truth into test/fixtures/, which the CI-safe specs then
 * validate against pure TS - so the reverse-engineered primitives are checked
 * without anyone needing the game.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The .ts extension is required because this file is executed directly by Node
// (`--experimental-strip-types`), which does no extension resolution; the specs,
// run through Vite, import extensionless. allowImportingTsExtensions permits both.
import { oracleAvailable, type Position, sampleExpression } from "./oracle.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** A modest scattered grid: fractional coords, negatives, and far-from-origin points. */
function gridPositions(): Position[] {
  const out: Position[] = [];
  for (let gy = 0; gy < 6; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      out.push({ x: gx * 13 - 30 + 0.5, y: gy * 17 - 40 + 0.25 });
    }
  }
  out.push({ x: 1000.5, y: -2000.5 }, { x: 12345.75, y: 6789.125 });
  return out;
}

async function captureBasis(): Promise<void> {
  const seed = 123456;
  const inputScale = 0.125;
  const seed1 = 0;
  const positions = gridPositions();
  const expression = `basis_noise{x = x, y = y, seed0 = map_seed, seed1 = ${seed1}, input_scale = ${inputScale}, output_scale = 1}`;

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const values = await sampleExpression(expression, positions, { workDir, seed });
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. basis_noise routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts",
      expression,
      seed0: seed,
      seed1,
      inputScale,
      points: positions.map((p, i) => ({ x: p.x, y: p.y, v: values[i] })),
    };
    const out = join(FIXTURES, "oracle-basis.seed123456.json");
    await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`wrote ${out} (${positions.length} points)`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (!oracleAvailable()) {
  console.error("No Factorio binary found (set FACTORIO_BIN). Cannot capture fixtures.");
  process.exit(1);
}
await captureBasis();

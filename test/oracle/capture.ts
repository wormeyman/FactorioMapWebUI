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

/** multioctave_noise ground truth across octaves / persistence / scales / seeds. */
async function captureMultioctave(): Promise<void> {
  const seed = 123456;
  const positions = gridPositions();
  // Vary every lever, including non-power-of-2 persistence (exercises the
  // fastapprox log2/exp2 in the RMS normalization) and multiple seed1s.
  const configs = [
    { octaves: 1, persistence: 0.5, inputScale: 0.125, outputScale: 1, seed1: 137 },
    { octaves: 2, persistence: 0.5, inputScale: 0.125, outputScale: 1, seed1: 137 },
    { octaves: 3, persistence: 0.5, inputScale: 0.125, outputScale: 2, seed1: 137 },
    { octaves: 4, persistence: 0.9, inputScale: 0.15, outputScale: 1, seed1: 137 },
    { octaves: 5, persistence: 0.7, inputScale: 0.08, outputScale: 3, seed1: 42 },
    { octaves: 6, persistence: 0.65, inputScale: 0.2, outputScale: 1, seed1: 5 },
    { octaves: 4, persistence: 0.45, inputScale: 0.05, outputScale: 1, seed1: 999 },
  ];
  const cases = [];
  for (const c of configs) {
    const expression = `multioctave_noise{x = x, y = y, seed0 = map_seed, seed1 = ${c.seed1}, octaves = ${c.octaves}, persistence = ${c.persistence}, input_scale = ${c.inputScale}, output_scale = ${c.outputScale}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression(expression, positions, { workDir, seed });
      cases.push({ ...c, values });
      console.log(`  captured octaves=${c.octaves} p=${c.persistence} seed1=${c.seed1}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. multioctave_noise routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts",
    seed0: seed,
    positions,
    cases,
  };
  const out = join(FIXTURES, "oracle-multioctave.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${configs.length} configs x ${positions.length} points)`);
}

/** quick_multioctave_noise ground truth across octaves / multipliers / offset / seeds. */
async function captureQuickMultioctave(): Promise<void> {
  const seed = 123456;
  const positions = gridPositions();
  // Vary octaves, the two per-octave multipliers, offset_x (including the large
  // climate-tree values that exercise the f32 floor), input/output scale and seed1.
  const configs = [
    // octaves=1 pins the base case; offset_x=0 isolates the raw octave.
    { octaves: 1, inputScale: 0.125, outputScale: 1, oosm: 0.6, oism: 0.5, offsetX: 0, seed1: 137 },
    // octave pairing (2*floor(k/2) reseed) first shows up at 3 octaves.
    { octaves: 3, inputScale: 0.125, outputScale: 1, oosm: 0.6, oism: 0.5, offsetX: 0, seed1: 137 },
    // large offset_x (climate-tree scale) -> f32 floor.
    {
      octaves: 4,
      inputScale: 1 / 6,
      outputScale: 2 / 3,
      oosm: 0.7,
      oism: 0.5,
      offsetX: 40000,
      seed1: 42,
    },
    {
      octaves: 5,
      inputScale: 0.1,
      outputScale: 1,
      oosm: 0.65,
      oism: 0.55,
      offsetX: 12000,
      seed1: 5,
    },
    {
      octaves: 6,
      inputScale: 0.08,
      outputScale: 1.5,
      oosm: 0.5,
      oism: 0.5,
      offsetX: 0,
      seed1: 999,
    },
  ];
  const cases = [];
  for (const c of configs) {
    const expression = `quick_multioctave_noise{x = x, y = y, seed0 = map_seed, seed1 = ${c.seed1}, input_scale = ${c.inputScale}, output_scale = ${c.outputScale}, octaves = ${c.octaves}, octave_output_scale_multiplier = ${c.oosm}, octave_input_scale_multiplier = ${c.oism}, offset_x = ${c.offsetX}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression(expression, positions, { workDir, seed });
      cases.push({ ...c, values });
      console.log(
        `  captured octaves=${c.octaves} oism=${c.oism} oosm=${c.oosm} offset=${c.offsetX}`,
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. quick_multioctave_noise routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts",
    seed0: seed,
    positions,
    cases,
  };
  const out = join(FIXTURES, "oracle-quick-multioctave.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${configs.length} configs x ${positions.length} points)`);
}

/**
 * variable_persistence_multioctave_noise ground truth. This op's `persistence` is a
 * spatially-varying noise EXPRESSION (not a scalar), so the fixture also captures
 * the persistence field itself (route the same expression onto elevation) - the
 * CI-safe spec feeds per-tile p back into the model. A constant persistence would
 * hit a degenerate compile path, so the expression must genuinely vary.
 */
async function captureVariablePersistenceMultioctave(): Promise<void> {
  const seed = 123456;
  const positions = gridPositions();
  // A gentle spatially-varying persistence in (0.1, 0.6). seed1=91 keeps it
  // distinct from the op's own seed1s.
  const persistenceExpr =
    "0.35 + 0.25 * basis_noise{x = x, y = y, seed0 = map_seed, seed1 = 91, input_scale = 0.02, output_scale = 1}";

  // Capture the persistence field once.
  let persistenceField: number[];
  {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      persistenceField = await sampleExpression(persistenceExpr, positions, { workDir, seed });
      console.log("  captured persistence field");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // Vary octaves, input/output scale, offset_x (incl. a large climate-scale value
  // that exercises the f32 floor), and seed1 (incl. >= 256 to confirm the shared
  // seed - no per-octave reseed like the quick op).
  const configs = [
    { octaves: 1, inputScale: 1 / 16, outputScale: 1, offsetX: 0, seed1: 7 },
    { octaves: 2, inputScale: 1 / 16, outputScale: 1, offsetX: 0, seed1: 7 },
    { octaves: 3, inputScale: 1 / 8, outputScale: 2, offsetX: 0, seed1: 7 },
    { octaves: 4, inputScale: 1 / 32, outputScale: 1, offsetX: 5000, seed1: 42 },
    { octaves: 5, inputScale: 0.1, outputScale: 1.5, offsetX: 40000, seed1: 5 },
    { octaves: 6, inputScale: 0.08, outputScale: 1, offsetX: 0, seed1: 999 },
    { octaves: 3, inputScale: 1 / 16, outputScale: 1, offsetX: -3, seed1: 256 },
  ];
  const cases = [];
  for (const c of configs) {
    const expression = `variable_persistence_multioctave_noise{x = x, y = y, seed0 = map_seed, seed1 = ${c.seed1}, input_scale = ${c.inputScale}, output_scale = ${c.outputScale}, offset_x = ${c.offsetX}, octaves = ${c.octaves}, persistence = ${persistenceExpr}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression(expression, positions, { workDir, seed });
      cases.push({ ...c, values });
      console.log(`  captured octaves=${c.octaves} offset_x=${c.offsetX} seed1=${c.seed1}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. variable_persistence_multioctave_noise routed onto elevation. persistenceField is the per-tile value of persistenceExpr (also routed onto elevation), fed back into the model by the spec. Regenerate: node --experimental-strip-types test/oracle/capture.ts",
    seed0: seed,
    positions,
    persistenceExpr,
    persistenceField,
    cases,
  };
  const out = join(FIXTURES, "oracle-variable-persistence-multioctave.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${configs.length} configs x ${positions.length} points)`);
}

/**
 * The two multioctave Lua wrappers (`core/prototypes/noise-functions.lua`):
 * `quick_multioctave_noise_persistence` (over the quick op) and
 * `amplitude_corrected_multioctave_noise` (over the variable-persistence op). Both
 * are pure parameter re-mappings - no new RE - captured here as ground truth for
 * the CI-safe port tests. One fixture, two blocks of configs.
 */
async function captureMultioctaveWrappers(): Promise<void> {
  const seed = 123456;
  const positions = gridPositions();

  const quickCfgs = [
    { octaves: 1, inputScale: 1 / 8, outputScale: 1, oism: 0.5, persistence: 0.7, seed1: 14 },
    { octaves: 4, inputScale: 1 / 8, outputScale: 0.8, oism: 0.5, persistence: 0.68, seed1: 14 },
    { octaves: 5, inputScale: 1 / 8, outputScale: 1, oism: 0.5, persistence: 0.75, seed1: 14 },
    { octaves: 3, inputScale: 0.2, outputScale: 2, oism: 0.6, persistence: 0.5, seed1: 42 },
  ];
  const quick = [];
  for (const c of quickCfgs) {
    const expression = `quick_multioctave_noise_persistence{x = x, y = y, seed0 = map_seed, seed1 = ${c.seed1}, input_scale = ${c.inputScale}, output_scale = ${c.outputScale}, octaves = ${c.octaves}, octave_input_scale_multiplier = ${c.oism}, persistence = ${c.persistence}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      quick.push({
        ...c,
        values: await sampleExpression(expression, positions, { workDir, seed }),
      });
      console.log(`  quick_persistence octaves=${c.octaves} seed1=${c.seed1}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  const acCfgs = [
    { octaves: 2, inputScale: 1 / 8, offsetX: 1000, persistence: 0.7, amplitude: 0.5, seed1: 1 },
    { octaves: 4, inputScale: 1 / 8, offsetX: 1000, persistence: 0.7, amplitude: 0.5, seed1: 1 },
    { octaves: 6, inputScale: 1 / 16, offsetX: 0, persistence: 0.6, amplitude: 1, seed1: 3 },
    { octaves: 3, inputScale: 0.1, offsetX: 5000, persistence: 0.85, amplitude: 2, seed1: 42 },
  ];
  const amplitudeCorrected = [];
  for (const c of acCfgs) {
    const expression = `amplitude_corrected_multioctave_noise{x = x, y = y, seed0 = map_seed, seed1 = ${c.seed1}, octaves = ${c.octaves}, input_scale = ${c.inputScale}, offset_x = ${c.offsetX}, persistence = ${c.persistence}, amplitude = ${c.amplitude}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      amplitudeCorrected.push({
        ...c,
        values: await sampleExpression(expression, positions, { workDir, seed }),
      });
      console.log(`  amplitude_corrected octaves=${c.octaves} seed1=${c.seed1}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. The two multioctave Lua wrappers routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts multioctave-wrappers",
    seed0: seed,
    positions,
    quick,
    amplitudeCorrected,
  };
  const out = join(FIXTURES, "oracle-multioctave-wrappers.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

/**
 * The full `elevation_lakes` tree - the first NAMED TREE sampled through the
 * harness. Also captures the two free-var distances (`distance` over
 * starting_positions, and starting_lake_distance capped at 1024) so the CI spec
 * can both drive the EvalCtx assumption and validate distanceFromNearestPoint
 * end-to-end. The grid spans a near-origin band AND far (>1200 tile) points so
 * both `distance` regimes (hypot-driven near spawn, branch2-collapsed far out)
 * are exercised.
 */
async function captureElevationLakes(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  // Near-origin band: the game places real starting lakes here (starting_lake_distance
  // < 1024), so the far-from-spawn empty-lake ctx does NOT reproduce these. Kept to
  // document the fidelity limit and to confirm distance == hypot near spawn; the CI
  // parity test filters these OUT (it asserts only where sld == 1024).
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 11 - 11 + 0.5, y: gy * 13 - 13 + 0.25 });
    }
  }
  // Far rings: large enough radius that starting_lake_distance saturates at 1024
  // (empty-lake ctx is then exact), in many directions. Two radii + fractional
  // offsets keep points off the lattice. These are the parity-tested points.
  for (const r of [2200, 3300]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
    }
  }
  // One deep-field point (stresses the f32 coordinate floor hardest).
  positions.push({ x: 12345.75, y: 6789.125 });

  const sample = async (expression: string): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  const elevation = await sample("elevation_lakes");
  console.log("  captured elevation_lakes tree");
  const distance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_positions}",
  );
  console.log("  captured distance (starting_positions)");
  const startingLakeDistance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_lake_positions, maximum_distance = 1024}",
  );
  console.log("  captured starting_lake_distance");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_lakes (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-lakes",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-lakes.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}

/**
 * The full `elevation_nauvis` tree (the default Nauvis elevation) routed onto
 * `elevation`, plus the two free-var distances the CI spec needs. Same grid as
 * captureElevationLakes: a near-origin band (where the game places real starting
 * lakes, so starting_lake_distance < 1024) and far rings (>1200 tiles, where it
 * saturates at 1024 and the empty-lake ctx is exact), plus one deep-field point.
 */
async function captureElevationNauvis(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 11 - 11 + 0.5, y: gy * 13 - 13 + 0.25 });
    }
  }
  for (const r of [2200, 3300]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
    }
  }
  positions.push({ x: 12345.75, y: 6789.125 });

  const sample = async (expression: string): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  const elevation = await sample("elevation_nauvis");
  console.log("  captured elevation_nauvis tree");
  const distance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_positions}",
  );
  console.log("  captured distance (starting_positions)");
  const startingLakeDistance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_lake_positions, maximum_distance = 1024}",
  );
  console.log("  captured starting_lake_distance");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_nauvis (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-nauvis",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-nauvis.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}

/**
 * The full `elevation_island` tree routed onto `elevation`, plus the two free-var
 * distances. Same grid as captureElevationLakes/Nauvis (near-origin band, far rings
 * at r=2200/3300, one deep-field point). elevation_island = elevation_lakes with
 * bias=-1000 and segmentation_multiplier/4.
 */
async function captureElevationIsland(): Promise<void> {
  const seed = 123456;
  const positions: Position[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      positions.push({ x: gx * 11 - 11 + 0.5, y: gy * 13 - 13 + 0.25 });
    }
  }
  for (const r of [2200, 3300]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      positions.push({ x: r * Math.cos(a) + 0.5, y: r * Math.sin(a) + 0.25 });
    }
  }
  positions.push({ x: 12345.75, y: 6789.125 });

  const sample = async (expression: string): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  const elevation = await sample("elevation_island");
  console.log("  captured elevation_island tree");
  const distance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_positions}",
  );
  console.log("  captured distance (starting_positions)");
  const startingLakeDistance = await sample(
    "distance_from_nearest_point{x = x, y = y, points = starting_lake_positions, maximum_distance = 1024}",
  );
  console.log("  captured starting_lake_distance");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. elevation_island (and the two free-var distances) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts elevation-island",
    seed0: seed,
    positions,
    elevation,
    distance,
    startingLakeDistance,
  };
  const out = join(FIXTURES, "oracle-elevation-island.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${positions.length} points)`);
}

if (!oracleAvailable()) {
  console.error("No Factorio binary found (set FACTORIO_BIN). Cannot capture fixtures.");
  process.exit(1);
}

// Optional CLI filter: names on argv restrict which fixtures regenerate (so a new
// capture need not re-run the others). No args = capture everything.
const only = process.argv.slice(2);
const want = (name: string) => only.length === 0 || only.includes(name);

if (want("basis")) await captureBasis();
if (want("multioctave")) await captureMultioctave();
if (want("quick")) await captureQuickMultioctave();
if (want("variable-persistence")) await captureVariablePersistenceMultioctave();
if (want("multioctave-wrappers")) await captureMultioctaveWrappers();
if (want("elevation-lakes")) await captureElevationLakes();
if (want("elevation-nauvis")) await captureElevationNauvis();
if (want("elevation-island")) await captureElevationIsland();

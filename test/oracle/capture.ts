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
import {
  oracleAvailable,
  type Position,
  sampleExpression,
  sampleTileNames,
  type TileSample,
} from "./oracle.ts";

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

/**
 * The `temperature` (= `temperature_basic`) climate expression: `clamp(15 + bias +
 * quick_multioctave_noise{...}, -20, 50)`. Routed onto elevation, exactly like
 * `captureElevationLakes` routes `elevation_lakes` - `calculate_tile_properties`
 * just needs SOME property name to key the dump under; the sampled values are
 * whatever `temperature` itself computes. Same standard grid as
 * `captureElevationLakes` (near-origin band, far rings at r=2200/3300, one
 * deep-field point), even though `temperature` has no spawn-distance dependency,
 * for comparability across captures.
 */
async function captureTemperature(): Promise<void> {
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

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const temperature = await sampleExpression("temperature", positions, { workDir, seed });
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. temperature (= temperature_basic) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts temperature",
      seed0: seed,
      positions,
      temperature,
    };
    const out = join(FIXTURES, "oracle-temperature.seed123456.json");
    await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`wrote ${out} (${positions.length} points)`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * The `aux` (= `aux_nauvis`, "terrain type") climate expression: `clamp(0.5 + bias
 * + 0.06*(nauvis_plateaus - 0.4) + quick_multioctave_noise{...}, 0, 1)`. Routed
 * onto elevation, same standard grid as `captureTemperature` (near-origin band,
 * far rings at r=2200/3300, one deep-field point) for comparability across
 * captures. `nauvis_plateaus` is a Nauvis-shared sub-tree (also used by
 * `elevation_nauvis`), so this exercises the shared module at defaults
 * (`control:water:frequency` = 1).
 */
async function captureAux(): Promise<void> {
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

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const aux = await sampleExpression("aux", positions, { workDir, seed });
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. aux (= aux_nauvis) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts aux",
      seed0: seed,
      positions,
      aux,
    };
    const out = join(FIXTURES, "oracle-aux.seed123456.json");
    await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`wrote ${out} (${positions.length} points)`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * The `moisture` (= `moisture_nauvis`) climate expression - the most complex
 * climate tree (a base quick_multioctave_noise term, a starting-area bias
 * blend keyed on `distance_from_nearest_point{points = starting_positions}`,
 * and a forest-path/hills/bridge-billows cutout, all from the shared Nauvis
 * sub-tree). Routed onto elevation, same standard grid as `captureAux`
 * (near-origin band, far rings at r=2200/3300, one deep-field point) for
 * comparability across captures. At the default preset every starting-area
 * lever is at its degenerate value (`slider_to_linear(1, ...) = 0`), so this
 * captures the whole closure at defaults - the starting-area levers
 * themselves are not exercised by this fixture (no UI surfaces them yet).
 */
async function captureMoisture(): Promise<void> {
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

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const moisture = await sampleExpression("moisture", positions, { workDir, seed });
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. moisture (= moisture_nauvis) routed onto elevation. Regenerate: node --experimental-strip-types test/oracle/capture.ts moisture",
      seed0: seed,
      positions,
      moisture,
    };
    const out = join(FIXTURES, "oracle-moisture.seed123456.json");
    await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
    console.log(`wrote ${out} (${positions.length} points)`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * The native `expression_in_range(peak_multiplier, peak_maximum, expr_1..N,
 * from_1..N, to_1..N)` builtin - the one genuine unknown of Milestone 2. Sample
 * three sweeps that recover the 1-D peak/falloff shape (both the bounded (20,1)
 * and the unbounded (5,inf) parametrizations) and the N-D combination rule.
 *
 * Arg order per the game docs: peak_multiplier, peak_maximum, ALL exprs, then ALL
 * range_froms, then ALL range_tos. So 2-D is
 * expression_in_range(pm, pmax, expr1, expr2, from1, from2, to1, to2).
 */
async function captureExpressionInRange(): Promise<void> {
  const seed = 123456;

  const sample = async (expression: string, positions: Position[]): Promise<number[]> => {
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      return await sampleExpression(expression, positions, { workDir, seed });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };

  // 1-D sweep: x from -1500..1500 step 25 (y fixed), expr = x/1000 in [-0.5, 0.5].
  // Well inside, exactly on, and well beyond both edges of the range.
  const oneDPositions: Position[] = [];
  for (let x = -1500; x <= 1500; x += 25) oneDPositions.push({ x, y: 0.25 });

  const oneD_20_1_expr = "expression_in_range(20, 1, (x/1000), -0.5, 0.5)";
  const oneD_20_1_values = await sample(oneD_20_1_expr, oneDPositions);
  console.log("  captured oneD_20_1");

  const oneD_5_inf_expr = "expression_in_range(5, inf, (x/1000), -0.5, 0.5)";
  const oneD_5_inf_values = await sample(oneD_5_inf_expr, oneDPositions);
  console.log("  captured oneD_5_inf");

  // 2-D sweep, (20, 1), both dims range [-0.5, 0.5]:
  //   expression_in_range(20, 1, x/1000, y/1000, -0.5, -0.5, 0.5, 0.5)
  // Two families that distinguish min vs product vs sum:
  //  (a) hold x/1000 = 0.2 (intermediate, in range) and sweep y across and beyond
  //      the range. At an in-range intermediate x, min(a,b), a*b and a+b all
  //      predict different curves as b leaves [1-partial..1].
  //  (b) a diagonal x=y sweep (both leave the range together).
  const twoD_expr = "expression_in_range(20, 1, (x/1000), (y/1000), -0.5, -0.5, 0.5, 0.5)";
  const twoDPositions: Position[] = [];
  for (let y = -1000; y <= 1000; y += 25) twoDPositions.push({ x: 200, y }); // (a) hold x=0.2
  for (let d = -1000; d <= 1000; d += 25) twoDPositions.push({ x: d, y: d }); // (b) diagonal
  const twoD_values = await sample(twoD_expr, twoDPositions);
  console.log("  captured twoD");

  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. Native expression_in_range routed onto elevation. Arg order: peak_multiplier, peak_maximum, all exprs, all froms, all tos. Regenerate: node --experimental-strip-types test/oracle/capture.ts expression-in-range",
    seed0: seed,
    sweeps: {
      oneD_20_1: {
        expression: oneD_20_1_expr,
        peakMultiplier: 20,
        peakMaximum: 1,
        from: -0.5,
        to: 0.5,
        positions: oneDPositions,
        values: oneD_20_1_values,
      },
      oneD_5_inf: {
        expression: oneD_5_inf_expr,
        peakMultiplier: 5,
        peakMaximum: "inf",
        from: -0.5,
        to: 0.5,
        positions: oneDPositions,
        values: oneD_5_inf_values,
      },
      twoD: {
        expression: twoD_expr,
        peakMultiplier: 20,
        peakMaximum: 1,
        froms: [-0.5, -0.5],
        tos: [0.5, 0.5],
        positions: twoDPositions,
        values: twoD_values,
      },
    },
  };
  const out = join(FIXTURES, "oracle-expression-in-range.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

/**
 * Scattered points spread over a WIDE spatial extent, meant to cross many
 * biomes. Tile selection is driven by `aux` and `moisture`, whose
 * `input_scale` (`control:aux:frequency/2048`, `control:moisture:frequency/256`)
 * makes both vary very slowly over space - near the origin the whole area is
 * one or two biomes, so reaching sand (high aux) / red-desert / the fuller
 * dirt range needs points spread over THOUSANDS of tiles.
 *
 * Uses a golden-angle spiral (radius growing linearly from `minR` to `maxR`,
 * angle advancing by the golden angle each step) so `count` points cover both
 * many radii and many directions with no clustering, rather than a grid that
 * would repeat the same few directions. `angleOffset` decorrelates the spiral
 * between seeds so the same relative sample layout doesn't line up with the
 * same terrain features seed to seed.
 */
function scatterPositions(
  count: number,
  minR: number,
  maxR: number,
  angleOffset: number,
): Position[] {
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
  const out: Position[] = [{ x: 0.5, y: 0.25 }]; // one near-origin anchor point
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const r = minR + t * (maxR - minR);
    const angle = angleOffset + i * GOLDEN_ANGLE;
    out.push({ x: r * Math.cos(angle) + 0.5, y: r * Math.sin(angle) + 0.25 });
  }
  return out;
}

/**
 * The `get_tile` tile-name oracle: generates real chunks (a small per-point
 * radius, NOT one giant origin-centered disc - see `buildTileControlLua`) for
 * the DEFAULT preset (no property routing) and dumps
 * `surface.get_tile(x, y).name` at each scattered position, so a later task
 * can check tile-selection argmax exactly (rather than just the noise values
 * `calculate_tile_properties` reports). Widened per the Task 2 review finding:
 * the original 220-tile-radius grid was 86% grass-2/red-desert-0 with zero
 * sand/deepwater - not a meaningful ground truth for resolver validation.
 * Captures three seeds (a single seed's local terrain is biome-poor by luck)
 * spread out to ~4000 tiles, each written to its own fixture file.
 */
async function captureTileNamesForSeed(seed: number, angleOffset: number): Promise<void> {
  const positions = scatterPositions(50, 100, 4000, angleOffset);

  const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
  try {
    const samples: TileSample[] = await sampleTileNames(positions, { workDir, seed, radius: 1 });
    const fixture = {
      _comment:
        "Ground truth from Factorio 2.1.11 via the test/oracle harness. DEFAULT preset (no property_expression_names routing) - surface.get_tile(x, y).name at each position after real chunk generation. positions are the mod's ECHOED floored get_tile input (not the pre-floor request), so a fractional capture can't silently mismatch. Regenerate: node --experimental-strip-types test/oracle/capture.ts tile-names",
      seed0: seed,
      positions: samples.map((s) => ({ x: s.x, y: s.y })),
      tileNames: samples.map((s) => s.name),
    };
    const out = join(FIXTURES, `oracle-tile-names.seed${seed}.json`);
    await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
    const distinct = new Set(fixture.tileNames).size;
    console.log(
      `wrote ${out} (${positions.length} points, ${distinct} distinct tiles: ${[...new Set(fixture.tileNames)].sort().join(", ")})`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function captureTileNames(): Promise<void> {
  await captureTileNamesForSeed(123456, 0);
  await captureTileNamesForSeed(654321, 1.3);
  await captureTileNamesForSeed(424242, 2.6);
}

/**
 * random_penalty ground truth. It is a BATCH op (seeded from the first position,
 * streamed last->first, source<=0 skips a draw), so each config is ONE batch and
 * the fixture stores the exact ordered position list + the game's output. Sources
 * are simple functions of (x,y) so the spec can recompute source[i] and validate
 * randomPenaltyBatch. Includes odd seeds (even-only masked the quickMultioctave
 * bug last session) and a source=x config to exercise the source<=0 guard.
 */
async function captureRandomPenalty(): Promise<void> {
  const seed = 123456; // map_seed; random_penalty is map_seed-independent, but pin it.
  // A scattered ordered batch: fractional, negatives (x<=0 for the guard), far points.
  const positions: Position[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -3, y: 2 },
    { x: 5.5, y: 7.25 },
    { x: -10, y: -10 },
    { x: 40, y: 13 },
    { x: 0, y: -1 },
    { x: 1000, y: -2000 },
  ];
  // sourceKind: how the spec reconstructs source[i] from the position.
  const configs = [
    { rpSeed: 1, amplitude: 1, sourceExpr: "1", sourceKind: "const1" },
    { rpSeed: 1, amplitude: 2, sourceExpr: "1", sourceKind: "const1" },
    { rpSeed: 7, amplitude: 1, sourceExpr: "1", sourceKind: "const1" }, // odd seed
    { rpSeed: 13, amplitude: 0.5, sourceExpr: "1", sourceKind: "const1" }, // odd seed
    { rpSeed: 1, amplitude: 1, sourceExpr: "x", sourceKind: "x" }, // source<=0 guard
  ];
  const cases = [];
  for (const c of configs) {
    const expression = `random_penalty{x = x, y = y, seed = ${c.rpSeed}, source = ${c.sourceExpr}, amplitude = ${c.amplitude}}`;
    const workDir = await mkdtemp(join(tmpdir(), "oracle-capture-"));
    try {
      const values = await sampleExpression(expression, positions, { workDir, seed });
      cases.push({ ...c, values });
      console.log(`  captured rpSeed=${c.rpSeed} amp=${c.amplitude} source=${c.sourceExpr}`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const fixture = {
    _comment:
      "Ground truth from Factorio 2.1.11 via the test/oracle harness. random_penalty routed onto elevation. BATCH op: seeded from positions[0], streamed last->first, source<=0 passes through with no draw. Regenerate: node --experimental-strip-types test/oracle/capture.ts random-penalty",
    seed0: seed,
    positions,
    cases,
  };
  const out = join(FIXTURES, "oracle-random-penalty.seed123456.json");
  await writeFile(out, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${out} (${configs.length} configs x ${positions.length} points)`);
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
if (want("temperature")) await captureTemperature();
if (want("aux")) await captureAux();
if (want("moisture")) await captureMoisture();
if (want("expression-in-range")) await captureExpressionInRange();
if (want("random-penalty")) await captureRandomPenalty();
if (want("tile-names")) await captureTileNames();

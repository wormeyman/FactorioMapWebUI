import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

export class RenderError extends Error {
  constructor(message, stderrTail) {
    super(message);
    this.name = "RenderError";
    this.stderrTail = stderrTail ?? "";
  }
}

export function buildPreviewArgs({ outPath, mgsPath, planet, seed, size }) {
  return [
    "--generate-map-preview",
    outPath,
    "--map-gen-settings",
    mgsPath,
    "--map-preview-planet",
    planet,
    "--map-gen-seed",
    String(seed),
    "--map-preview-size",
    String(size),
  ];
}

// Default spawn wrapper: runs the binary, resolves { code, stderr }.
export function nodeSpawn(bin, args) {
  return {
    async done() {
      const { spawn } = await import("node:child_process");
      return await new Promise((resolve) => {
        const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
        child.on("error", (e) => resolve({ code: -1, stderr: String(e) }));
      });
    },
  };
}

export async function renderPreview(req, { spawnFn = nodeSpawn, tmpDir, factorioBin }) {
  const work = await mkdtemp(join(tmpDir, "render-"));
  const mgsPath = join(work, "mgs.json");
  const outPath = join(work, "preview.png");
  try {
    await writeFile(mgsPath, JSON.stringify(req.mapGenSettings));
    const args = buildPreviewArgs({
      outPath,
      mgsPath,
      planet: req.planet,
      seed: req.seed,
      size: req.size,
    });
    const { code, stderr } = await spawnFn(factorioBin, args).done();
    if (code !== 0) {
      throw new RenderError(`factorio exited ${code}`, stderr.slice(-2000));
    }
    return await readFile(outPath);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

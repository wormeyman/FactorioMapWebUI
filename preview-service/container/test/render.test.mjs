import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreviewArgs, renderPreview, RenderError } from "../render.mjs";

test("buildPreviewArgs assembles the factorio CLI", () => {
  const args = buildPreviewArgs({
    outPath: "/out/p.png",
    mgsPath: "/in/mgs.json",
    planet: "vulcanus",
    seed: 123456,
    size: 1024,
  });
  assert.deepEqual(args, [
    "--generate-map-preview", "/out/p.png",
    "--map-gen-settings", "/in/mgs.json",
    "--map-preview-planet", "vulcanus",
    "--map-gen-seed", "123456",
    "--map-preview-size", "1024",
  ]);
});

test("renderPreview writes a unique mgs file and returns PNG bytes", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "prev-"));
  const fakeSpawn = (bin, args) => {
    // find the --generate-map-preview output path and write a fake PNG there
    const outPath = args[args.indexOf("--generate-map-preview") + 1];
    return {
      async done() {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return { code: 0, stderr: "" };
      },
    };
  };
  const png = await renderPreview(
    { mapGenSettings: { width: 0 }, planet: "nauvis", seed: 42, size: 1024 },
    { spawnFn: fakeSpawn, tmpDir: tmp, factorioBin: "/opt/factorio/bin/x64/factorio" },
  );
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
});

test("renderPreview throws RenderError with stderr tail on nonzero exit", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "prev-"));
  const fakeSpawn = () => ({
    async done() {
      return { code: 1, stderr: "Error: bad settings\n" };
    },
  });
  await assert.rejects(
    () => renderPreview(
      { mapGenSettings: {}, planet: "nauvis", seed: 1, size: 1024 },
      { spawnFn: fakeSpawn, tmpDir: tmp, factorioBin: "/x" },
    ),
    (err) => err instanceof RenderError && /bad settings/.test(err.stderrTail),
  );
});

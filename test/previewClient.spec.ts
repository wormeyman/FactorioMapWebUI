import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { buildPreviewRequest, postPreview } from "../src/io/previewClient";
import { getBuiltinPreset } from "../src/model/builtins";

afterEach(() => vi.restoreAllMocks());

describe("buildPreviewRequest", () => {
  it("injects a concrete seed into mapGenSettings when the preset seed is null", () => {
    const preset = getBuiltinPreset("Default");
    preset.seed = null;
    const req = buildPreviewRequest(preset, "vulcanus");
    expect(req.planet).toBe("vulcanus");
    expect(req.size).toBe(1024);
    expect(Number.isInteger(req.seed)).toBe(true);
    expect(req.seed).toBeGreaterThanOrEqual(0);
    expect((req.mapGenSettings as { seed: number }).seed).toBe(req.seed);
  });

  it("uses the preset seed when set", () => {
    const preset = getBuiltinPreset("Default");
    preset.seed = 999;
    expect(buildPreviewRequest(preset, "nauvis").seed).toBe(999);
  });
});

describe("postPreview", () => {
  it("returns a Blob on 200", async () => {
    const blob = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    const preset = getBuiltinPreset("Default");
    const out = await postPreview(buildPreviewRequest(preset, "nauvis"));
    expect(out).toBeInstanceOf(Blob);
  });

  it("throws PreviewError with status on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const preset = getBuiltinPreset("Default");
    await expect(postPreview(buildPreviewRequest(preset, "nauvis"))).rejects.toMatchObject({
      name: "PreviewError",
      status: 503,
    });
  });
});

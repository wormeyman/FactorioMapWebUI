import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { buildPreviewRequest, postPreview } from "../src/io/previewClient";
import { getBuiltinPreset } from "../src/model/builtins";

afterEach(() => vi.restoreAllMocks());

describe("buildPreviewRequest", () => {
  it("reconciles the given seed into the request and mgs body", () => {
    const preset = getBuiltinPreset("Default");
    const req = buildPreviewRequest(preset, "vulcanus", 123456);
    expect(req.planet).toBe("vulcanus");
    expect(req.size).toBe(1024);
    expect(req.seed).toBe(123456);
    expect((req.mapGenSettings as { seed: number }).seed).toBe(123456);
  });

  it("uses the passed seed regardless of the preset's own seed", () => {
    const preset = getBuiltinPreset("Default");
    preset.seed = 999;
    expect(buildPreviewRequest(preset, "nauvis", 7).seed).toBe(7);
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
    const out = await postPreview(buildPreviewRequest(preset, "nauvis", 1));
    expect(out).toBeInstanceOf(Blob);
  });

  it("throws PreviewError with status on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    const preset = getBuiltinPreset("Default");
    await expect(postPreview(buildPreviewRequest(preset, "nauvis", 1))).rejects.toMatchObject({
      name: "PreviewError",
      status: 503,
    });
  });
});

import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ElevationPreviewPanel from "../src/components/ElevationPreviewPanel.vue";
import { usePresetsStore } from "../src/store/presets";
import { writeMapType } from "../src/model/mapType";
import type { ElevationRenderer } from "../src/components/useElevationPreview";

afterEach(() => vi.restoreAllMocks());

function stubCanvas() {
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  return putImageData;
}

function setup(mapTypeId: string, renderer: ElevationRenderer) {
  setActivePinia(createPinia());
  const store = usePresetsStore();
  store.createFromBuiltin("Default", "t");
  store.activePreset!.seed = 123456;
  writeMapType(store.activePreset!.propertyExpressionNames, mapTypeId);
  return mount(ElevationPreviewPanel, { props: { renderer } });
}

function okRenderer(): ElevationRenderer {
  return {
    render: vi.fn(async () => ({
      id: 1,
      buffer: new ArrayBuffer(1024 * 1024 * 4),
      width: 1024,
      height: 1024,
    })),
    dispose: vi.fn(),
  };
}

describe("ElevationPreviewPanel", () => {
  it("renders a Lakes preset to the canvas on Generate", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("lakes", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      seed0: 123456,
      mapType: "lakes",
      width: 1024,
      height: 1024,
      tilesPerPixel: 1,
      originX: -512,
      originY: -512,
    });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(w.find('[data-test="preview-seed"]').text()).toContain("123456");
  });

  it("renders a Nauvis preset to the canvas on Generate", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ seed0: 123456, mapType: "nauvis" });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("centers the view on world origin (0,0), not the preset spawn point", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    const store = usePresetsStore();
    store.activePreset!.startingPoints = [{ x: 300, y: -400 }];
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // window recentred on origin ...
    expect(arg).toMatchObject({
      originX: -512,
      originY: -512,
      width: 1024,
      height: 1024,
      tilesPerPixel: 1,
    });
    // ... but the tree still gets the real spawn for its distance-gated terms
    expect(arg.startingPositions).toEqual([{ x: 300, y: -400 }]);
  });

  it("shows a message and does not render for an unsupported map type", async () => {
    const renderer = okRenderer();
    const w = setup("elevation_modded_x", renderer);
    expect(w.find('[data-test="unsupported"]').text()).toContain("elevation_modded_x");
    expect(w.find('[data-test="generate"]').attributes("disabled")).toBeDefined();
    await w.find('[data-test="generate"]').trigger("click");
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it("shows an error when the render rejects", async () => {
    stubCanvas();
    const renderer: ElevationRenderer = {
      render: vi.fn(async () => {
        throw new Error("boom");
      }),
      dispose: vi.fn(),
    };
    const w = setup("lakes", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="preview-error"]').exists()).toBe(true);
  });
});

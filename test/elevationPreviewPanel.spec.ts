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

function setup(mapTypeId: "nauvis" | "lakes", renderer: ElevationRenderer) {
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
      buffer: new ArrayBuffer(512 * 512 * 4),
      width: 512,
      height: 512,
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
      width: 512,
      height: 512,
      tilesPerPixel: 4,
      originX: -1024,
      originY: -1024,
    });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(w.find('[data-test="preview-seed"]').text()).toContain("123456");
  });

  it("shows a message and does not render for an unsupported map type", async () => {
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="unsupported"]').text()).toContain("Nauvis elevation");
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

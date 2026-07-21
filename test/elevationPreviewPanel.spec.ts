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
      view: "elevation",
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

  it("passes view:'terrain' after selecting the Terrain toggle on a Nauvis preset", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-terrain"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-terrain"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "terrain", mapType: "nauvis" });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("passes view:'resources' + resourceControls after selecting the Resources toggle (Nauvis)", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-resources"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-resources"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "resources", mapType: "nauvis" });
    // Every catalog resource has a lever entry (defaults 1/1/1).
    expect(arg.resourceControls["iron-ore"]).toEqual({ frequency: 1, size: 1, richness: 1 });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("passes view:'enemies' + enemyControls after selecting the Enemies toggle (Nauvis)", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-enemies"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-enemies"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "enemies", mapType: "nauvis" });
    expect(arg.enemyControls).toEqual({ frequency: 1, size: 1 });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("passes view:'cliffs' + cliffControls/cliffSettings after selecting the Cliffs toggle (Nauvis)", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-cliffs"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-cliffs"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "cliffs", mapType: "nauvis" });
    expect(arg.cliffControls).toEqual({ frequency: 1, continuity: 1 });
    expect(arg.cliffSettings).toEqual({
      cliffElevation0: 10,
      cliffElevationInterval: 40,
      richness: 1,
    });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("disables the Cliffs toggle off-Nauvis (Lakes/Island)", async () => {
    expect(
      setup("lakes", okRenderer()).find('[data-test="view-cliffs"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      setup("island", okRenderer()).find('[data-test="view-cliffs"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("passes view:'all' + all overlay controls after selecting the All toggle (Nauvis)", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    expect(w.find('[data-test="view-all"]').attributes("disabled")).toBeUndefined();

    await w.find('[data-test="view-all"]').trigger("click");
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    expect(renderer.render).toHaveBeenCalledOnce();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "all", mapType: "nauvis" });
    // the composite view carries every overlay's controls
    expect(arg.resourceControls["iron-ore"]).toEqual({ frequency: 1, size: 1, richness: 1 });
    expect(arg.enemyControls).toEqual({ frequency: 1, size: 1 });
    expect(arg.cliffControls).toEqual({ frequency: 1, continuity: 1 });
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("disables the All toggle off-Nauvis (Lakes/Island)", async () => {
    expect(
      setup("lakes", okRenderer()).find('[data-test="view-all"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      setup("island", okRenderer()).find('[data-test="view-all"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("disables the Enemies toggle off-Nauvis (Lakes/Island)", async () => {
    expect(
      setup("lakes", okRenderer()).find('[data-test="view-enemies"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      setup("island", okRenderer()).find('[data-test="view-enemies"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("disables the Resources toggle off-Nauvis (Lakes/Island)", async () => {
    expect(
      setup("lakes", okRenderer()).find('[data-test="view-resources"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      setup("island", okRenderer()).find('[data-test="view-resources"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("disables the Terrain toggle for a Lakes preset (renderTerrain is Nauvis-only)", async () => {
    const renderer = okRenderer();
    const w = setup("lakes", renderer);
    expect(w.find('[data-test="view-terrain"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-test="view-elevation"]').attributes("disabled")).toBeUndefined();
  });

  it("disables the Terrain toggle for an Island preset", async () => {
    const renderer = okRenderer();
    const w = setup("island", renderer);
    expect(w.find('[data-test="view-terrain"]').attributes("disabled")).toBeDefined();
  });

  it("falls back to Elevation view when switching to a preset whose map type disables Terrain", async () => {
    const putImageData = stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    const store = usePresetsStore();

    await w.find('[data-test="view-terrain"]').trigger("click");
    writeMapType(store.activePreset!.propertyExpressionNames, "lakes");
    await w.vm.$nextTick();
    expect(w.find('[data-test="view-terrain"]').attributes("disabled")).toBeDefined();

    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "elevation", mapType: "lakes" });
    expect(putImageData).toHaveBeenCalledOnce();
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

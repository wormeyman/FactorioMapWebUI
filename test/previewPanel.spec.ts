import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PreviewPanel from "../src/components/PreviewPanel.vue";

afterEach(() => vi.restoreAllMocks());

function mountPanel() {
  setActivePinia(createPinia());
  return mount(PreviewPanel, { props: { planet: "nauvis" } });
}

describe("PreviewPanel", () => {
  it("renders the preview image after clicking Generate", async () => {
    const blob = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blob, { status: 200 })));
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });

    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    const img = wrapper.find('[data-test="preview-image"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("blob:x");
  });

  it("shows an error when the render fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="preview-error"]').exists()).toBe(true);
  });

  it("disables Generate while a render is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    expect(wrapper.find('[data-test="generate"]').attributes("disabled")).toBeDefined();
    resolve(new Response(new Blob(), { status: 200 }));
  });
});

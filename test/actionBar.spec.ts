import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ActionBar from "../src/components/ActionBar.vue";

function stubClipboard(impl: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  });
}

describe("ActionBar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an enabled Copy string button when a preset is active", () => {
    setActivePinia(createPinia());
    const wrapper = mount(ActionBar);
    const button = wrapper.find('[data-test="copy-string"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("shows success feedback after copying the exchange string", async () => {
    setActivePinia(createPinia());
    stubClipboard(() => Promise.resolve());
    const wrapper = mount(ActionBar);

    await wrapper.find('[data-test="copy-string"]').trigger("click");
    await flushPromises();

    const status = wrapper.find('[data-test="copy-status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toBe("Copied!");
    expect(status.attributes("role")).toBe("status");
  });

  it("shows failure feedback when the clipboard write rejects", async () => {
    setActivePinia(createPinia());
    stubClipboard(() => Promise.reject(new Error("denied")));
    const wrapper = mount(ActionBar);

    await wrapper.find('[data-test="copy-string"]').trigger("click");
    await flushPromises();

    const status = wrapper.find('[data-test="copy-status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toBe("Copy failed");
  });

  it("shows no status before any copy attempt", () => {
    setActivePinia(createPinia());
    const wrapper = mount(ActionBar);
    expect(wrapper.find('[data-test="copy-status"]').exists()).toBe(false);
  });
});

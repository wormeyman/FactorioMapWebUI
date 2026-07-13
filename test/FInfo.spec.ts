import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vite-plus/test";
import FInfo from "../src/ui/FInfo.vue";

describe("FInfo", () => {
  it("renders an info glyph", () => {
    const wrapper = mount(FInfo, { props: { text: "hello" } });
    const glyph = wrapper.find('[data-test="info"]');
    expect(glyph.exists()).toBe(true);
    expect(glyph.text()).toBe("ⓘ"); // ⓘ
  });

  it("exposes the text via the native title attribute", () => {
    const wrapper = mount(FInfo, { props: { text: "some helpful hint" } });
    const glyph = wrapper.find('[data-test="info"]');
    expect(glyph.attributes("title")).toBe("some helpful hint");
  });

  it("exposes the text via aria-label for accessibility", () => {
    const wrapper = mount(FInfo, { props: { text: "some helpful hint" } });
    const glyph = wrapper.find('[data-test="info"]');
    expect(glyph.attributes("aria-label")).toBe("some helpful hint");
  });
});

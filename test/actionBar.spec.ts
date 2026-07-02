import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vite-plus/test";
import ActionBar from "../src/components/ActionBar.vue";

describe("ActionBar", () => {
  it("renders an enabled Copy string button when a preset is active", () => {
    setActivePinia(createPinia());
    const wrapper = mount(ActionBar);
    const button = wrapper.find('[data-test="copy-string"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes("disabled")).toBeUndefined();
  });
});

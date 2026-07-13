import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vite-plus/test";
import EnemyValueRow from "../src/components/EnemyValueRow.vue";

function mountRow(props: Record<string, unknown>) {
  // A <tr> must live inside a table to mount cleanly.
  return mount({
    components: { EnemyValueRow },
    template: '<table><tbody><EnemyValueRow v-bind="p" /></tbody></table>',
    data: () => ({ p: props }),
  });
}

describe("EnemyValueRow", () => {
  it("renders the label and both inputs bound to the value", () => {
    const wrapper = mountRow({ label: "Time factor", modelValue: 0.5 });
    expect(wrapper.find(".label").text()).toBe("Time factor");
    const range = wrapper.find('input[type="range"]');
    const number = wrapper.find('input[type="number"]');
    expect((range.element as HTMLInputElement).value).toBe("0.5");
    expect((number.element as HTMLInputElement).value).toBe("0.5");
  });

  it("emits update:modelValue when the number box changes", async () => {
    const wrapper = mount(EnemyValueRow, {
      props: { label: "Time factor", modelValue: 0.5 },
    });
    // FNumberInput commits on the native `change` event; setValue only fires
    // `input`, so trigger `change` explicitly.
    const number = wrapper.find('input[type="number"]');
    await number.setValue("0.75");
    await number.trigger("change");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([0.75]);
  });

  it("disables both inputs when disabled is true", () => {
    const wrapper = mountRow({ label: "Time factor", modelValue: 0.5, disabled: true });
    expect((wrapper.find('input[type="range"]').element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).disabled).toBe(true);
  });
});

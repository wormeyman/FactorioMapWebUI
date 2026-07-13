<script setup lang="ts">
import FNumberInput from "../ui/FNumberInput.vue";
import FSlider from "../ui/FSlider.vue";

defineProps<{
  label: string;
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function set(value: number) {
  emit("update:modelValue", value);
}
</script>

<template>
  <tr class="enemy-value-row">
    <td class="label">{{ label }}</td>
    <td class="cell">
      <FSlider
        :model-value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        @update:model-value="set"
      />
    </td>
    <td class="cell">
      <FNumberInput :model-value="modelValue" :disabled="disabled" @update:model-value="set" />
    </td>
  </tr>
</template>

<style scoped>
.label {
  font-weight: 700;
  padding: 6px 8px;
}

.cell {
  padding: 6px 8px;
}
</style>

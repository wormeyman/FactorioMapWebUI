<script setup lang="ts">
withDefaults(defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>(), {
  min: 0,
  max: 6,
  step: 0.05,
});
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function onInput(event: Event) {
  emit("update:modelValue", Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <input
    class="f-slider"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    @input="onInput"
  />
</template>

<style scoped>
.f-slider {
  appearance: none;
  width: 100%;
  height: 6px;
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.f-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}
</style>

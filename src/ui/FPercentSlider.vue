<script setup lang="ts">
import { computed } from "vue";
import { PERCENT_STEPS, formatPercent, nearestStepIndex, stepValue } from "../model/controlScale";

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const index = computed(() => nearestStepIndex(props.modelValue));
const label = computed(() => formatPercent(props.modelValue));

function onInput(event: Event) {
  emit("update:modelValue", stepValue(Number((event.target as HTMLInputElement).value)));
}
</script>

<template>
  <span class="f-percent">
    <input
      class="f-percent-slider"
      type="range"
      min="0"
      :max="PERCENT_STEPS.length - 1"
      step="1"
      :value="index"
      :disabled="disabled"
      :aria-valuetext="label"
      aria-label="Percentage"
      @input="onInput"
    />
    <span class="f-percent-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.f-percent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.f-percent-slider {
  appearance: none;
  width: 90px;
  height: 6px;
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.f-percent-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-percent-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--f-orange);
  border: 1px solid #6b4a12;
}

.f-percent-label {
  min-width: 34px;
  font-size: 12px;
  color: var(--f-text);
}
</style>

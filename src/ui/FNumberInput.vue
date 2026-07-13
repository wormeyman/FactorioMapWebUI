<script setup lang="ts">
defineProps<{ modelValue: number; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function onChange(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const value = Number(raw);
  if (raw !== "" && Number.isFinite(value)) {
    emit("update:modelValue", value);
  }
}
</script>

<template>
  <input
    class="f-number"
    type="number"
    :value="modelValue"
    :disabled="disabled"
    @change="onChange"
  />
</template>

<style scoped>
.f-number {
  width: 56px;
  padding: 3px 6px;
  border: none;
  font: inherit;
  font-weight: 700;
  text-align: center;
  color: #1a1a1a;
  background: var(--f-value-box);
  box-shadow:
    inset 1px 1px 0 rgb(0 0 0 / 40%),
    inset -1px -1px 0 rgb(255 255 255 / 30%);
}
</style>

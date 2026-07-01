<script setup lang="ts">
defineProps<{ modelValue: string; tabs: string[] }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <div class="f-tabs">
    <button
      v-for="tab in tabs"
      :key="tab"
      class="f-tab"
      :class="{ active: tab === modelValue }"
      type="button"
      @click="emit('update:modelValue', tab)"
    >
      {{ tab }}
    </button>
  </div>
</template>

<style scoped>
.f-tabs {
  display: flex;
  gap: 4px;
}

.f-tab {
  padding: 6px 20px;
  border: none;
  font: inherit;
  font-weight: 700;
  color: var(--f-text);
  background: var(--f-panel-raised);
  cursor: pointer;
  box-shadow:
    inset 1px 1px 0 var(--f-edge-light),
    inset -1px -1px 0 var(--f-edge-dark);
}

.f-tab.active {
  background: var(--f-orange);
  color: #1a1a1a;
}
</style>

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
  /* Five tabs in a row are 507px wide, which was the single widest thing in the
     editor column and set the whole page's minimum layout width on a phone.
     Wrapping at every size (not behind a media query) - inert wherever they fit. */
  flex-wrap: wrap;
  gap: 4px;
}

.f-tab {
  /* The 20px side padding is what makes the row 507px; on a narrow viewport trade
     it for fitting more tabs per line. Vertical padding is untouched, so the tap
     target keeps its height. */
  padding: 6px clamp(8px, 4vw, 20px);
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

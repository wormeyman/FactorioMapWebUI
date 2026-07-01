<script setup lang="ts">
import { ref } from "vue";
import { PLANET_LABELS, PLANETS, type Planet } from "../model/planets";
import FButton from "../ui/FButton.vue";
import FCheckbox from "../ui/FCheckbox.vue";
import FDropdown from "../ui/FDropdown.vue";

defineProps<{ planet: Planet }>();
const emit = defineEmits<{ "update:planet": [value: Planet] }>();

const autoRefresh = ref(true);
const quality = ref("normal");
const qualityOptions = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];
const planetOptions = PLANETS.map((p) => ({ value: p, label: PLANET_LABELS[p] }));
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <FCheckbox v-model="autoRefresh" label="Auto-refresh" />
      <FDropdown
        data-test="planet-select"
        :model-value="planet"
        :options="planetOptions"
        @update:model-value="emit('update:planet', $event as Planet)"
      />
      <FDropdown v-model="quality" :options="qualityOptions" />
      <FButton variant="tool" disabled>Preview</FButton>
    </div>
    <div class="preview-placeholder f-bevel-in">
      <p>Map preview requires Factorio's noise engine and is planned for a later phase.</p>
      <p class="dim">Selected planet: {{ PLANET_LABELS[planet] }}</p>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-toolbar > :last-child {
  margin-left: auto;
}

.preview-placeholder {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--f-inset);
  text-align: center;
  padding: 16px;
}

.dim {
  color: var(--f-text-dim);
}
</style>

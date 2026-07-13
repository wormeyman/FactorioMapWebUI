<script setup lang="ts">
import { computed } from "vue";
import { type ControlColumn, controlsForCategory } from "../model/controlCatalog";
import { usePresetsStore } from "../store/presets";
import ControlTable from "./ControlTable.vue";
import FPercentSlider from "../ui/FPercentSlider.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
];
</script>

<template>
  <ControlTable :names="controlsForCategory('enemy')" :columns="COLUMNS" leadLabel="Setting" />
  <div v-if="preset" class="starting-area">
    <span class="sa-label">Starting area size</span>
    <FPercentSlider v-model="preset.startingArea" data-test="starting-area" />
  </div>
  <p class="note">
    Evolution and expansion settings live in the MapSettings payload region and unlock in Phase 1.
  </p>
</template>

<style scoped>
.starting-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
}

/* Keep the standalone slider a sensible width rather than filling the panel. */
.starting-area :deep(.f-percent) {
  max-width: 180px;
}

.sa-label {
  font-weight: 700;
}

.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>

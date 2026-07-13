<script setup lang="ts">
import { computed } from "vue";
import { type ControlColumn, controlsForCategory } from "../model/controlCatalog";
import { usePresetsStore } from "../store/presets";
import ControlTable from "./ControlTable.vue";
import EnemyValueRow from "./EnemyValueRow.vue";
import FCheckbox from "../ui/FCheckbox.vue";
import FPercentSlider from "../ui/FPercentSlider.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const evolution = computed(() => preset.value?.mapSettings.enemyEvolution);
const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
];
</script>

<template>
  <ControlTable :names="controlsForCategory('enemy')" :columns="COLUMNS" leadLabel="Setting" />
  <div v-if="preset" class="enemy-modes">
    <FCheckbox v-model="preset.noEnemiesMode" label="No enemies" data-test="no-enemies-mode" />
    <FCheckbox v-model="preset.peacefulMode" label="Peaceful mode" data-test="peaceful-mode" />
  </div>
  <div v-if="preset" class="starting-area">
    <span class="sa-label">Starting area size</span>
    <FPercentSlider v-model="preset.startingArea" data-test="starting-area" />
  </div>
  <section v-if="evolution" data-test="enemy-evolution" class="enemy-section">
    <FCheckbox v-model="evolution.enabled" label="Evolution" data-test="enemy-evolution-enable" />
    <table class="control-table">
      <tbody>
        <!-- Placeholder ranges; the number box is the source of truth. -->
        <EnemyValueRow
          data-test="enemy-evo-time"
          label="Time factor"
          v-model="evolution.timeFactor"
          :min="0"
          :max="0.01"
          :step="0.000001"
          :disabled="!evolution.enabled"
        />
        <EnemyValueRow
          data-test="enemy-evo-destroy"
          label="Destroy factor"
          v-model="evolution.destroyFactor"
          :min="0"
          :max="0.1"
          :step="0.0001"
          :disabled="!evolution.enabled"
        />
        <EnemyValueRow
          data-test="enemy-evo-pollution"
          label="Pollution factor"
          v-model="evolution.pollutionFactor"
          :min="0"
          :max="0.001"
          :step="0.0000001"
          :disabled="!evolution.enabled"
        />
      </tbody>
    </table>
  </section>
  <p class="note">
    Expansion settings live in the MapSettings payload region and unlock in Phase 1.
  </p>
</template>

<style scoped>
.enemy-modes {
  display: flex;
  gap: 16px;
  padding: 8px;
}

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

.enemy-section {
  padding: 8px;
}

.control-table {
  width: 100%;
  border-collapse: collapse;
}
</style>

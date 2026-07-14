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
const expansion = computed(() => preset.value?.mapSettings.enemyExpansion);
const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
];

// Min/max expansion distance are linked: the maximum must always stay greater
// than the minimum. Editing one drags the other so max > min holds, both
// clamped to [1, 20]. Clamping happens only on set, so an untouched import
// keeps its raw stored value (byte-exact) until the user actually edits.
const DIST_MIN = 1;
const DIST_MAX = 20;
const minExpansionDistance = computed({
  get: () => expansion.value?.minExpansionDistance ?? DIST_MIN,
  set: (v: number) => {
    const e = expansion.value;
    if (!e) return;
    const m = Math.min(Math.max(Math.round(v), DIST_MIN), DIST_MAX);
    e.minExpansionDistance = m;
    if (e.maxExpansionDistance <= m) {
      const newMax = Math.min(m + 1, DIST_MAX);
      e.maxExpansionDistance = newMax;
      // m was already at the cap, so pull the minimum back below it.
      if (newMax <= m) e.minExpansionDistance = newMax - 1;
    }
  },
});
const maxExpansionDistance = computed({
  get: () => expansion.value?.maxExpansionDistance ?? DIST_MIN + 1,
  set: (v: number) => {
    const e = expansion.value;
    if (!e) return;
    const m = Math.min(Math.max(Math.round(v), DIST_MIN), DIST_MAX);
    e.maxExpansionDistance = m;
    if (e.minExpansionDistance >= m) {
      const newMin = Math.max(m - 1, DIST_MIN);
      e.minExpansionDistance = newMin;
      // m was already at the floor, so push the maximum back above it.
      if (newMin >= m) e.maxExpansionDistance = newMin + 1;
    }
  },
});

const TICKS_PER_MINUTE = 3600;

// Cooldowns are stored as ticks (u32) but shown in minutes. An untouched value
// survives byte-exact (minutes is display-only); only an edit applies the
// round, so a non-whole-minute import shows as a fraction.
const minCooldownMinutes = computed({
  get: () => (expansion.value ? expansion.value.minExpansionCooldown / TICKS_PER_MINUTE : 0),
  set: (v: number) => {
    if (expansion.value) expansion.value.minExpansionCooldown = Math.round(v * TICKS_PER_MINUTE);
  },
});
const maxCooldownMinutes = computed({
  get: () => (expansion.value ? expansion.value.maxExpansionCooldown / TICKS_PER_MINUTE : 0),
  set: (v: number) => {
    if (expansion.value) expansion.value.maxExpansionCooldown = Math.round(v * TICKS_PER_MINUTE);
  },
});
</script>

<template>
  <div class="enemy-tab">
    <ControlTable :names="controlsForCategory('enemy')" :columns="COLUMNS" leadLabel="Setting" />
    <div v-if="preset" class="enemy-modes">
      <FCheckbox v-model="preset.noEnemiesMode" label="No enemies" data-test="no-enemies-mode" />
      <FCheckbox v-model="preset.peacefulMode" label="Peaceful mode" data-test="peaceful-mode" />
    </div>
    <div v-if="preset" class="starting-area">
      <span class="label">Starting area size</span>
      <FPercentSlider v-model="preset.startingArea" data-test="starting-area" />
    </div>
    <section v-if="expansion" data-test="enemy-expansion" class="enemy-section">
      <FCheckbox
        v-model="expansion.enabled"
        label="Enemy expansion"
        data-test="enemy-expansion-enable"
      />
      <EnemyValueRow
        data-test="enemy-exp-min-dist"
        label="Minimum expansion distance"
        v-model="minExpansionDistance"
        :min="1"
        :max="20"
        :step="1"
        :disabled="!expansion.enabled"
      />
      <EnemyValueRow
        data-test="enemy-exp-max-dist"
        label="Maximum expansion distance"
        v-model="maxExpansionDistance"
        :min="1"
        :max="20"
        :step="1"
        :disabled="!expansion.enabled"
      />
      <EnemyValueRow
        data-test="enemy-exp-group-size"
        label="Evolution group size factor"
        v-model="expansion.evolutionGroupSizeFactor"
        :min="1"
        :max="20"
        :step="1"
        :disabled="!expansion.enabled"
      />
      <EnemyValueRow
        data-test="enemy-exp-min-cooldown"
        label="Minimum cooldown (minutes)"
        v-model="minCooldownMinutes"
        :min="1"
        :max="60"
        :step="1"
        :disabled="!expansion.enabled"
      />
      <EnemyValueRow
        data-test="enemy-exp-max-cooldown"
        label="Maximum cooldown (minutes)"
        v-model="maxCooldownMinutes"
        :min="5"
        :max="180"
        :step="1"
        :disabled="!expansion.enabled"
      />
    </section>
    <section v-if="evolution" data-test="enemy-evolution" class="enemy-section">
      <FCheckbox v-model="evolution.enabled" label="Evolution" data-test="enemy-evolution-enable" />
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
    </section>
  </div>
</template>

<style scoped>
/* Shared column geometry: labels ride the flexible 1fr track on the left, the
   slider and number box sit in these fixed columns on the right so every value
   row - and the Starting-area row - aligns. */
.enemy-tab {
  --col-slider: 220px;
  --col-box: 68px;
}

.enemy-modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

/* Starting area size sits on its own line: label then slider packed to the
   left, not in the right-hand value columns. */
.starting-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
}

.starting-area .label {
  font-weight: 700;
}

.starting-area :deep(.f-percent) {
  flex: 0 0 var(--col-slider);
}

.enemy-section {
  padding: 8px;
}
</style>

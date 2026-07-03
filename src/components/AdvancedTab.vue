<script setup lang="ts">
import { computed } from "vue";
import { usePresetsStore } from "../store/presets";
import FNumberInput from "../ui/FNumberInput.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const expressions = computed(() =>
  Object.entries(store.activePreset?.propertyExpressionNames ?? {}),
);
</script>

<template>
  <div class="advanced">
    <h3>Map size</h3>
    <div v-if="preset" class="size-row">
      <label>Width <FNumberInput v-model="preset.width" data-test="map-width" /></label>
      <label>Height <FNumberInput v-model="preset.height" data-test="map-height" /></label>
    </div>
    <h3>Property expression names</h3>
    <p v-if="expressions.length === 0" class="note">
      None set - this preset uses default terrain generation expressions.
    </p>
    <table v-else class="expr-table">
      <tbody>
        <tr v-for="[key, value] in expressions" :key="key">
          <td class="key">{{ key }}</td>
          <td>{{ value }}</td>
        </tr>
      </tbody>
    </table>
    <p class="note">
      Terrain scale and map settings unlock in Phase 1c once their payload offsets are mapped.
    </p>
  </div>
</template>

<style scoped>
.advanced h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.size-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.expr-table {
  border-collapse: collapse;
}

.expr-table td {
  padding: 4px 12px 4px 0;
}

.key {
  font-weight: 700;
}

.note {
  color: var(--f-text-dim);
}
</style>

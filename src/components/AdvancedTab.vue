<script setup lang="ts">
import { computed } from "vue";
import { usePresetsStore } from "../store/presets";

const store = usePresetsStore();
const expressions = computed(() =>
  Object.entries(store.activePreset?.propertyExpressionNames ?? {}),
);
</script>

<template>
  <div class="advanced">
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
      Read-only in Phase 0. Map size, terrain scale, and map settings unlock in Phase 1 once their
      payload offsets are mapped.
    </p>
  </div>
</template>

<style scoped>
.advanced h3 {
  margin: 0 0 8px;
  font-size: 14px;
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

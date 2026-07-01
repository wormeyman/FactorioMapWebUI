<script setup lang="ts">
import { computed } from "vue";
import { controlsFor, type ControlCategory } from "../model/controlCatalog";
import type { Planet } from "../model/planets";
import ControlRow from "./ControlRow.vue";

const props = defineProps<{ planet: Planet; category: ControlCategory }>();

const names = computed(() => controlsFor(props.planet, props.category));
</script>

<template>
  <table class="control-table">
    <thead>
      <tr>
        <th>{{ category === "resource" ? "Resource" : "Setting" }}</th>
        <th>Frequency</th>
        <th>Size</th>
        <th>Richness</th>
      </tr>
    </thead>
    <tbody>
      <ControlRow v-for="name in names" :key="name" :name="name" />
    </tbody>
  </table>
  <p v-if="names.length === 0" class="empty">No {{ category }} controls on this planet.</p>
</template>

<style scoped>
.control-table {
  width: 100%;
  border-collapse: collapse;
}

.control-table th {
  text-align: left;
  padding: 6px 8px;
  color: var(--f-text-dim);
  border-bottom: 1px solid var(--f-edge-dark);
}

.control-table :deep(tr:nth-child(even)) {
  background: rgb(255 255 255 / 3%);
}

.empty {
  color: var(--f-text-dim);
}
</style>

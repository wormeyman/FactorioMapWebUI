<script setup lang="ts">
import { computed } from "vue";
import { controlsForCategory, type ControlCategory } from "../model/controlCatalog";
import ControlRow from "./ControlRow.vue";

const props = defineProps<{ category: ControlCategory }>();

const names = computed(() => controlsForCategory(props.category));
</script>

<template>
  <table class="control-table">
    <thead>
      <tr>
        <th>{{ category === "resource" ? "Resource" : "Setting" }}</th>
        <th class="appears-on-th">Appears on</th>
        <th>Frequency</th>
        <th>Size</th>
        <th>Richness</th>
      </tr>
    </thead>
    <tbody>
      <ControlRow v-for="name in names" :key="name" :name="name" />
    </tbody>
  </table>
  <p v-if="names.length === 0" class="empty">No {{ category }} controls.</p>
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

.control-table th.appears-on-th {
  text-align: center;
}

.control-table :deep(tr:nth-child(even)) {
  background: rgb(255 255 255 / 3%);
}

.empty {
  color: var(--f-text-dim);
}
</style>

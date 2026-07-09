<script setup lang="ts">
import { type ControlColumn, controlsForCategory } from "../model/controlCatalog";
import ControlTable from "./ControlTable.vue";

const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
];
</script>

<template>
  <ControlTable :names="controlsForCategory('enemy')" :columns="COLUMNS" leadLabel="Setting" />
  <p class="note">
    Evolution and expansion settings live in the MapSettings payload region and unlock in Phase 1.
  </p>
</template>

<style scoped>
.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>

<script setup lang="ts">
import type { ControlColumn } from "../model/controlCatalog";
import ControlRow from "./ControlRow.vue";

defineProps<{
  /** Wire names of the controls to render, in row order. */
  names: string[];
  /** Relabelled autoplace columns, e.g. Scale/Coverage. */
  columns: ControlColumn[];
  /** Header for the first (name) column, e.g. "Resource" or "Setting". */
  leadLabel: string;
}>();
</script>

<template>
  <table class="control-table">
    <thead>
      <tr>
        <th>{{ leadLabel }}</th>
        <th class="appears-on-th">Appears on</th>
        <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
      </tr>
    </thead>
    <tbody>
      <ControlRow v-for="name in names" :key="name" :name="name" :columns="columns" />
      <!-- Extra rows that share this table's column widths (e.g. the Enemy tab's
           mode checkboxes + Starting area size, so their slider aligns with the
           Size column above). -->
      <slot name="footer-rows" />
    </tbody>
  </table>
  <p v-if="names.length === 0" class="empty">No controls.</p>
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

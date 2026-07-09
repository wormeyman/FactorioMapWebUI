<script setup lang="ts">
import { type ControlColumn, controlsForCategory } from "../model/controlCatalog";
import ControlTable from "./ControlTable.vue";

const COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Size" },
  { key: "richness", label: "Richness" },
];
</script>

<template>
  <ControlTable :names="controlsForCategory('resource')" :columns="COLUMNS" leadLabel="Resource" />
</template>

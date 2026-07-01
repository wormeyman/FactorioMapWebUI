<script setup lang="ts">
import type { Planet } from "../model/planets";
import ControlTable from "./ControlTable.vue";

defineProps<{ planet: Planet }>();
</script>

<template>
  <ControlTable :planet="planet" category="resource" />
</template>

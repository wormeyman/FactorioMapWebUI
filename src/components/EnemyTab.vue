<script setup lang="ts">
import type { Planet } from "../model/planets";
import ControlTable from "./ControlTable.vue";

defineProps<{ planet: Planet }>();
</script>

<template>
  <ControlTable :planet="planet" category="enemy" />
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

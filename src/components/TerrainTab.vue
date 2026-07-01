<script setup lang="ts">
import type { Planet } from "../model/planets";
import ControlTable from "./ControlTable.vue";

defineProps<{ planet: Planet }>();
</script>

<template>
  <ControlTable :planet="planet" category="terrain" />
  <p class="note">
    Water coverage, cliff continuity, and moisture expression settings unlock in Phase 1 once their
    payload offsets are mapped.
  </p>
</template>

<style scoped>
.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>

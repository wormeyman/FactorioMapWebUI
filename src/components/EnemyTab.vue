<script setup lang="ts">
import ControlTable from "./ControlTable.vue";
</script>

<template>
  <ControlTable category="enemy" />
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

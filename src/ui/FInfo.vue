<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <span class="f-info" data-test="info" :title="text" :aria-label="text">ⓘ</span>
</template>

<style scoped>
.f-info {
  margin-left: 4px;
  color: var(--f-text-dim);
  font-weight: 400;
  cursor: help;
  vertical-align: middle;
}
</style>

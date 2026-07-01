<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <section class="f-panel f-bevel-out">
    <h2 v-if="title" class="f-panel-title">{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.f-panel {
  background: var(--f-panel);
  padding: 8px;
}

.f-panel-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
}
</style>

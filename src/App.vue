<script setup lang="ts">
import { ref } from "vue";
import PresetBar from "./components/PresetBar.vue";
import type { Planet } from "./model/planets";
import FTabs from "./ui/FTabs.vue";

const TABS = ["Resources", "Terrain", "Enemy", "Advanced"];
const activeTab = ref("Resources");
const selectedPlanet = ref<Planet>("nauvis");
</script>

<template>
  <div class="app">
    <header class="titlebar">Map generator</header>
    <PresetBar />
    <div class="body">
      <div class="editor">
        <FTabs v-model="activeTab" :tabs="TABS" />
        <!-- tab content, PreviewPanel, and ActionBar land in Task 11 -->
        <div class="tab-content f-bevel-out">{{ activeTab }} - coming in Task 11</div>
      </div>
      <aside class="preview f-bevel-out">Preview panel - coming in Task 11</aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100vh;
  padding: 8px;
}

.titlebar {
  font-size: 18px;
  font-weight: 700;
}

.body {
  display: grid;
  grid-template-columns: minmax(480px, 1fr) minmax(420px, 1fr);
  gap: 8px;
  flex: 1;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tab-content {
  flex: 1;
  background: var(--f-panel);
  padding: 8px;
}

.preview {
  background: var(--f-panel);
  padding: 8px;
}
</style>

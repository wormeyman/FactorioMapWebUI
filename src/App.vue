<script setup lang="ts">
import { ref } from "vue";
import ActionBar from "./components/ActionBar.vue";
import AdvancedTab from "./components/AdvancedTab.vue";
import EnemyTab from "./components/EnemyTab.vue";
import ImportPanel from "./components/ImportPanel.vue";
import PresetBar from "./components/PresetBar.vue";
import PreviewPanel from "./components/PreviewPanel.vue";
import ResourcesTab from "./components/ResourcesTab.vue";
import TerrainTab from "./components/TerrainTab.vue";
import type { Planet } from "./model/planets";
import FTabs from "./ui/FTabs.vue";

const TABS = ["Resources", "Terrain", "Enemy", "Advanced"];
const activeTab = ref("Resources");
const selectedPlanet = ref<Planet>("nauvis");
const showImport = ref(false);
</script>

<template>
  <div class="app">
    <header class="titlebar">Map generator</header>
    <PresetBar />
    <ImportPanel v-if="showImport" @close="showImport = false" />
    <div class="body">
      <div class="editor f-bevel-out">
        <FTabs v-model="activeTab" :tabs="TABS" />
        <div class="tab-content">
          <ResourcesTab v-if="activeTab === 'Resources'" :planet="selectedPlanet" />
          <TerrainTab v-else-if="activeTab === 'Terrain'" :planet="selectedPlanet" />
          <EnemyTab v-else-if="activeTab === 'Enemy'" :planet="selectedPlanet" />
          <AdvancedTab v-else />
        </div>
      </div>
      <aside class="preview f-bevel-out">
        <PreviewPanel v-model:planet="selectedPlanet" />
      </aside>
    </div>
    <ActionBar @import-requested="showImport = true" />
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
  background: var(--f-panel);
  padding: 8px;
}

.tab-content {
  flex: 1;
}

.preview {
  background: var(--f-panel);
  padding: 8px;
}
</style>

<script setup lang="ts">
import { usePresetsStore } from "../store/presets";
import FButton from "../ui/FButton.vue";

const store = usePresetsStore();
const emit = defineEmits<{ "import-requested": [] }>();

async function copyString() {
  const text = store.activeExchangeString;
  if (text && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}
</script>

<template>
  <div class="action-bar">
    <FButton data-test="open-import" @click="emit('import-requested')">Import string</FButton>
    <FButton data-test="copy-string" :disabled="!store.activeExchangeString" @click="copyString()">
      Copy string
    </FButton>
    <span class="spacer" />
    <FButton data-test="duplicate" @click="store.duplicateActive()">Duplicate</FButton>
    <FButton disabled title="ZIP export lands in a later phase">Download ZIP</FButton>
    <FButton data-test="delete" variant="danger" @click="store.deleteActive()">Delete</FButton>
    <FButton data-test="save" variant="confirm" @click="store.saveToStorage()">Save</FButton>
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 8px;
  background: var(--f-panel);
}

.spacer {
  flex: 1;
}
</style>

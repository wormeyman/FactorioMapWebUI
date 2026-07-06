<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { buildZip } from "../io/zipExport";
import { usePresetsStore } from "../store/presets";
import FButton from "../ui/FButton.vue";

const store = usePresetsStore();
const emit = defineEmits<{ "import-requested": [] }>();

type CopyStatus = "idle" | "copied" | "failed";
const copyStatus = ref<CopyStatus>("idle");
let clearTimer: ReturnType<typeof setTimeout> | undefined;

function flashStatus(status: Exclude<CopyStatus, "idle">) {
  copyStatus.value = status;
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    copyStatus.value = "idle";
  }, 2000);
}

async function copyString() {
  const text = store.activeExchangeString;
  if (!text) return;
  try {
    // Clipboard write can reject (denied permission, unfocused document) and
    // the API is absent on insecure origins; treat both as a copy failure so
    // the user always gets feedback instead of a silently dead button.
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    flashStatus("copied");
  } catch {
    flashStatus("failed");
  }
}

async function downloadZip() {
  const preset = store.activePreset;
  if (!preset) return;
  const blob = await buildZip(preset);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${preset.name}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

onBeforeUnmount(() => clearTimeout(clearTimer));
</script>

<template>
  <div class="action-bar">
    <FButton data-test="open-import" @click="emit('import-requested')">Import string</FButton>
    <FButton data-test="copy-string" :disabled="!store.activePreset" @click="copyString()">
      Copy string
    </FButton>
    <span
      v-if="copyStatus !== 'idle'"
      data-test="copy-status"
      class="copy-status"
      :class="copyStatus"
      role="status"
      aria-live="polite"
    >
      {{ copyStatus === "copied" ? "Copied!" : "Copy failed" }}
    </span>
    <span class="spacer" />
    <FButton data-test="duplicate" @click="store.duplicateActive()">Duplicate</FButton>
    <FButton data-test="download-zip" :disabled="!store.activePreset" @click="downloadZip()">
      Download ZIP
    </FButton>
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

.copy-status {
  align-self: center;
  font-weight: 700;
  font-size: 13px;
}

.copy-status.copied {
  color: var(--f-green);
}

.copy-status.failed {
  color: var(--f-red);
}

.spacer {
  flex: 1;
}
</style>

<script setup lang="ts">
import { ref } from "vue";
import { PLANET_LABELS, PLANETS, type Planet } from "../model/planets";
import { usePresetsStore } from "../store/presets";
import { buildPreviewRequest, postPreview, PreviewError } from "../io/previewClient";
import FButton from "../ui/FButton.vue";
import FDropdown from "../ui/FDropdown.vue";

const props = defineProps<{ planet: Planet }>();
const emit = defineEmits<{ "update:planet": [value: Planet] }>();

const store = usePresetsStore();
const planetOptions = PLANETS.map((p) => ({ value: p, label: PLANET_LABELS[p] }));

const imageUrl = ref<string | null>(null);
const seed = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function generate() {
  const preset = store.activePreset;
  if (!preset || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const req = buildPreviewRequest(preset, props.planet);
    seed.value = req.seed;
    const blob = await postPreview(req);
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = URL.createObjectURL(blob);
  } catch (e) {
    error.value =
      e instanceof PreviewError && e.status === 503
        ? "Preview service is busy - try again shortly."
        : "Preview failed.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <FDropdown
        data-test="planet-select"
        :model-value="planet"
        :options="planetOptions"
        @update:model-value="emit('update:planet', $event as Planet)"
      />
      <span class="spacer" />
      <span v-if="seed !== null" class="seed" data-test="preview-seed">Seed: {{ seed }}</span>
      <FButton data-test="generate" variant="confirm" :disabled="loading" @click="generate()">
        {{ loading ? "Generating..." : "Generate preview" }}
      </FButton>
    </div>
    <div class="preview-stage f-bevel-in">
      <img
        v-if="imageUrl"
        data-test="preview-image"
        class="preview-image"
        :src="imageUrl"
        :alt="`Map preview for ${PLANET_LABELS[planet]}`"
      />
      <p v-else-if="error" data-test="preview-error" class="error" role="alert">{{ error }}</p>
      <p v-else class="dim">Click "Generate preview" to render {{ PLANET_LABELS[planet] }}.</p>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.seed {
  font-size: 12px;
  color: var(--f-text-dim);
}

.preview-stage {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--f-inset);
  padding: 8px;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
}

.error {
  color: var(--f-red);
}

.dim {
  color: var(--f-text-dim);
}
</style>

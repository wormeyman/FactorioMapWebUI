<!-- src/components/ElevationPreviewPanel.vue -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { elevationCtxFromPreset } from "../model/elevationPreviewCtx";
import { usePresetsStore } from "../store/presets";
import FButton from "../ui/FButton.vue";
import { useElevationPreview, type ElevationRenderer } from "./useElevationPreview";

// Fixed view matched to the server --generate-map-preview: 1024 tiles across at
// 1 tile/pixel (the game renders size-1024 previews at 1 meter/pixel), rendered at
// 1024px and centered on world origin (0,0) so the two previews overlay. See
// docs/superpowers/specs/2026-07-19-preview-lineup-design.md.
const PREVIEW_PX = 1024;
const TILES_PER_PIXEL = 1;

const props = defineProps<{ renderer?: ElevationRenderer }>();
// In the app no renderer is passed -> build the real worker-backed one (which
// registers its own onBeforeUnmount). Tests inject a fake, so no Worker is made.
const renderer = props.renderer ?? useElevationPreview();

const store = usePresetsStore();
const canvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const seed = ref<number | null>(null);
const hasRendered = ref(false);

const preview = computed(() =>
  store.activePreset ? elevationCtxFromPreset(store.activePreset) : null,
);
const supported = computed(() => preview.value?.supported ?? false);

// The terrain render (renderTerrain, Task 11) always evaluates the Nauvis
// climate + tile catalog, regardless of the active preset's actual map type -
// it is only faithful for mapType "nauvis". Gate the toggle on that rather
// than rendering a Lakes/Island preset with the wrong climate.
// Terrain and Resources both render through the Nauvis-only renderTerrain, so
// both toggles gate on `terrainAvailable`.
const view = ref<"elevation" | "terrain" | "resources" | "enemies">("elevation");
const terrainAvailable = computed(() => preview.value?.mapType === "nauvis");
watch(terrainAvailable, (available) => {
  if (!available) view.value = "elevation";
});

async function generate() {
  const preset = store.activePreset;
  const info = preview.value;
  if (!preset || !info || !info.supported || loading.value) return;

  const seed0 = store.previewSeed();
  seed.value = seed0;

  const half = (PREVIEW_PX * TILES_PER_PIXEL) / 2; // 512

  loading.value = true;
  error.value = null;
  try {
    const result = await renderer.render({
      seed0,
      mapType: info.mapType,
      view: view.value,
      width: PREVIEW_PX,
      height: PREVIEW_PX,
      originX: -half,
      originY: -half,
      tilesPerPixel: TILES_PER_PIXEL,
      waterLevel: info.ctx.waterLevel,
      segmentationMultiplier: info.ctx.segmentationMultiplier,
      startingPositions: info.ctx.startingPositions,
      moistureFrequency: info.ctx.moistureFrequency,
      moistureBias: info.ctx.moistureBias,
      auxFrequency: info.ctx.auxFrequency,
      auxBias: info.ctx.auxBias,
      startingAreaMoistureSize: info.ctx.startingAreaMoistureSize,
      startingAreaMoistureFrequency: info.ctx.startingAreaMoistureFrequency,
      resourceControls: info.resourceControls,
      enemyControls: info.enemyControls,
    });
    const el = canvas.value;
    const g = el?.getContext("2d");
    if (el && g) {
      el.width = result.width;
      el.height = result.height;
      g.putImageData(
        new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height),
        0,
        0,
      );
      hasRendered.value = true;
    }
  } catch {
    error.value = "Preview failed.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="elevation-preview">
    <div class="preview-toolbar">
      <span v-if="seed !== null" class="seed" data-test="preview-seed">Seed: {{ seed }}</span>
      <div class="view-toggle" role="group" aria-label="Preview view">
        <FButton
          data-test="view-elevation"
          :variant="view === 'elevation' ? 'tool' : 'default'"
          @click="view = 'elevation'"
        >
          Elevation
        </FButton>
        <FButton
          data-test="view-terrain"
          :variant="view === 'terrain' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Terrain view is only available for the Nauvis map type'
          "
          @click="view = 'terrain'"
        >
          Terrain
        </FButton>
        <FButton
          data-test="view-resources"
          :variant="view === 'resources' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable
              ? undefined
              : 'Resources view is only available for the Nauvis map type'
          "
          @click="view = 'resources'"
        >
          Resources
        </FButton>
        <FButton
          data-test="view-enemies"
          :variant="view === 'enemies' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Enemies view is only available for the Nauvis map type'
          "
          @click="view = 'enemies'"
        >
          Enemies
        </FButton>
      </div>
      <span class="spacer" />
      <FButton
        data-test="generate"
        variant="confirm"
        :disabled="!supported || loading"
        @click="generate()"
      >
        {{ loading ? "Rendering..." : "Generate" }}
      </FButton>
    </div>
    <div class="preview-stage f-bevel-in">
      <canvas
        v-show="supported && hasRendered && !error"
        ref="canvas"
        data-test="preview-canvas"
        class="preview-canvas f-preview-media"
      />
      <p v-if="!supported" class="dim" data-test="unsupported">
        Client preview is not available for {{ preview?.mapTypeLabel ?? "this map type" }} yet.
      </p>
      <p v-else-if="error" class="error" role="alert" data-test="preview-error">{{ error }}</p>
      <p v-else-if="!hasRendered" class="dim">Click "Generate" to render the map.</p>
    </div>
  </div>
</template>

<style scoped>
.elevation-preview {
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
.view-toggle {
  display: flex;
  gap: 4px;
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
.error {
  color: var(--f-red);
}
.dim {
  color: var(--f-text-dim);
}
</style>

<!-- src/components/ElevationPreviewPanel.vue -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { elevationCtxFromPreset } from "../model/elevationPreviewCtx";
import { usePresetsStore } from "../store/presets";
import { useUiStore } from "../store/ui";
import FButton from "../ui/FButton.vue";
import FCheckbox from "../ui/FCheckbox.vue";
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
const ui = useUiStore();
const canvas = ref<HTMLCanvasElement | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const seed = ref<number | null>(null);
const hasRendered = ref(false);
/** Wall-clock ms of the last completed render, or null before/behind a failure. */
const elapsedMs = ref<number | null>(null);

const preview = computed(() =>
  store.activePreset ? elevationCtxFromPreset(store.activePreset) : null,
);
const supported = computed(() => preview.value?.supported ?? false);

// The terrain render (renderTerrain, Task 11) always evaluates the Nauvis
// climate + tile catalog, regardless of the active preset's actual map type -
// it is only faithful for mapType "nauvis". Terrain, Resources, Enemies,
// Cliffs, and All each render through the Nauvis-only renderTerrain, so all
// five toggles gate on `terrainAvailable`.
// The user's desired view. Defaults to the full composite, which is the closest
// thing to the game's own map preview - and with dev mode off (the default) it
// is the only view a user ever gets, since the toggles are hidden.
const view = ref<"elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "trees" | "all">(
  "all",
);
const terrainAvailable = computed(() => preview.value?.mapType === "nauvis");
// What actually renders, in priority order:
//   1. Off-Nauvis (Lakes/Island), always "elevation" - renderTerrain always
//      evaluates the Nauvis climate + tile catalog regardless of the preset's
//      map type, so every non-elevation view would be unfaithful there.
//   2. On Nauvis with dev mode on, the user's chosen `view` - `view` is
//      component state that outlives the toggles being hidden, so this only
//      applies while the toggles are actually visible to explain it.
//   3. On Nauvis with dev mode off, always "all" - the toggles are hidden from
//      ordinary users, so `view` could otherwise be stuck on a stale
//      non-composite pick from a prior dev-mode session with no way back.
// Deriving this (instead of the old watch that reset `view`) means a round trip
// through a Lakes preset no longer destroys the chosen view.
const effectiveView = computed(() =>
  !terrainAvailable.value ? "elevation" : ui.devMode ? view.value : "all",
);

async function generate() {
  const preset = store.activePreset;
  const info = preview.value;
  if (!preset || !info || !info.supported || loading.value) return;

  const seed0 = store.previewSeed();
  seed.value = seed0;

  const half = (PREVIEW_PX * TILES_PER_PIXEL) / 2; // 512

  loading.value = true;
  error.value = null;
  elapsedMs.value = null;
  const startedAt = performance.now();
  try {
    const el = canvas.value;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    // Size and clear up front: tiles arrive one at a time and paint straight
    // into this canvas, so it has to be the right size before the first lands.
    el.width = PREVIEW_PX;
    el.height = PREVIEW_PX;
    g.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);

    const completed = await renderer.render(
      {
        seed0,
        mapType: info.mapType,
        view: effectiveView.value,
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
        cliffControls: info.cliffControls,
        cliffSettings: info.cliffSettings,
        treeControls: info.treeControls,
      },
      (tile) => {
        g.putImageData(
          new ImageData(new Uint8ClampedArray(tile.buffer), tile.width, tile.height),
          tile.dx,
          tile.dy,
        );
        // Reveal the canvas as soon as there is anything on it, so the fill-in
        // is visible rather than hidden until the last tile.
        hasRendered.value = true;
      },
    );
    if (completed) {
      // Measured across the whole round trip (dispatch, compute, transfer,
      // blit) - that is the latency a user feels, and what tiling had to move.
      elapsedMs.value = Math.round(performance.now() - startedAt);
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
      <span
        v-if="ui.devMode && elapsedMs !== null"
        class="seed"
        data-test="preview-elapsed"
        title="Wall-clock time from render request to canvas blit"
        >{{ elapsedMs.toLocaleString("en-US") }} ms</span
      >
      <div v-if="ui.devMode" class="view-toggle" role="group" aria-label="Preview view">
        <FButton
          data-test="view-elevation"
          :variant="effectiveView === 'elevation' ? 'tool' : 'default'"
          @click="view = 'elevation'"
        >
          Elevation
        </FButton>
        <FButton
          data-test="view-terrain"
          :variant="effectiveView === 'terrain' ? 'tool' : 'default'"
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
          :variant="effectiveView === 'resources' ? 'tool' : 'default'"
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
          :variant="effectiveView === 'enemies' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Enemies view is only available for the Nauvis map type'
          "
          @click="view = 'enemies'"
        >
          Enemies
        </FButton>
        <FButton
          data-test="view-cliffs"
          :variant="effectiveView === 'cliffs' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Cliffs view is only available for the Nauvis map type'
          "
          @click="view = 'cliffs'"
        >
          Cliffs
        </FButton>
        <FButton
          data-test="view-trees"
          :variant="effectiveView === 'trees' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable ? undefined : 'Trees view is only available for the Nauvis map type'
          "
          @click="view = 'trees'"
        >
          Trees
        </FButton>
        <FButton
          data-test="view-all"
          :variant="effectiveView === 'all' ? 'tool' : 'default'"
          :disabled="!terrainAvailable"
          :title="
            terrainAvailable
              ? undefined
              : 'All-layers view is only available for the Nauvis map type'
          "
          @click="view = 'all'"
        >
          All
        </FButton>
      </div>
      <span class="spacer" />
      <FCheckbox
        data-test="dev-mode"
        label="Debug"
        :model-value="ui.devMode"
        @update:model-value="ui.setDevMode($event)"
      />
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
  /* In dev mode the row carries the six view toggles as well as the seed, the
     elapsed readout, the Debug checkbox and Generate - about 700px of content,
     more than the panel gets below a ~1420px window. Without wrapping, Generate
     is pushed outside the panel and becomes unclickable. Nothing wraps at widths
     where the row already fits, so the normal (non-dev) toolbar is unaffected. */
  flex-wrap: wrap;
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

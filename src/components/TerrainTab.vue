<script setup lang="ts">
import { computed } from "vue";
import { type ControlColumn, controlsForTerrainGroup } from "../model/controlCatalog";
import {
  type ClimateControl,
  MOISTURE,
  TERRAIN_TYPE,
  readBias,
  readScale,
  writeBias,
  writeScale,
} from "../model/climateControls";
import { BIAS_SCALE } from "../model/controlScale";
import { PLANET_ICONS, PLANET_LABELS } from "../model/planets";
import { usePresetsStore } from "../store/presets";
import FDropdown from "../ui/FDropdown.vue";
import FPercentSlider from "../ui/FPercentSlider.vue";
import ControlTable from "./ControlTable.vue";

const COVERAGE_COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Scale" },
  { key: "size", label: "Coverage" },
];

const CLIFF_COLUMNS: ControlColumn[] = [
  { key: "frequency", label: "Frequency" },
  { key: "size", label: "Continuity" },
];

// Map type is a fixed placeholder until elevation presets are decoded.
const MAP_TYPE_OPTIONS = [{ value: "nauvis", label: "Nauvis elevation (Default)" }];

const store = usePresetsStore();

// Scale/Bias sliders bind through the climate accessor to the active preset's
// property_expression_names. Mutating that dict in place flows into
// activeExchangeString via the same reactive path as autoplace ControlRows.
function scaleModel(c: ClimateControl) {
  return computed({
    get: () => {
      const pen = store.activePreset?.propertyExpressionNames;
      return pen ? readScale(pen, c) : 1;
    },
    set: (v: number) => {
      const pen = store.activePreset?.propertyExpressionNames;
      if (pen) writeScale(pen, c, v);
    },
  });
}

function biasModel(c: ClimateControl) {
  return computed({
    get: () => {
      const pen = store.activePreset?.propertyExpressionNames;
      return pen ? readBias(pen, c) : 0;
    },
    set: (v: number) => {
      const pen = store.activePreset?.propertyExpressionNames;
      if (pen) writeBias(pen, c, v);
    },
  });
}

const moistureScale = scaleModel(MOISTURE);
const moistureBias = biasModel(MOISTURE);
const auxScale = scaleModel(TERRAIN_TYPE);
const auxBias = biasModel(TERRAIN_TYPE);
</script>

<template>
  <div class="map-type">
    <label class="map-type-label">Map type</label>
    <FDropdown data-test="map-type" model-value="nauvis" :options="MAP_TYPE_OPTIONS" disabled />
  </div>

  <section data-test="terrain-coverage-table">
    <ControlTable
      :names="controlsForTerrainGroup('coverage')"
      :columns="COVERAGE_COLUMNS"
      lead-label="Setting"
    />
  </section>

  <section data-test="terrain-cliff-table">
    <ControlTable
      :names="controlsForTerrainGroup('cliff')"
      :columns="CLIFF_COLUMNS"
      lead-label="Setting"
    />
  </section>

  <section data-test="terrain-noise-table">
    <table class="control-table">
      <thead>
        <tr>
          <th>Setting</th>
          <th class="appears-on-th">Appears on</th>
          <th>Scale</th>
          <th>Bias</th>
        </tr>
      </thead>
      <tbody>
        <tr data-test="terrain-noise-moisture">
          <td class="label">Moisture</td>
          <td class="appears-on">
            <img
              data-test="appears-on"
              class="planet-icon"
              :src="PLANET_ICONS.nauvis"
              :alt="PLANET_LABELS.nauvis"
              :title="PLANET_LABELS.nauvis"
              width="24"
              height="24"
            />
          </td>
          <td class="cell"><FPercentSlider v-model="moistureScale" /></td>
          <td class="cell"><FPercentSlider v-model="moistureBias" :scale="BIAS_SCALE" /></td>
        </tr>
        <tr data-test="terrain-noise-terrain-type">
          <td class="label">Terrain type</td>
          <td class="appears-on">
            <img
              data-test="appears-on"
              class="planet-icon"
              :src="PLANET_ICONS.nauvis"
              :alt="PLANET_LABELS.nauvis"
              :title="PLANET_LABELS.nauvis"
              width="24"
              height="24"
            />
          </td>
          <td class="cell"><FPercentSlider v-model="auxScale" /></td>
          <td class="cell"><FPercentSlider v-model="auxBias" :scale="BIAS_SCALE" /></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.map-type {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
}

.map-type-label {
  font-weight: 700;
  color: var(--f-text-dim);
}

.control-table {
  width: 100%;
  border-collapse: collapse;
}

.control-table th {
  text-align: left;
  padding: 6px 8px;
  color: var(--f-text-dim);
  border-bottom: 1px solid var(--f-edge-dark);
}

.control-table :deep(tr:nth-child(even)) {
  background: rgb(255 255 255 / 3%);
}

.label {
  font-weight: 700;
  padding: 6px 8px;
}

.cell {
  padding: 6px 8px;
}

.cell :deep(.f-slider) {
  width: 90px;
}

.control-table th.appears-on-th {
  text-align: center;
}

.appears-on {
  padding: 6px 8px;
  text-align: center;
  width: 1%;
  white-space: nowrap;
}

.planet-icon {
  display: block;
  margin: 0 auto;
  vertical-align: middle;
}
</style>

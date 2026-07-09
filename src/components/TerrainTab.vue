<script setup lang="ts">
import { type ControlColumn, controlsForTerrainGroup } from "../model/controlCatalog";
import FDropdown from "../ui/FDropdown.vue";
import FSlider from "../ui/FSlider.vue";
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

// Group 3 noise expressions are not autoplace controls; shown inert for now.
const NOISE_ROWS = [
  { test: "terrain-noise-moisture", label: "Moisture" },
  { test: "terrain-noise-terrain-type", label: "Terrain type" },
];
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
          <th>Scale</th>
          <th>Bias</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in NOISE_ROWS" :key="row.test" :data-test="row.test">
          <td class="label">{{ row.label }}</td>
          <td class="cell"><FSlider :model-value="1" disabled /></td>
          <td class="cell"><FSlider :model-value="0" :min="-1" :max="1" disabled /></td>
        </tr>
      </tbody>
    </table>
    <p class="note">Moisture and terrain-type noise are not yet editable.</p>
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

.note {
  color: var(--f-text-dim);
  padding: 0 8px;
}
</style>

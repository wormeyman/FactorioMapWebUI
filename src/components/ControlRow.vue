<script setup lang="ts">
import { computed } from "vue";
import { CONTROL_CATALOG, type ControlColumn } from "../model/controlCatalog";
import { PLANET_ICONS, PLANET_LABELS } from "../model/planets";
import { RESOURCE_ICONS } from "../model/resourceIcons";
import { usePresetsStore } from "../store/presets";
import FPercentSlider from "../ui/FPercentSlider.vue";

const props = defineProps<{ name: string; columns: ControlColumn[] }>();
const store = usePresetsStore();

const entry = computed(() => CONTROL_CATALOG[props.name]);
const control = computed(() => store.activePreset?.autoplaceControls[props.name]);
const icon = computed(() => RESOURCE_ICONS[props.name]);
</script>

<template>
  <tr v-if="entry && control" class="control-row" :data-test="`control-row-${name}`">
    <td class="label">
      <img
        v-if="icon"
        data-test="resource-icon"
        class="resource-icon"
        :src="icon"
        :alt="entry.label"
        width="22"
        height="22"
      />
      {{ entry.label }}
    </td>
    <td class="appears-on">
      <img
        data-test="appears-on"
        class="planet-icon"
        :src="PLANET_ICONS[entry.planet]"
        :alt="PLANET_LABELS[entry.planet]"
        :title="PLANET_LABELS[entry.planet]"
        width="24"
        height="24"
      />
    </td>
    <td v-for="col in columns" :key="col.key" class="cell">
      <FPercentSlider v-model="control[col.key]" />
    </td>
  </tr>
</template>

<style scoped>
.label {
  font-weight: 700;
  padding: 6px 8px;
}

.resource-icon {
  vertical-align: middle;
  margin-right: 6px;
  image-rendering: pixelated;
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

.cell {
  padding: 6px 8px;
}
</style>

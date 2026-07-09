<script setup lang="ts">
import { computed } from "vue";
import { CONTROL_CATALOG, type ControlColumn } from "../model/controlCatalog";
import { PLANET_ICONS, PLANET_LABELS } from "../model/planets";
import { usePresetsStore } from "../store/presets";
import FNumberInput from "../ui/FNumberInput.vue";
import FSlider from "../ui/FSlider.vue";

const props = defineProps<{ name: string; columns: ControlColumn[] }>();
const store = usePresetsStore();

const entry = computed(() => CONTROL_CATALOG[props.name]);
const control = computed(() => store.activePreset?.autoplaceControls[props.name]);
</script>

<template>
  <tr v-if="entry && control" class="control-row" :data-test="`control-row-${name}`">
    <td class="label">{{ entry.label }}</td>
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
      <FSlider v-model="control[col.key]" />
      <FNumberInput v-model="control[col.key]" />
    </td>
  </tr>
</template>

<style scoped>
.label {
  font-weight: 700;
  padding: 6px 8px;
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

.cell:deep(.f-slider) {
  width: 90px;
  vertical-align: middle;
  margin-right: 6px;
}
</style>

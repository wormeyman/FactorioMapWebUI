<script setup lang="ts">
import { computed } from "vue";
import { CONTROL_CATALOG } from "../model/controlCatalog";
import { usePresetsStore } from "../store/presets";
import FNumberInput from "../ui/FNumberInput.vue";
import FSlider from "../ui/FSlider.vue";

const props = defineProps<{ name: string }>();
const store = usePresetsStore();

const entry = computed(() => CONTROL_CATALOG[props.name]);
const control = computed(() => store.activePreset?.autoplaceControls[props.name]);
</script>

<template>
  <tr v-if="entry && control" class="control-row" :data-test="`control-row-${name}`">
    <td class="label">{{ entry.label }}</td>
    <td class="cell">
      <FSlider v-model="control.frequency" />
      <FNumberInput v-model="control.frequency" />
    </td>
    <td class="cell">
      <FSlider v-model="control.size" />
      <FNumberInput v-model="control.size" />
    </td>
    <td class="cell">
      <template v-if="entry.hasRichness">
        <FSlider v-model="control.richness" />
        <FNumberInput v-model="control.richness" />
      </template>
    </td>
  </tr>
</template>

<style scoped>
.label {
  font-weight: 700;
  padding: 6px 8px;
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

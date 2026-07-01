<script setup lang="ts">
import { computed, ref } from "vue";
import { BUILTIN_NAMES } from "../model/builtins";
import { usePresetsStore } from "../store/presets";
import FButton from "../ui/FButton.vue";
import FCheckbox from "../ui/FCheckbox.vue";
import FDropdown from "../ui/FDropdown.vue";

const store = usePresetsStore();
const newName = ref("");
const builtinChoice = ref("Default");

const builtinOptions = BUILTIN_NAMES.map((name) => ({ value: name, label: name }));
const editOptions = computed(() =>
  store.userPresets.map((p) => ({ value: p.name, label: p.name })),
);

const randomEachMap = computed({
  get: () => store.activePreset?.randomEachMap ?? true,
  set: (value: boolean) => {
    if (store.activePreset) store.activePreset.randomEachMap = value;
  },
});

function create() {
  if (!newName.value.trim()) return;
  store.createFromBuiltin(builtinChoice.value, newName.value);
  newName.value = "";
}

function onSeedChange(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  if (store.activePreset) {
    store.activePreset.seed = raw === "" ? null : Number(raw);
  }
}
</script>

<template>
  <div class="preset-bar f-bevel-out">
    <span class="field-label">Edit preset</span>
    <FDropdown
      data-test="edit-preset-select"
      :model-value="store.activeName ?? ''"
      :options="editOptions"
      @update:model-value="store.selectPreset($event)"
    />

    <span class="field-label">New preset</span>
    <input
      v-model="newName"
      data-test="new-preset-name"
      class="name-input"
      placeholder="New preset name"
      @keyup.enter="create"
    />
    <FDropdown v-model="builtinChoice" data-test="builtin-select" :options="builtinOptions" />
    <FButton data-test="create-preset" variant="tool" @click="create">Create</FButton>

    <span class="spacer" />

    <span class="field-label">Seed</span>
    <input
      data-test="seed-input"
      class="name-input seed"
      type="number"
      placeholder="Random"
      :disabled="randomEachMap"
      :value="store.activePreset?.seed ?? ''"
      @change="onSeedChange"
    />
    <FCheckbox v-model="randomEachMap" data-test="random-each-map" label="Random each new map" />
  </div>
</template>

<style scoped>
.preset-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--f-panel);
}

.field-label {
  font-weight: 700;
  color: var(--f-text-dim);
  white-space: nowrap;
}

.name-input {
  padding: 4px 8px;
  border: none;
  font: inherit;
  color: var(--f-text);
  background: var(--f-inset);
  box-shadow:
    inset 1px 1px 0 var(--f-edge-dark),
    inset -1px -1px 0 var(--f-edge-light);
}

.name-input:disabled {
  opacity: 0.4;
}

.name-input.seed {
  width: 110px;
}

.spacer {
  flex: 1;
}
</style>

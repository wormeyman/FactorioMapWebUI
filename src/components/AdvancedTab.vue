<script setup lang="ts">
import { computed } from "vue";
import { usePresetsStore } from "../store/presets";
import EnemyValueRow from "./EnemyValueRow.vue";
import FCheckbox from "../ui/FCheckbox.vue";
import FInfo from "../ui/FInfo.vue";
import FNumberInput from "../ui/FNumberInput.vue";

const store = usePresetsStore();
const preset = computed(() => store.activePreset);
const pollution = computed(() => preset.value?.mapSettings.pollution);
const difficulty = computed(() => preset.value?.mapSettings.difficulty);
const asteroids = computed(() => preset.value?.mapSettings.asteroids);
const expressions = computed(() =>
  Object.entries(store.activePreset?.propertyExpressionNames ?? {}),
);

// Display scaling (oracle-verified against Factorio 2.1.9 - see the design spec's
// "Field mapping - ORACLE VERIFIED" section). The map-gen GUI shows some wire
// floats scaled; the wire stays raw and the scale is applied only on set, so an
// untouched import is byte-exact. Percent fields display wire * 100; Spoiling
// rate is the INVERSE (display% = 100 / wire); tree thresholds and the tech price
// multiplier are raw.
const PERCENT = 100;

// Linear scaled display: reads the raw wire float and shows `wire * scale`;
// writes `display / scale`. read/write closures keep this fully typed against
// each settings section (no generic indexing against the boolean `enabled`).
function scaled(read: () => number | null | undefined, write: (v: number) => void, scale: number) {
  return computed({
    get: () => {
      const v = read();
      // Round away float-multiply noise for the box (e.g. 2.0000000000000004).
      // `== null` catches both null (absent optional tail field) and undefined.
      return v == null ? 0 : Math.round(v * scale * 1e6) / 1e6;
    },
    set: (display: number) => write(display / scale),
  });
}

const spawningRate = scaled(
  () => asteroids.value?.spawningRate,
  (v) => {
    if (asteroids.value) asteroids.value.spawningRate = v;
  },
  PERCENT,
);
const ageing = scaled(
  () => pollution.value?.ageing,
  (v) => {
    if (pollution.value) pollution.value.ageing = v;
  },
  PERCENT,
);
const attackCost = scaled(
  () => pollution.value?.enemyAttackPollutionConsumptionModifier,
  (v) => {
    if (pollution.value) pollution.value.enemyAttackPollutionConsumptionModifier = v;
  },
  PERCENT,
);
const minDamageTrees = scaled(
  () => pollution.value?.minPollutionToDamageTrees,
  (v) => {
    if (pollution.value) pollution.value.minPollutionToDamageTrees = v;
  },
  1,
);
// "Absorbed per damaged tree" tracks pollutionRestoredPerTreeDamage (oracle-verified,
// NOT pollutionPerTreeDamage).
const absorbedPerTree = scaled(
  () => pollution.value?.pollutionRestoredPerTreeDamage,
  (v) => {
    if (pollution.value) pollution.value.pollutionRestoredPerTreeDamage = v;
  },
  1,
);
const diffusion = scaled(
  () => pollution.value?.diffusionRatio,
  (v) => {
    if (pollution.value) pollution.value.diffusionRatio = v;
  },
  PERCENT,
);

// Spoiling rate is displayed as the INVERSE of the wire spoil-time modifier:
// rate% = 100 / spoilTimeModifier (wire is spoil TIME, GUI shows spoil RATE).
// Applied only on set, so an untouched import stays byte-exact.
const spoilingRate = computed({
  get: () => {
    const w = difficulty.value?.spoilTimeModifier;
    return w ? Math.round(100 / w) : 0;
  },
  set: (displayPct: number) => {
    if (difficulty.value && displayPct > 0) difficulty.value.spoilTimeModifier = 100 / displayPct;
  },
});

// Verbatim map-gen GUI tooltip text (Factorio 2.1.9 core locale [gui-map-generator]).
// Price multiplier has no dedicated map-gen tooltip, so it gets no FInfo.
const INFO = {
  pollution:
    "Controls whether pollution is enabled.\nNote: Disabled pollution will disable some achievements.",
  ageing:
    "Modifier of how much pollution is absorbed by trees and tiles.\nNote: A value higher than 100% will disable some achievements.",
  attackCost:
    "Modifier of how much pollution is consumed to send a biter to attack.\nNote: A value higher than 100% will disable some achievements.",
  minDamageTrees:
    "Trees have 4 different progressive stages toward being destroyed by pollution. Any pollution above this amount starts the process of moving a tree toward a more damaged stage.",
  absorbedPerTree:
    "Trees have 4 different progressive stages toward being destroyed by pollution. This value specifies how much pollution is absorbed when moving to a more damaged stage.",
  diffusion: "The amount of pollution diffused into neighboring chunks per second.",
  spawningRate: "Rate at which asteroids spawn in space.",
  spoilingRate: "Rate at which spoilable items spoil.",
};
</script>

<template>
  <div class="advanced">
    <h3>Map size</h3>
    <div v-if="preset" class="size-row">
      <label>Width <FNumberInput v-model="preset.width" data-test="map-width" /></label>
      <label>Height <FNumberInput v-model="preset.height" data-test="map-height" /></label>
    </div>

    <template v-if="difficulty">
      <h3>Technology</h3>
      <!-- Price multiplier is a number box in the game GUI (range 1-100000), not a
           slider. Bound raw (no display scaling). -->
      <div class="size-row">
        <label
          >Price multiplier
          <FNumberInput
            v-model="difficulty.technologyPriceMultiplier"
            data-test="tech-price-multiplier"
        /></label>
      </div>
    </template>

    <template v-if="pollution">
      <h3>Pollution</h3>
      <FCheckbox
        v-model="pollution.enabled"
        label="Pollution"
        data-test="pollution-enabled"
      /><FInfo :text="INFO.pollution" />
      <EnemyValueRow
        data-test="pollution-ageing"
        label="Absorption modifier"
        v-model="ageing"
        :info="INFO.ageing"
        :min="10"
        :max="400"
        :step="5"
        :disabled="!pollution.enabled"
      />
      <EnemyValueRow
        data-test="pollution-attack-cost"
        label="Attack cost modifier"
        v-model="attackCost"
        :info="INFO.attackCost"
        :min="10"
        :max="400"
        :step="5"
        :disabled="!pollution.enabled"
      />
      <EnemyValueRow
        data-test="pollution-min-damage-trees"
        label="Minimum to damage trees"
        v-model="minDamageTrees"
        :info="INFO.minDamageTrees"
        :min="0"
        :max="9999"
        :step="1"
        :disabled="!pollution.enabled"
      />
      <EnemyValueRow
        data-test="pollution-absorbed-per-tree"
        label="Absorbed per damaged tree"
        v-model="absorbedPerTree"
        :info="INFO.absorbedPerTree"
        :min="0"
        :max="9999"
        :step="1"
        :disabled="!pollution.enabled"
      />
      <EnemyValueRow
        data-test="pollution-diffusion"
        label="Diffusion ratio"
        v-model="diffusion"
        :info="INFO.diffusion"
        :min="0"
        :max="25"
        :step="1"
        :disabled="!pollution.enabled"
      />
    </template>

    <template v-if="asteroids">
      <h3>Asteroids</h3>
      <EnemyValueRow
        data-test="asteroid-spawning-rate"
        label="Spawning rate"
        v-model="spawningRate"
        :info="INFO.spawningRate"
        :min="10"
        :max="400"
        :step="5"
      />
    </template>

    <template v-if="difficulty">
      <h3>Spoiling</h3>
      <EnemyValueRow
        data-test="spoiling-rate"
        label="Spoiling rate"
        v-model="spoilingRate"
        :info="INFO.spoilingRate"
        :min="10"
        :max="1000"
        :step="10"
      />
    </template>

    <details class="expr-details">
      <summary>Property expression names</summary>
      <p v-if="expressions.length === 0" class="note" data-test="expr-dump">
        None set - this preset uses default terrain generation expressions.
      </p>
      <table v-else class="expr-table" data-test="expr-dump">
        <tbody>
          <tr v-for="[key, value] in expressions" :key="key">
            <td class="key">{{ key }}</td>
            <td>{{ value }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <p class="note">
      Full map settings (enemy, path finder, and the remaining pollution fields) are decoded and
      included in the exported ZIP.
    </p>
  </div>
</template>

<style scoped>
.advanced {
  --col-slider: 220px;
  --col-box: 72px;
}

.advanced h3 {
  margin: 12px 0 8px;
  font-size: 14px;
}

.size-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.expr-details {
  margin-top: 16px;
}

.expr-table {
  border-collapse: collapse;
}

.expr-table td {
  padding: 4px 12px 4px 0;
}

.key {
  font-weight: 700;
}

.note {
  color: var(--f-text-dim);
}
</style>

# Advanced tab: editable map settings - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Technology price multiplier, a pollution subset, asteroid spawning rate, and spoiling rate editable on the Advanced tab, round-tripping byte-exact through the map-exchange codec.

**Architecture:** Generalize the tail overlay (`writeEnemyToTail` -> `writeMapSettingsToTail`) so `presetToEncodable` overlays the new sections back onto the tail rebuilt from `opaqueTailB64`; the Advanced tab reuses `EnemyValueRow`/`FCheckbox`/`FInfo` with per-field display scaling verified against the game.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, TypeScript 6.0.3, vite-plus test runner (`vite-plus/test`), `@vue/test-utils`.

**Spec:** `docs/superpowers/specs/2026-07-20-advanced-tab-map-settings-design.md`

## Global Constraints

- Byte-exact codec invariant: re-encoding an untouched preset must reproduce the game's zlib stream byte-for-byte. The gate is the existing `presetToEncodable round-trips %s` test over all 9 builtin fixtures (`test/encode.spec.ts:96-102`). Never edit a fixture to make a test pass.
- Test command: `pnpm vp test` (single file: `pnpm vp test test/<file>.spec.ts`).
- Lint/format: `pnpm vp check --fix` (there is no `.vue` type-check step).
- Run all `pnpm` / `pnpm vp` commands from the worktree root.
- Use hyphens, not em/en dashes, in all files.
- Commit message trailers (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013vLRtrzJyFLLBMUqxyrSZZ
  ```

## File Structure

- Modify `src/model/mapSettings.ts` - rename/generalize `writeEnemyToTail` -> `writeMapSettingsToTail(tail, mapSettings)`; rewrite its docstring.
- Modify `src/model/convert.ts` - update import (line 8) and call site (line 50).
- Modify `src/model/types.ts` - update the `Preset.mapSettings` docstring (lines 49-56).
- Modify `test/mapSettings.spec.ts` - migrate the two direct `writeEnemyToTail` tests to the new signature; add new-field round-trip + undefined-skip tests.
- Modify `test/convert.spec.ts` - add falsy/no-op round-trip guards for the new fields.
- Rewrite `src/components/AdvancedTab.vue` - Technology / Pollution / Asteroids / Spoiling sections + display scaling + gating + collapsed expr `<details>`; keep Map size.
- Modify `test/advancedTab.spec.ts` - add component tests for the new controls (keep the existing width/height tests).
- Modify the spec's mapping table (Task 2 records verified values).

---

### Task 1: Generalize the tail overlay to `writeMapSettingsToTail`

**Files:**
- Modify: `src/model/mapSettings.ts:289-333` (the `writeEnemyToTail` function + docstring)
- Modify: `src/model/convert.ts:8` (import), `src/model/convert.ts:50` (call site)
- Modify: `src/model/types.ts:49-56` (docstring)
- Test: `test/mapSettings.spec.ts:3,231-259`, `test/convert.spec.ts`

**Interfaces:**
- Produces: `writeMapSettingsToTail(tail: TailBlock, mapSettings: MapSettings): void` - overlays the enemy sections (full) plus the pollution/difficulty/asteroids subset (keys listed below) onto `tail`. Consumed by `presetToEncodable`.
- Consumes: existing `MapSettings` type, `TailBlock` type.

- [ ] **Step 1: Migrate the two direct-overlay tests to the new name/signature (failing)**

In `test/mapSettings.spec.ts`, change the import on line 3 from `writeEnemyToTail` to `writeMapSettingsToTail`, and replace the `describe("writeEnemyToTail", ...)` block (lines ~231-259) with:

```ts
describe("writeMapSettingsToTail", () => {
  it("is the inverse of tailToNested's reads (round-trips edited values)", () => {
    const tail = decodeExchangeString(presets["Default"] as string).tail;
    const { mapSettings } = tailToNested(tail);
    const edited = {
      ...mapSettings,
      enemyEvolution: { ...mapSettings.enemyEvolution, enabled: false, timeFactor: 0.5 },
      enemyExpansion: { ...mapSettings.enemyExpansion, maxExpansionDistance: 99 },
      pollution: { ...mapSettings.pollution, diffusionRatio: 0.09, minPollutionToDamageTrees: 42 },
      difficulty: { ...mapSettings.difficulty, technologyPriceMultiplier: 4 },
      asteroids: { ...mapSettings.asteroids, spawningRate: 2 },
    };

    writeMapSettingsToTail(tail, edited);
    const after = tailToNested(tail).mapSettings;

    expect(after.enemyEvolution.enabled).toBe(false);
    expect(after.enemyEvolution.timeFactor).toBe(0.5);
    expect(after.enemyExpansion.maxExpansionDistance).toBe(99);
    expect(after.pollution.diffusionRatio).toBe(0.09);
    expect(after.pollution.minPollutionToDamageTrees).toBe(42);
    expect(after.difficulty.technologyPriceMultiplier).toBe(4);
    expect(after.asteroids.spawningRate).toBe(2);
  });

  it("skips a field whose value is undefined (preserves the original)", () => {
    const tail = decodeExchangeString(presets["Default"] as string).tail;
    const original = tail["enemyEvolution.timeFactor"];
    const { mapSettings } = tailToNested(tail);
    const edited = {
      ...mapSettings,
      enemyEvolution: {
        ...mapSettings.enemyEvolution,
        timeFactor: undefined as unknown as number,
      },
    };

    writeMapSettingsToTail(tail, edited);

    expect(tail["enemyEvolution.timeFactor"]).toBe(original);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vp test test/mapSettings.spec.ts`
Expected: FAIL - `writeMapSettingsToTail` is not exported.

- [ ] **Step 3: Rename and extend the function in `src/model/mapSettings.ts`**

Replace the entire `writeEnemyToTail` function and its docstring (lines ~289-333) with:

```ts
/**
 * Overlay the round-trip-editable MapSettings sections back onto a flat
 * `TailBlock` - the inverse of the corresponding reads in `tailToNested`.
 *
 * Writes ONLY these keys: the full enemyEvolution / enemyExpansion sections,
 * plus the hand-picked Advanced-tab subset of pollution
 * (enabled, ageing, enemyAttackPollutionConsumptionModifier,
 * minPollutionToDamageTrees, pollutionPerTreeDamage, diffusionRatio),
 * difficulty (technologyPriceMultiplier, spoilTimeModifier), and asteroids
 * (spawningRate). It deliberately does NOT touch unitGroup, pathFinder, or the
 * other pollution/difficulty keys - those stay carried opaquely via
 * `opaqueTailB64`. Do not assume the "map settings" name means every section is
 * handled; wiring a new control means adding its key here first.
 *
 * A field is copied only when `value !== undefined`, so a field that decoded
 * genuinely absent is not spuriously added. (Optional tail fields decode to
 * `null`, not `undefined`; `null` is copied and re-emitted as presence-byte 0,
 * still byte-exact.) A `false` / `0` edit IS written - that is the point of the
 * undefined-check rather than a truthiness check.
 *
 * Used by `presetToEncodable` to make these sections round-trip-editable while
 * every other tail byte round-trips unchanged from `opaqueTailB64`.
 */
export function writeMapSettingsToTail(tail: TailBlock, mapSettings: MapSettings): void {
  const put = (key: string, value: number | boolean | undefined) => {
    if (value !== undefined) tail[key] = value;
  };
  const { enemyEvolution, enemyExpansion, pollution, difficulty, asteroids } = mapSettings;

  put("enemyEvolution.enabled", enemyEvolution.enabled);
  put("enemyEvolution.timeFactor", enemyEvolution.timeFactor);
  put("enemyEvolution.destroyFactor", enemyEvolution.destroyFactor);
  put("enemyEvolution.pollutionFactor", enemyEvolution.pollutionFactor);

  put("enemyExpansion.enabled", enemyExpansion.enabled);
  put("enemyExpansion.maxExpansionDistance", enemyExpansion.maxExpansionDistance);
  put("enemyExpansion.minExpansionDistance", enemyExpansion.minExpansionDistance);
  put("enemyExpansion.friendlyBaseInfluenceRadius", enemyExpansion.friendlyBaseInfluenceRadius);
  put("enemyExpansion.enemyBuildingInfluenceRadius", enemyExpansion.enemyBuildingInfluenceRadius);
  put("enemyExpansion.buildingCoefficient", enemyExpansion.buildingCoefficient);
  put("enemyExpansion.otherBaseCoefficient", enemyExpansion.otherBaseCoefficient);
  put("enemyExpansion.neighbouringChunkCoefficient", enemyExpansion.neighbouringChunkCoefficient);
  put(
    "enemyExpansion.neighbouringBaseChunkCoefficient",
    enemyExpansion.neighbouringBaseChunkCoefficient,
  );
  put("enemyExpansion.maxCollidingTilesCoefficient", enemyExpansion.maxCollidingTilesCoefficient);
  put("enemyExpansion.settlerGroupMinSize", enemyExpansion.settlerGroupMinSize);
  put("enemyExpansion.settlerGroupMaxSize", enemyExpansion.settlerGroupMaxSize);
  put("enemyExpansion.evolutionGroupSizeFactor", enemyExpansion.evolutionGroupSizeFactor);
  put("enemyExpansion.minExpansionCooldown", enemyExpansion.minExpansionCooldown);
  put("enemyExpansion.maxExpansionCooldown", enemyExpansion.maxExpansionCooldown);

  put("pollution.enabled", pollution.enabled);
  put("pollution.ageing", pollution.ageing);
  put(
    "pollution.enemyAttackPollutionConsumptionModifier",
    pollution.enemyAttackPollutionConsumptionModifier,
  );
  put("pollution.minPollutionToDamageTrees", pollution.minPollutionToDamageTrees);
  put("pollution.pollutionPerTreeDamage", pollution.pollutionPerTreeDamage);
  put("pollution.diffusionRatio", pollution.diffusionRatio);

  put("difficulty.technologyPriceMultiplier", difficulty.technologyPriceMultiplier);
  put("difficulty.spoilTimeModifier", difficulty.spoilTimeModifier);

  put("asteroids.spawningRate", asteroids.spawningRate);
}
```

Note: `MapSettings` is already referenced in this file (via the interfaces); no new import needed.

- [ ] **Step 4: Update the call site in `src/model/convert.ts`**

Line 8, change the import:
```ts
import { tailToNested, writeMapSettingsToTail } from "./mapSettings";
```
Line ~50, change the call:
```ts
  writeMapSettingsToTail(tail, preset.mapSettings);
```

- [ ] **Step 5: Update the `Preset.mapSettings` docstring in `src/model/types.ts`**

Replace the docstring at lines 49-56 with:
```ts
  /**
   * Nested, typed view of the MapSettings sections of the tail. The
   * enemyEvolution / enemyExpansion sections and the Advanced-tab subset of
   * pollution (enabled, ageing, enemyAttackPollutionConsumptionModifier,
   * minPollutionToDamageTrees, pollutionPerTreeDamage, diffusionRatio),
   * difficulty (technologyPriceMultiplier, spoilTimeModifier), and asteroids
   * (spawningRate) are round-trip EDITABLE: `presetToEncodable` overlays them
   * back onto the tail (see `writeMapSettingsToTail`). Every OTHER field here
   * (unitGroup, pathFinder, the remaining pollution/difficulty keys) is a
   * read-only derived view for JSON export/display and is ignored by the
   * encoder - wiring one to a control requires extending the overlay first.
   */
```

- [ ] **Step 6: Run the migrated tests to verify they pass**

Run: `pnpm vp test test/mapSettings.spec.ts`
Expected: PASS.

- [ ] **Step 7: Add falsy / no-op round-trip guards in `test/convert.spec.ts`**

Append inside the existing `describe("presetToEncodable enemy overlay", ...)` block (or a new `describe("presetToEncodable map-settings overlay", ...)` block at end of file), reusing the file's `roundTrip` helper and `presets` import:

```ts
describe("presetToEncodable map-settings overlay", () => {
  it("round-trips an untouched Default preset byte-exact", () => {
    const original = presets["Default"] as string;
    const preset = presetFromDecoded("x", decodeExchangeString(original));
    expect(roundTrip(preset)).toBe(original);
  });

  it("persists pollution.enabled toggled to false as present-false", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.pollution.enabled = false;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["pollution.enabled"]).toBe(false);
  });

  it("persists a numeric pollution field set to 0", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.pollution.minPollutionToDamageTrees = 0;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["pollution.minPollutionToDamageTrees"]).toBe(0);
  });

  it("round-trips edited technology price multiplier, spoiling, spawning, diffusion", () => {
    const preset = presetFromDecoded("x", decodeExchangeString(presets["Default"] as string));
    preset.mapSettings.difficulty.technologyPriceMultiplier = 4;
    preset.mapSettings.difficulty.spoilTimeModifier = 2;
    preset.mapSettings.asteroids.spawningRate = 2;
    preset.mapSettings.pollution.diffusionRatio = 0.09;
    const tail = decodeExchangeString(roundTrip(preset)).tail;
    expect(tail["difficulty.technologyPriceMultiplier"]).toBeCloseTo(4, 12);
    expect(tail["difficulty.spoilTimeModifier"]).toBeCloseTo(2, 12);
    expect(tail["asteroids.spawningRate"]).toBeCloseTo(2, 12);
    expect(tail["pollution.diffusionRatio"]).toBeCloseTo(0.09, 12);
  });

  it("re-setting diffusionRatio to its decoded value re-encodes byte-exact", () => {
    const original = presets["Default"] as string;
    const preset = presetFromDecoded("x", decodeExchangeString(original));
    // No-op edit at the decoded value must not perturb bytes. Route through a
    // temp so it is not a literal self-assignment (oxlint no-self-assign).
    const decoded = preset.mapSettings.pollution.diffusionRatio;
    preset.mapSettings.pollution.diffusionRatio = decoded;
    expect(roundTrip(preset)).toBe(original);
  });
});
```

If `presetFromDecoded` / `presets` are not already imported in `test/convert.spec.ts`, add them (it already imports `decodeExchangeString`, `presetFromDecoded`, `presetToEncodable`; confirm `presets` fixture import matches the file's existing style).

- [ ] **Step 8: Run the full suite**

Run: `pnpm vp test`
Expected: PASS, count = previous baseline (626) + the new tests, 0 failures. In particular `test/encode.spec.ts` (the 9-fixture byte-exact gate) must stay green.

- [ ] **Step 9: Lint + commit**

```bash
pnpm vp check --fix
git add src/model/mapSettings.ts src/model/convert.ts src/model/types.ts test/mapSettings.spec.ts test/convert.spec.ts
git commit -m "$(cat <<'EOF'
feat(advanced): generalize tail overlay to writeMapSettingsToTail

Overlay pollution subset, difficulty (tech price + spoil time), and
asteroid spawning rate back onto the tail so they round-trip editable,
keeping the enemy sections. Byte-exact for untouched presets.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013vLRtrzJyFLLBMUqxyrSZZ
EOF
)"
```

---

### Task 2: Oracle verification of labels, tooltips, and display scales

This task resolves the spec's flagged inferences before the UI hard-codes them. It is a human-assisted checkpoint: the automatable parts (locale strings, wire cross-check) run headless; the display scales need the game GUI.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-advanced-tab-map-settings-design.md` (record verified values in the mapping table)
- Reference: `test/oracle/README.md` (harness recipe), the Factorio install locale.

**Interfaces:**
- Produces: a verified table of `{ field -> displayScale, label, tooltip }` and the resolved "Absorbed per damaged tree" wire key, consumed by Task 3's `DISPLAY_SCALE` map and `INFO` strings.

- [ ] **Step 1: Locate the install and grep locale for labels + tooltips**

```bash
FBASE="$HOME/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents"
ls "$FBASE/data/base/locale/en/"
grep -rniE "absorption|attack cost|damage trees|absorbed per|diffusion|spawning rate|spoil|price multiplier|pollution" "$FBASE/data/base/locale/en/" | grep -iE "map-gen|gui-map|difficulty|pollution|tooltip" | head -60
```
Record the verbatim label + tooltip string for each of: Pollution (enabled), Absorption modifier, Attack cost modifier, Minimum to damage trees, Absorbed per damaged tree, Diffusion ratio, Technology price multiplier, Asteroids spawning rate, Spoiling rate. The locale key names disambiguate which wire field a GUI label maps to (e.g. whether "Absorbed per damaged tree" is `pollution_per_tree_damage` or `pollution_restored_per_tree_damage`).

- [ ] **Step 2: Headless wire cross-check (confirms the encoded string is game-valid)**

Build one exchange string with all new fields set to distinctive values (use a throwaway Node script or a temporary test that calls `encodeExchangeString(presetToEncodable(preset))` after editing the fields), then parse it with the game's own parser following the `test/fixtures/map-exchange-parsed.*` recipe (the dumper mod calling `helpers.parse_map_exchange_string`, run headless with an isolated `--config`). Confirm the parsed JSON's `map_settings` values match the edited wire values. This proves the overlay's bytes parse correctly in-game, not just in our decoder.

If running the game parser is impractical this session, the Task 1 TS round-trip tests already establish wire correctness; record that this step was deferred (do NOT silently skip - note it in the spec).

- [ ] **Step 3: Display-scale checkpoint (needs the map-gen GUI)**

For each field whose scale is unverified (ageing, attack-cost modifier, diffusionRatio, spawningRate, spoilTimeModifier, technologyPriceMultiplier), generate an exchange string with a known distinctive wire value and have the value read from the game's map-gen GUI (import string -> New Game -> Advanced settings), the same method the `EnemyTab.vue` comment cites. Derive `displayScale = displayedValue / wireValue` for each. Resolve specifically:
  - `technologyPriceMultiplier` vs `spoilTimeModifier` - do both display raw, both percent, or split? (The spec flags treating them differently as suspect.)
  - `diffusionRatio` (0.02) - shown as `2`, `0.02`, or `2%`?

Present the generated strings and ask the user to read back the GUI values, then finalize.

- [ ] **Step 4: Record verified values in the spec + commit**

Update the mapping table and the display-scaling section of `docs/superpowers/specs/2026-07-20-advanced-tab-map-settings-design.md` to state the confirmed scale, label, tooltip, and resolved tree-damage key for each field (replace the "working hypotheses / suspect" language with the verified result, or, if a piece stayed unverified, keep it explicitly flagged).

```bash
git add docs/superpowers/specs/2026-07-20-advanced-tab-map-settings-design.md
git commit -m "$(cat <<'EOF'
docs(advanced): record oracle-verified labels, tooltips, display scales

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013vLRtrzJyFLLBMUqxyrSZZ
EOF
)"
```

---

### Task 3: Advanced tab UI - Technology / Pollution / Asteroids / Spoiling

**Files:**
- Rewrite: `src/components/AdvancedTab.vue`
- Test: `test/advancedTab.spec.ts`

**Interfaces:**
- Consumes: `writeMapSettingsToTail` (via the store's `activeExchangeString`), the verified `DISPLAY_SCALE` / labels / tooltips from Task 2, `EnemyValueRow` (`{ label, modelValue, min?, max?, step?, disabled?, info? }`), `FCheckbox`, `FInfo`, `FNumberInput`.
- Produces: the finished Advanced tab (no downstream consumers).

> Scales/labels/tooltips/ranges below are ORACLE-VERIFIED (see the spec's "Field mapping - ORACLE VERIFIED" section). Two non-obvious results: "Absorbed per damaged tree" binds `pollutionRestoredPerTreeDamage`, and Spoiling rate is the INVERSE `100 / wire`.

- [ ] **Step 1: Write failing component tests in `test/advancedTab.spec.ts`**

First add the codec import at the TOP of the file (with the other imports), then add the new `describe` block below (keep the two existing width/height tests unchanged). The tests mirror the EnemyTab pattern of asserting through `store.activeExchangeString` for the full pipeline. Note the two selector shapes: Price multiplier is a bare `FNumberInput` (its `data-test` lands ON the `<input>`), while the slider rows are `EnemyValueRow` (their `data-test` is on the row `<div>`, so target the nested `input[type="number"]`).

```ts
// top of file, alongside the existing imports:
import { decodeExchangeString } from "../src/codec/mapExchangeString";
```

```ts
describe("AdvancedTab map settings", () => {
  it("renders the new setting rows", () => {
    setActivePinia(createPinia());
    const wrapper = mount(AdvancedTab);
    for (const t of [
      "tech-price-multiplier",
      "pollution-enabled",
      "pollution-ageing",
      "pollution-attack-cost",
      "pollution-min-damage-trees",
      "pollution-absorbed-per-tree",
      "pollution-diffusion",
      "asteroid-spawning-rate",
      "spoiling-rate",
    ]) {
      expect(wrapper.find(`[data-test="${t}"]`).exists(), t).toBe(true);
    }
  });

  it("writes an edited technology price multiplier to the exchange string", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    // Price multiplier is a bare FNumberInput: data-test IS the input element.
    const box = wrapper.find('[data-test="tech-price-multiplier"]');
    (box.element as HTMLInputElement).value = "4";
    await box.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["difficulty.technologyPriceMultiplier"]).toBeCloseTo(4, 6);
  });

  it("writes diffusion ratio at the display scale (percent -> wire)", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const box = wrapper.find('[data-test="pollution-diffusion"] input[type="number"]');
    (box.element as HTMLInputElement).value = "5"; // displayed percent
    await box.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["pollution.diffusionRatio"]).toBeCloseTo(0.05, 6);
  });

  it("writes spoiling rate as the inverse of the wire spoil-time modifier", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const box = wrapper.find('[data-test="spoiling-rate"] input[type="number"]');
    (box.element as HTMLInputElement).value = "200"; // displayed rate %
    await box.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    // rate 200% -> wire 100/200 = 0.5
    expect(tail["difficulty.spoilTimeModifier"]).toBeCloseTo(0.5, 6);
  });

  it("binds 'Absorbed per damaged tree' to pollutionRestoredPerTreeDamage", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    const wrapper = mount(AdvancedTab);
    const box = wrapper.find('[data-test="pollution-absorbed-per-tree"] input[type="number"]');
    (box.element as HTMLInputElement).value = "25";
    await box.trigger("change");
    const tail = decodeExchangeString(store.activeExchangeString as string).tail;
    expect(tail["pollution.pollutionRestoredPerTreeDamage"]).toBe(25);
  });

  it("disables the pollution child rows when pollution is unchecked", async () => {
    setActivePinia(createPinia());
    const store = usePresetsStore();
    store.activePreset!.mapSettings.pollution.enabled = false;
    const wrapper = mount(AdvancedTab);
    const box = wrapper.find('[data-test="pollution-diffusion"] input[type="number"]');
    expect((box.element as HTMLInputElement).disabled).toBe(true);
  });

  it("keeps the property-expression dump available in a collapsed details", () => {
    setActivePinia(createPinia());
    const wrapper = mount(AdvancedTab);
    expect(wrapper.find('[data-test="expr-dump"]').exists()).toBe(true);
    expect(wrapper.find("details").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vp test test/advancedTab.spec.ts`
Expected: FAIL - new `data-test` targets do not exist yet.

- [ ] **Step 3: Rewrite `src/components/AdvancedTab.vue`**

```vue
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
function scaled(read: () => number | undefined, write: (v: number) => void, scale: number) {
  return computed({
    get: () => {
      const v = read();
      // Round away float-multiply noise for the box (e.g. 2.0000000000000004).
      return v === undefined ? 0 : Math.round(v * scale * 1e6) / 1e6;
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
      <FCheckbox v-model="pollution.enabled" label="Pollution" data-test="pollution-enabled" /><FInfo
        :text="INFO.pollution"
      />
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
```

Note: `EnemyValueRow` relies on the `--col-slider` / `--col-box` vars (defined on `.enemy-tab` in EnemyTab); they are re-declared here on `.advanced` so the rows lay out correctly on this tab too.

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `pnpm vp test test/advancedTab.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `pnpm vp test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Lint + commit**

```bash
pnpm vp check --fix
git add src/components/AdvancedTab.vue test/advancedTab.spec.ts
git commit -m "$(cat <<'EOF'
feat(advanced): add Technology, Pollution, Asteroids, Spoiling controls

Reuse EnemyValueRow with per-field display scaling and pollution gating;
tuck the property-expression dump into a collapsed details.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013vLRtrzJyFLLBMUqxyrSZZ
EOF
)"
```

---

### Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + lint clean**

Run: `pnpm vp test` (expect all green) and `pnpm vp check` (expect no errors).

- [ ] **Step 2: Manual app smoke test**

Run `pnpm vp dev`, open the app, go to the Advanced tab. Confirm: each new section renders; editing Price multiplier / a pollution field / spawning rate / spoiling rate updates the exported exchange string (visible via the export UI); unchecking Pollution disables the child rows; importing an untouched builtin preset and re-exporting yields the identical string (byte-exact); the expression dump expands from the collapsed details. Report results (screenshots optional via the `run` skill).

- [ ] **Step 3: Confirm oracle status is recorded**

Verify the spec reflects Task 2's outcome (verified scales/labels/tooltips, or explicitly-flagged deferrals). No code change; this is the completeness gate before finishing the branch.
```

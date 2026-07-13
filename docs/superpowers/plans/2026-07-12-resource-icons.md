# Resource Item Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each resource's Factorio item icon before its name on the Resources tab, matching the in-game map generator.

**Architecture:** Extract twelve 64x64 icons from the local Factorio install (cropping the base tile out of each 128x64 mipmap strip) and commit them as bundled assets. A new `RESOURCE_ICONS` map (control wire-name -> asset URL) mirrors the existing `PLANET_ICONS`. The shared `ControlRow` renders an `<img>` before the label only when the control has an icon, so Terrain/Enemy rows are untouched.

**Tech Stack:** Vue 3 SFCs, Pinia, Vite asset imports, vite-plus/test + @vue/test-utils, `ffmpeg` for one-time icon extraction.

## Global Constraints

- Package manager is **pnpm**; run app tests with `pnpm test` (vite-plus). npx/npm from the repo root fail with EBADDEVENGINES.
- Use **hyphens** (`-`), never em/en dashes, in all files.
- Scope is the **Resources tab only**. Do not add icons to Terrain/Enemy rows.
- Icons are Wube's copyrighted sprites; follow the existing `src/assets/planets/` precedent (committed, downscaled game graphics).
- Factorio install (icon source):
  `/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data`
- Extracted icons are **64x64 RGBA PNGs** in `src/assets/resources/`, same format as the planet icons.

---

## File Structure

- Create: `src/assets/resources/*.png` (12 extracted icons)
- Create: `src/model/resourceIcons.ts` (the `RESOURCE_ICONS` map)
- Create: `test/resourceIcons.spec.ts` (catalog-completeness test)
- Modify: `src/components/ControlRow.vue` (render the icon in the label cell)
- Modify: `test/resourceEnemyTabs.spec.ts` (row-renders-icon test) OR add to a new spec - this plan adds to `test/resourceIcons.spec.ts` to keep icon tests together.

---

## Task 1: Extract icons and build the RESOURCE_ICONS map

**Files:**
- Create: `src/assets/resources/coal.png`, `copper-ore.png`, `crude-oil.png`, `iron-ore.png`, `stone.png`, `uranium-ore.png`, `calcite.png`, `sulfuric-acid-geyser.png`, `tungsten-ore.png`, `scrap.png`, `lithium-brine.png`, `fluorine-vent.png`
- Create: `src/model/resourceIcons.ts`
- Test: `test/resourceIcons.spec.ts`

**Interfaces:**
- Consumes: `controlsForCategory` and `CONTROL_CATALOG` from `src/model/controlCatalog.ts` (existing).
- Produces: `RESOURCE_ICONS: Record<string, string>` from `src/model/resourceIcons.ts` - maps every resource control wire-name to a bundled 64x64 PNG asset URL. Keys: `coal`, `copper-ore`, `crude-oil`, `iron-ore`, `stone`, `uranium-ore`, `vulcanus_coal`, `calcite`, `sulfuric_acid_geyser`, `tungsten_ore`, `gleba_stone`, `scrap`, `lithium_brine`, `aquilo_crude_oil`, `fluorine_vent`.

- [ ] **Step 1: Write the failing test**

Create `test/resourceIcons.spec.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { CONTROL_CATALOG, controlsForCategory } from "../src/model/controlCatalog";
import { RESOURCE_ICONS } from "../src/model/resourceIcons";

describe("resource icons", () => {
  it("maps every resource control to an icon asset URL", () => {
    for (const name of controlsForCategory("resource")) {
      expect(RESOURCE_ICONS[name], name).toBeTruthy();
    }
  });

  it("maps only resource controls (no stray keys)", () => {
    for (const name of Object.keys(RESOURCE_ICONS)) {
      expect(CONTROL_CATALOG[name]?.category, name).toBe("resource");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/resourceIcons.spec.ts`
Expected: FAIL - cannot resolve module `../src/model/resourceIcons`.

- [ ] **Step 3: Extract the 12 icons**

Run this from the repo root (creates the asset dir and crops the leftmost 64x64 base tile out of each 128x64 mipmap strip):

```bash
mkdir -p src/assets/resources
DATA="/Users/ericjohnson/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data"
# source-relative-path  ->  dest basename
while IFS='|' read -r src dst; do
  ffmpeg -y -loglevel error -i "$DATA/$src" -vf "crop=64:64:0:0" "src/assets/resources/$dst"
done <<'MAP'
base/graphics/icons/coal.png|coal.png
base/graphics/icons/copper-ore.png|copper-ore.png
base/graphics/icons/crude-oil-resource.png|crude-oil.png
base/graphics/icons/iron-ore.png|iron-ore.png
base/graphics/icons/stone.png|stone.png
base/graphics/icons/uranium-ore.png|uranium-ore.png
space-age/graphics/icons/calcite.png|calcite.png
space-age/graphics/icons/sulfuric-acid-geyser.png|sulfuric-acid-geyser.png
space-age/graphics/icons/tungsten-ore.png|tungsten-ore.png
space-age/graphics/icons/scrap.png|scrap.png
space-age/graphics/icons/lithium-brine.png|lithium-brine.png
space-age/graphics/icons/fluorine-vent.png|fluorine-vent.png
MAP
```

Verify all 12 exist at 64x64:

```bash
ls src/assets/resources/ | wc -l   # expect 12
sips -g pixelWidth -g pixelHeight src/assets/resources/coal.png | grep pixel  # 64 x 64
```

Expected: 12 files, each 64x64. If `ffmpeg` is missing, install with `brew install ffmpeg`.

- [ ] **Step 4: Create the RESOURCE_ICONS module**

Create `src/model/resourceIcons.ts`:

```ts
import calcite from "../assets/resources/calcite.png";
import coal from "../assets/resources/coal.png";
import copperOre from "../assets/resources/copper-ore.png";
import crudeOil from "../assets/resources/crude-oil.png";
import fluorineVent from "../assets/resources/fluorine-vent.png";
import ironOre from "../assets/resources/iron-ore.png";
import lithiumBrine from "../assets/resources/lithium-brine.png";
import scrap from "../assets/resources/scrap.png";
import stone from "../assets/resources/stone.png";
import sulfuricAcidGeyser from "../assets/resources/sulfuric-acid-geyser.png";
import tungstenOre from "../assets/resources/tungsten-ore.png";
import uraniumOre from "../assets/resources/uranium-ore.png";

/**
 * Resource control wire-name -> bundled 64x64 item-icon asset URL. Coal, Stone,
 * and Crude oil are shared across planets, so 15 controls reuse 12 icons.
 * Mirrors PLANET_ICONS in planets.ts; Vite emits a hashed asset per import.
 */
export const RESOURCE_ICONS: Record<string, string> = {
  // Nauvis
  coal,
  "copper-ore": copperOre,
  "crude-oil": crudeOil,
  "iron-ore": ironOre,
  stone,
  "uranium-ore": uraniumOre,
  // Vulcanus
  vulcanus_coal: coal,
  calcite,
  sulfuric_acid_geyser: sulfuricAcidGeyser,
  tungsten_ore: tungstenOre,
  // Gleba
  gleba_stone: stone,
  // Fulgora
  scrap,
  lithium_brine: lithiumBrine,
  // Aquilo
  aquilo_crude_oil: crudeOil,
  fluorine_vent: fluorineVent,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test test/resourceIcons.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/assets/resources/ src/model/resourceIcons.ts test/resourceIcons.spec.ts
git commit -m "feat(ui): extract resource item icons and map them by control name"
```

---

## Task 2: Render the icon in ControlRow

**Files:**
- Modify: `src/components/ControlRow.vue`
- Test: `test/resourceIcons.spec.ts` (add a component describe block)

**Interfaces:**
- Consumes: `RESOURCE_ICONS` from `src/model/resourceIcons.ts` (Task 1); `ResourcesTab` and `TerrainTab` components; the `usePresetsStore` auto-seeded active preset (its `autoplaceControls` cover all 28 controls, so rows render on a fresh pinia).
- Produces: an `<img data-test="resource-icon">` inside each resource row's label cell.

- [ ] **Step 1: Write the failing test**

Append to `test/resourceIcons.spec.ts`:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ResourcesTab from "../src/components/ResourcesTab.vue";
import TerrainTab from "../src/components/TerrainTab.vue";

describe("resource icons in rows", () => {
  it("renders an item icon with a src on every resource row", () => {
    setActivePinia(createPinia());
    const wrapper = mount(ResourcesTab);
    const icons = wrapper.findAll('[data-test="resource-icon"]');
    expect(icons.length).toBe(15); // 15 resource controls across all planets
    for (const img of icons) {
      expect(img.attributes("src")).toBeTruthy();
    }
  });

  it("renders no item icons on the Terrain tab", () => {
    setActivePinia(createPinia());
    const wrapper = mount(TerrainTab);
    expect(wrapper.findAll('[data-test="resource-icon"]').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/resourceIcons.spec.ts`
Expected: FAIL - `findAll('[data-test="resource-icon"]')` returns 0 on ResourcesTab (no icons rendered yet).

- [ ] **Step 3: Add the icon to ControlRow**

In `src/components/ControlRow.vue`, add the import and computed in `<script setup>` (alongside the existing imports):

```ts
import { RESOURCE_ICONS } from "../model/resourceIcons";
```

Add after the existing `control` computed:

```ts
const icon = computed(() => RESOURCE_ICONS[props.name]);
```

Replace the label cell:

```html
<td class="label">{{ entry.label }}</td>
```

with:

```html
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
```

Add to the `<style scoped>` block:

```css
.resource-icon {
  vertical-align: middle;
  margin-right: 6px;
  image-rendering: pixelated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/resourceIcons.spec.ts`
Expected: PASS (all four tests - the two catalog tests from Task 1 plus the two row tests).

- [ ] **Step 5: Run the full suite and a production build**

Run: `pnpm test`
Expected: all tests pass (no regressions in `resourceEnemyTabs`, `terrainTab`, etc.).

Run: `pnpm build`
Expected: `✓ built`; the 12 icons emit as hashed assets under `dist/assets/`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ControlRow.vue test/resourceIcons.spec.ts
git commit -m "feat(ui): show resource item icons on the Resources tab"
```

- [ ] **Step 7: Visual verification**

Run the app (`pnpm dev`) and open the Resources tab, or use the `run`/`verify` skill to screenshot it. Confirm each resource row shows its item icon before the name (Coal black, Iron ore blue-gray, Copper ore orange, Calcite/Scrap/etc. on their planets), the "Appears on" planet icon is still present, and the Terrain/Enemy tabs are unchanged.

---

## Self-Review

- **Spec coverage:** Extraction (crop 64x64 from 128x64 strips, commit to `src/assets/resources/`) -> Task 1 Step 3. `resourceIcons.ts` `RESOURCE_ICONS` map -> Task 1 Step 4. `ControlRow` conditional `<img>` -> Task 2 Step 3. Catalog-completeness test -> Task 1. Component test (resource row has icon, terrain row does not) -> Task 2. Resources-only scope enforced by the `v-if="icon"` guard and verified by the Terrain-tab test. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; every code and command step is complete and literal.
- **Type consistency:** `RESOURCE_ICONS` is `Record<string, string>` in Task 1 and consumed as such in Task 2; keys match the 15 resource wire-names in `CONTROL_CATALOG`; `data-test="resource-icon"` is identical in the component and the test.

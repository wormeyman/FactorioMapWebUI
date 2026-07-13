# Resource item icons on the Resources tab

Date: 2026-07-12

## Motivation

The real Factorio 2.1.9 map generator shows each resource row with the resource's
item icon before its name (Iron ore, Copper ore, Coal, ...), alongside the
"Appears on" planet icon. Our Resources tab has the name and the "Appears on"
planet icon but no item icon. This adds the item icons so the tab matches the
game.

Scope is the **Resources tab only**. Terrain and Enemy tabs are unchanged (the
shared `ControlRow` renders an icon only when one is mapped, so those rows stay
icon-less until a later change opts them in).

## Assets and licensing

The icons are Wube's copyrighted Factorio sprites. The repo already bundles
Factorio planet icons (`src/assets/planets/`, downscaled from base/space-age
graphics) for the "Appears on" column, so this follows that established
precedent for the fan tool.

Source install (Steam):
`~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data`

## Extraction

Each source icon is a `128x64` horizontal mipmap strip: a `64x64` base tile
followed by smaller mip levels. Extraction crops the leftmost `64x64` tile and
saves it to `src/assets/resources/<name>.png` (same 64x64 RGBA as the planet
icons). Done once with `sips` (macOS built-in), the PNGs committed to the repo -
no build-time image dependency, matching how the planet icons were handled.

12 unique icons cover all 15 resource controls (Coal, Stone, and Crude oil are
shared across planets):

| Icon file (extracted) | Source | Controls using it |
| --- | --- | --- |
| `coal.png` | `base/graphics/icons/coal.png` | `coal`, `vulcanus_coal` |
| `copper-ore.png` | `base/graphics/icons/copper-ore.png` | `copper-ore` |
| `crude-oil.png` | `base/graphics/icons/crude-oil-resource.png` | `crude-oil`, `aquilo_crude_oil` |
| `iron-ore.png` | `base/graphics/icons/iron-ore.png` | `iron-ore` |
| `stone.png` | `base/graphics/icons/stone.png` | `stone`, `gleba_stone` |
| `uranium-ore.png` | `base/graphics/icons/uranium-ore.png` | `uranium-ore` |
| `calcite.png` | `space-age/graphics/icons/calcite.png` | `calcite` |
| `sulfuric-acid-geyser.png` | `space-age/graphics/icons/sulfuric-acid-geyser.png` | `sulfuric_acid_geyser` |
| `tungsten-ore.png` | `space-age/graphics/icons/tungsten-ore.png` | `tungsten_ore` |
| `scrap.png` | `space-age/graphics/icons/scrap.png` | `scrap` |
| `lithium-brine.png` | `space-age/graphics/icons/lithium-brine.png` | `lithium_brine` |
| `fluorine-vent.png` | `space-age/graphics/icons/fluorine-vent.png` | `fluorine_vent` |

Crude oil uses `crude-oil-resource.png` (the resource icon the map generator
shows), not the fluid-barrel icon.

## Architecture

### `src/model/resourceIcons.ts` (new)

`RESOURCE_ICONS: Record<string, string>` maps a control wire-name to its bundled
asset URL, mirroring `PLANET_ICONS` in `planets.ts` (static `import` per PNG so
Vite emits a hashed asset). Kept in its own module so Terrain/Enemy icons can be
added later without disturbing the resource mapping.

### `src/components/ControlRow.vue`

Render a small `<img>` (about 22px, `image-rendering: pixelated` for the pixel
art) before the label, guarded by `v-if="RESOURCE_ICONS[name]"`. Because
`ControlRow` is shared by all tabs, the guard means only resource rows show an
icon; Terrain and Enemy rows are visually unchanged. The `alt` is the control's
label.

No change to `ControlTable`, the catalog, or the `Preset` model - this is
presentation only.

## Testing

- **Catalog completeness.** Every `resource`-category control in
  `CONTROL_CATALOG` has a `RESOURCE_ICONS` entry (fails if a resource is added
  without an icon).
- **Component test.** A Resources-tab row renders an icon `<img>` whose `src` is
  set; a Terrain-tab row renders none.

## Out of scope

- Terrain and Enemy tab icons (same machinery can add them later).
- Any change to control ordering, the codec, or the preset model.

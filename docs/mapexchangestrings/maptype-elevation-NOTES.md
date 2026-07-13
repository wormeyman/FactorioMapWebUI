# Map type (elevation) - oracle capture notes

Source: Factorio 2.1.10 (build 86940), base mod only (isolated
`--mod-directory` loading no space-age), captured headless via a dumper mod
iterating `prototypes.named_noise_expression` filtered on
`intended_property == "elevation"`. Raw dump:
`maptype-elevation-expressions.json`. Labels resolved from
`data/core/locale/en/core.cfg` (`[noise-expression]` / `[noise-expression-name]`).

## The three base-game Map type options

| Expression name  | GUI label (cfg)              | `order` | Exchange `property_expression_names["elevation"]` |
| ---------------- | ---------------------------- | ------- | -------------------------------------------------- |
| `elevation`      | Nauvis elevation             | `""`    | **absent** (technical default; name == property)   |
| `elevation_lakes`| Lakes elevation              | `""`    | `elevation_lakes`                                  |
| `elevation_island`| Island elevation            | `"z"`   | `elevation_island`                                 |

`elevation` is the technical default (its name matches the `elevation`
property), so an absent key resolves to it - corroborated by the read-only
`test/fixtures/builtin-presets.json`: the Default preset has an empty
`property_expression_names`, the Lakes and Ribbon world presets store
`elevation = elevation_lakes`, and the Island preset stores
`elevation = elevation_island`.

## Semantic scope: the Map type dropdown touches only `elevation`

The differences a player associates with the Lakes/Island *presets* (forest
paths disabled, cliffs following the coastline) come from other preset-bundled
keys - e.g. `trees_forest_path_cutout`, `cliffiness`, `cliff_elevation`, plus
the climate `aux`/`moisture` overrides - **not** from the elevation expression.
The base.cfg preset descriptions ("Forest paths are disabled") describe the
whole preset, not the elevation generator. The Map type dropdown selects the
elevation noise expression only; the full-preset load is a separate control.
This is why the editor's Map type control writes only the `elevation` key.

## Model mapping (finalized)

- Nauvis elevation -> default option, `writeValue: null` (default-omission:
  selecting it deletes the key, keeping a Default-based preset byte-identical).
  `readAliases: ["elevation"]` so an explicit technical-default value still reads
  back as Nauvis and is preserved.
- Lakes elevation  -> `writeValue: "elevation_lakes"`.
- Island elevation -> `writeValue: "elevation_island"`.

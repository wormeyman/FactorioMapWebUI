# Test fixtures

Read-only ground truth captured from Factorio 2.1.9. `vite.config.ts` excludes
`test/fixtures/**` from `vp check --fix`, so these are never reformatted - keep
them byte-for-byte as captured.

| File | Source | Purpose |
|------|--------|---------|
| `builtin-presets.json` | Exchange strings exported from the game's map-gen GUI | Byte-exact decode/encode round-trip fixtures for the 9 built-in map types |
| `map-gen-settings.example.json` | `factorio-data` base 2.1.9 (ships with the game) | Authoritative MapGenSettings schema + defaults; comments document GUI-slider mappings (terrain/moisture scale via `property_expression_names`, cliff frequency = 40 / `cliff_elevation_interval`, cliff continuity = `cliff_settings.richness`) |
| `map-settings.example.json` | `factorio-data` base 2.1.9 | Authoritative MapSettings schema + defaults (difficulty, pollution, enemy_evolution, enemy_expansion, unit_group, path_finder, asteroids, max_failed_behavior_count) |
| `map-gen-settings.default-nauvis.dump.json` | Live dump of a Default Nauvis map via `helpers.write_file(..., helpers.table_to_json(game.surfaces.nauvis.map_gen_settings))` | Real MapGenSettings *values* for a default map; pairs with the Default entry in `builtin-presets.json` to correlate wire bytes against named fields for Phase 1b |

Note: the live 2.1.9 MapGenSettings has no top-level `terrain_segmentation` /
`water` - `water` is an `autoplace_control`, and terrain/moisture scale live in
`property_expression_names` (empty on a default map). This differs from the
older schema assumption in the design spec's Appendix A.

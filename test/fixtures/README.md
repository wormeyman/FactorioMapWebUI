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
| `seed-123456789.txt` | Default with the map seed set to 123456789 | Single-field capture that pins the mid-block `seed` (u32) offset |
| `starting-area-diff.txt` | Default with a non-default `starting_area` (1.333...) | Single-field capture that pins the mid-block `starting_area` (f32) offset |
| `defaultgenwithpeaceful.txt` | Default with **peaceful mode ON** | Positive fixture that pins `peaceful_mode`; every builtin is peaceful=false with byte-identical mid-blocks, so a positive example was required |
| `defaultmodenoenemiespeacefulunchecked.txt` | Default with **no-enemies ON**, peaceful off | Positive fixture that pins `no_enemies_mode` and disambiguates it from `peaceful_mode` |
| `starting-points-1-origin.txt` | Minimal Space-Age map (seed 123456), `starting_points` = `[{x:0,y:0}]` | Baseline for the variable-length `starting_points` mid-block trailer |
| `starting-points-1-x450.txt` | Same, `starting_points` = `[{x:450,y:0}]` | Pins the x coordinate (int32, 1/256 fixed-point: 450*256 = 115200 = `00 c2 01 00`) |
| `starting-points-1-y450.txt` | Same, `starting_points` = `[{x:0,y:450}]` | Pins the y coordinate offset independently of x |
| `starting-points-2pt.txt` | Same, `starting_points` = `[{x:0,y:0},{x:450,y:0}]` | Multi-point capture that proves the count byte + variable length (payload grows by one 10-byte point group) |
| `starting-area-5.txt` | Minimal Space-Age map (seed 123456), `starting_area` = `5.0` | Negative control for `area_to_generate_at_start`: a 5x starting_area leaves the box unchanged. Also round-trip coverage for a large `starting_area`. |
| `map-64x64.txt` | Minimal Space-Age map (seed 123456), `width` = `height` = `64` | Negative control for `area_to_generate_at_start`: a tiny finite map leaves the box unchanged. Also round-trip coverage for a small map. |
| `map-exchange-parsed.default-seed123456.dump.json` | In-game dump of `helpers.parse_map_exchange_string(get_map_exchange_string())` for the default seed-123456 map (byte-identical to `starting-points-1-origin.txt`) | Authoritative field-by-field parse from the game itself; the oracle that cross-validates the whole mid-block decoder and confirms `area_to_generate_at_start` is absent from the public MapGenSettings table |

Note on `area_to_generate_at_start` (the former `opaqueRestA`, 24 bytes between
`height` and `starting_area`): it is a vestigial serialization field. It is
absent from the 2.x MapGenSettings Lua type and from
`helpers.parse_map_exchange_string`, and no input moves it - the fixtures above
(varying `starting_area` up to 5.0, map size down to 64x64, `starting_points`,
`seed`) all carry the identical constant `(-224,-224)-(+224,+224)` box, and the
legacy `area_to_generate_at_start` JSON key is silently ignored on map creation.
It is typed structurally (two `0x7fff`-sentinel MapPositions + a 4-byte trailer)
purely for byte-exact round-trip.

Note: the live 2.1.9 MapGenSettings has no top-level `terrain_segmentation` /
`water` - `water` is an `autoplace_control`, and terrain/moisture scale live in
`property_expression_names` (empty on a default map). This differs from the
older schema assumption in the design spec's Appendix A.

# TODO

Forward-looking work items. (Design/plan records live in `docs/superpowers/`;
this file is the lightweight "what's next" list.)

## Decode elevation / "Map type" (make the Map type dropdown live)

**Goal:** Replace the disabled "Map type" placeholder in
`src/components/TerrainTab.vue` (`MAP_TYPE_OPTIONS`, currently the single hard
option "Nauvis elevation (Default)") with the real, selectable map-type /
elevation presets, byte-exact with the Factorio 2.1.9 GUI - the same way the
Moisture/Terrain-type climate controls were shipped.

**What we already know (from the FFF-390 / noise-expression research):**
- Elevation is a named noise **expression**, NOT a `control:<name>:frequency|bias`
  constant (unlike moisture / aux / temperature). So it does **not** fit the
  `climateControls.ts` `{ freqKey, biasKey }` model - expect a different shape
  (a preset selection that writes an expression string, not a slider).
- The codec already round-trips arbitrary `property_expression_names` keys
  opaquely, so imported strings carrying an elevation override are preserved
  today; only the editor is missing.

**Approach (mirrors how climate controls were cracked):**
1. Check the local API mirror first: `factorioLuaAPI/auxiliary/noise-expressions.html`,
   `types/MapGenSettings.html`, and `prototypes/MapGenPresets.html` for how
   map-type / elevation presets are named and represented.
2. Capture in-game (Factorio 2.1.9): set the "Map type" dropdown to each option,
   export the map-exchange string per option, and diff the decoded
   `property_expression_names`. Archive captures under `docs/mapexchangestrings/`
   as committed round-trip fixtures.
3. Confirm exact keys/values with the parse oracle
   (`helpers.parse_map_exchange_string`) via the headless CLI (see CLAUDE.md).
4. Model it (likely an enum/dropdown, not sliders): each option writes the right
   `property_expression_names` entry, with default-omission (the Default option
   deletes the key) so an edited-then-reset preset stays byte-identical.
5. Wire it into the disabled dropdown in `TerrainTab.vue`.

**Open questions to resolve during step 1-2:**
- Does the map-type selection live in `property_expression_names`, or a separate
  `MapGenSettings` field? (Decides codec work vs. model-only.)
- Exact option -> key/value mapping for the base-game presets.
- Is map-type Nauvis-only, like the climate controls?

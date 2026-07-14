# TODO

Forward-looking work items. (Design/plan records live in `docs/superpowers/`;
this file is the lightweight "what's next" list.)

## Open

- **Enemy tab: accurate slider ranges/steps.** The Evolution and Enemy
  expansion sliders currently use placeholder `min`/`max`/`step` values in
  `src/components/EnemyTab.vue` (the number box is the source of truth, so
  values are correct - only the slider feel is provisional). Get the real
  in-game ranges/steps for: evolution time / destroy / pollution factor;
  expansion minimum/maximum distance; evolution group size factor; and
  minimum/maximum cooldown (displayed in minutes, stored as ticks). See
  `docs/superpowers/specs/2026-07-13-enemy-tab-design.md`.

## Shipped

_The elevation / "Map type" dropdown shipped 2026-07-13 (see
`docs/superpowers/specs/2026-07-13-map-type-elevation-design.md`). Terrain-tab
info tooltips (Water, Moisture, Terrain type) shipped 2026-07-13. Enemy-tab
build-out (editable evolution/expansion + moved No-enemies/Peaceful) shipped
2026-07-13 on `feat/enemy-tab`._

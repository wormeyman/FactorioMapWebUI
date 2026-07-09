import { PLANETS, type Planet } from "./planets";

export type ControlCategory = "resource" | "terrain" | "enemy";

export interface ControlEntry {
  planet: Planet;
  category: ControlCategory;
  label: string;
  hasRichness: boolean;
}

function resource(planet: Planet, label: string): ControlEntry {
  return { planet, category: "resource", label, hasRichness: true };
}

function terrain(planet: Planet, label: string): ControlEntry {
  return { planet, category: "terrain", label, hasRichness: false };
}

function enemy(planet: Planet, label: string): ControlEntry {
  return { planet, category: "enemy", label, hasRichness: false };
}

/** All 28 autoplace controls of Factorio 2.1.9 Space Age, keyed by wire name. */
export const CONTROL_CATALOG: Record<string, ControlEntry> = {
  // Nauvis (unprefixed names)
  coal: resource("nauvis", "Coal"),
  "copper-ore": resource("nauvis", "Copper ore"),
  "crude-oil": resource("nauvis", "Crude oil"),
  "iron-ore": resource("nauvis", "Iron ore"),
  stone: resource("nauvis", "Stone"),
  "uranium-ore": resource("nauvis", "Uranium ore"),
  "enemy-base": enemy("nauvis", "Enemy bases"),
  trees: terrain("nauvis", "Trees"),
  water: terrain("nauvis", "Water"),
  rocks: terrain("nauvis", "Rocks"),
  nauvis_cliff: terrain("nauvis", "Cliffs"),
  starting_area_moisture: terrain("nauvis", "Starting area moisture"),
  // Vulcanus
  vulcanus_coal: resource("vulcanus", "Coal"),
  calcite: resource("vulcanus", "Calcite"),
  sulfuric_acid_geyser: resource("vulcanus", "Sulfuric acid geyser"),
  tungsten_ore: resource("vulcanus", "Tungsten ore"),
  vulcanus_volcanism: terrain("vulcanus", "Volcanism"),
  // Gleba
  gleba_stone: resource("gleba", "Stone"),
  gleba_water: terrain("gleba", "Water"),
  gleba_plants: terrain("gleba", "Plants"),
  gleba_cliff: terrain("gleba", "Cliffs"),
  gleba_enemy_base: enemy("gleba", "Enemy bases"),
  // Fulgora
  scrap: resource("fulgora", "Scrap"),
  lithium_brine: resource("fulgora", "Lithium brine"),
  fulgora_cliff: terrain("fulgora", "Cliffs"),
  fulgora_islands: terrain("fulgora", "Islands"),
  // Aquilo
  aquilo_crude_oil: resource("aquilo", "Crude oil"),
  fluorine_vent: resource("aquilo", "Fluorine vent"),
};

export function controlsFor(planet: Planet, category: ControlCategory): string[] {
  return Object.entries(CONTROL_CATALOG)
    .filter(([, entry]) => entry.planet === planet && entry.category === category)
    .map(([name]) => name);
}

/**
 * Every control of a category across all planets, grouped in planet order
 * (Nauvis first), matching the game's single "Appears on"-tagged table.
 */
export function controlsForCategory(category: ControlCategory): string[] {
  return PLANETS.flatMap((planet) => controlsFor(planet, category));
}

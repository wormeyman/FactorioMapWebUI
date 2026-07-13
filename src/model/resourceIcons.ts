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
  // Aquilo
  aquilo_crude_oil: crudeOil,
  lithium_brine: lithiumBrine,
  fluorine_vent: fluorineVent,
};

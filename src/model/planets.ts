import aquiloIcon from "../assets/planets/aquilo.png";
import fulgoraIcon from "../assets/planets/fulgora.png";
import glebaIcon from "../assets/planets/gleba.png";
import nauvisIcon from "../assets/planets/nauvis.png";
import vulcanusIcon from "../assets/planets/vulcanus.png";

export const PLANETS = ["nauvis", "vulcanus", "gleba", "fulgora", "aquilo"] as const;

export type Planet = (typeof PLANETS)[number];

export const PLANET_LABELS: Record<Planet, string> = {
  nauvis: "Nauvis",
  vulcanus: "Vulcanus",
  gleba: "Gleba",
  fulgora: "Fulgora",
  aquilo: "Aquilo",
};

/**
 * The game's round "starmap" planet icons (from base/space-age graphics,
 * downscaled), used in the "Appears on" column. Bundled via Vite so each
 * resolves to a hashed asset URL.
 */
export const PLANET_ICONS: Record<Planet, string> = {
  nauvis: nauvisIcon,
  vulcanus: vulcanusIcon,
  gleba: glebaIcon,
  fulgora: fulgoraIcon,
  aquilo: aquiloIcon,
};

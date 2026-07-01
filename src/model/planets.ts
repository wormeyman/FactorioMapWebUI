export const PLANETS = ["nauvis", "vulcanus", "gleba", "fulgora", "aquilo"] as const;

export type Planet = (typeof PLANETS)[number];

export const PLANET_LABELS: Record<Planet, string> = {
  nauvis: "Nauvis",
  vulcanus: "Vulcanus",
  gleba: "Gleba",
  fulgora: "Fulgora",
  aquilo: "Aquilo",
};

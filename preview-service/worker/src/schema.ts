export const PLANETS = ["nauvis", "vulcanus", "gleba", "fulgora", "aquilo"] as const;
export type Planet = (typeof PLANETS)[number];

export interface PreviewRequest {
  mapGenSettings: Record<string, unknown>;
  planet: Planet;
  seed: number;
  size: number;
}

const U32_MAX = 0xffffffff;

export function parsePreviewRequest(
  body: unknown,
): { ok: true; value: PreviewRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (typeof b.mapGenSettings !== "object" || b.mapGenSettings === null || Array.isArray(b.mapGenSettings)) {
    return { ok: false, error: "mapGenSettings must be an object" };
  }
  if (!PLANETS.includes(b.planet as Planet)) return { ok: false, error: "unknown planet" };
  if (typeof b.seed !== "number" || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > U32_MAX) {
    return { ok: false, error: "seed must be a u32 integer" };
  }
  if (b.size !== 1024) return { ok: false, error: "size must be 1024" };
  return {
    ok: true,
    value: {
      mapGenSettings: b.mapGenSettings as Record<string, unknown>,
      planet: b.planet as Planet,
      seed: b.seed,
      size: b.size,
    },
  };
}

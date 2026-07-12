import { toMapGenSettingsJson } from "./jsonExport";
import type { Preset } from "../model/types";
import type { Planet } from "../model/planets";
import { PREVIEW_SERVICE_URL } from "../config";

export interface PreviewRequest {
  mapGenSettings: Record<string, unknown>;
  planet: Planet;
  seed: number;
  size: number;
}

export class PreviewError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PreviewError";
    this.status = status;
  }
}

/**
 * Build a preview request for `preset` on `planet` at a concrete `seed`. The
 * caller owns seed selection (the preset seed, or a sticky random one for a
 * null-seed preset) so repeated renders stay stable; this function just
 * reconciles the chosen seed into the mgs body to match `--map-gen-seed`.
 */
export function buildPreviewRequest(preset: Preset, planet: Planet, seed: number): PreviewRequest {
  const mapGenSettings = toMapGenSettingsJson(preset) as Record<string, unknown>;
  mapGenSettings.seed = seed;
  return { mapGenSettings, planet, seed, size: 1024 };
}

export async function postPreview(req: PreviewRequest): Promise<Blob> {
  const res = await fetch(`${PREVIEW_SERVICE_URL}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new PreviewError(res.status, await res.text().catch(() => res.statusText));
  return await res.blob();
}

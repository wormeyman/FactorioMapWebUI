import { toMapGenSettingsJson } from "./jsonExport";
import type { Preset } from "../model/types";
import type { Planet } from "../model/planets";
import { randomU32 } from "../util/seed";
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

export function buildPreviewRequest(preset: Preset, planet: Planet): PreviewRequest {
  const seed = preset.seed ?? randomU32();
  const mapGenSettings = toMapGenSettingsJson(preset) as Record<string, unknown>;
  mapGenSettings.seed = seed; // reconcile: concrete seed in body matches --map-gen-seed
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

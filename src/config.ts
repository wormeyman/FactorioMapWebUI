/** Base URL of the map-preview render service (Cloudflare Worker). */
export const PREVIEW_SERVICE_URL: string =
  (import.meta.env.VITE_PREVIEW_SERVICE_URL as string | undefined) ?? "";

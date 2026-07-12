import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// vitest-pool-workers 0.18+ (vitest v4) exposes a Vite plugin `cloudflareTest`
// instead of the old `defineWorkersConfig` from the `/config` subpath.
//
// Until the worker entry + bindings exist (Tasks 6-8), boot the test runtime
// with an inline miniflare config. Task 7 switches this to the wrangler config
// (`wrangler: { configPath: "./wrangler.jsonc" }`) so DO/R2 bindings are wired.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-01",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
});

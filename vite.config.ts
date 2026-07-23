import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // `vue()` is cast to vite-plus's own `Plugin` type deliberately. Under vp
  // 0.2.6's tsgolint-7 type-check engine, `@vitejs/plugin-vue`'s return type
  // (which references its own bundled Vite's `Plugin`) makes the whole config
  // object exceed TypeScript's comparison-depth limit against `UserConfig`,
  // producing a spurious `TS2321: Excessive stack depth`. Casting the plugin
  // to the `Plugin` type vite-plus already expects collapses that comparison
  // without suppressing type-checking of the rest of the config. See
  // https://github.com/voidzero-dev/vite-plus/issues/2010 (comment thread).
  plugins: [vue() as Plugin],
  build: {
    rollupOptions: {
      // `zlib-asm` uses direct `eval`, which is load-bearing: it is the only
      // deflate implementation that reproduces the game's zlib@9 stream
      // byte-for-byte, so the codec's byte-exactness invariant depends on it.
      // Drop that one module's EVAL warning rather than setting
      // `checks.eval = false`, so a direct `eval` introduced anywhere else
      // still surfaces.
      onLog(level, log, handler) {
        if (log.code === "EVAL" && log.id?.includes("/zlib-asm/")) return;
        // Same module, second symptom: zlib-asm's Node fallback path imports
        // `fs`/`path`, which the browser build externalizes and warns about.
        // Those imports are never reached in the browser (the asm.js module is
        // self-contained), so the warning is noise. Matched on the importer
        // path as well as the message, so an externalized builtin imported by
        // any *other* module still warns.
        if (
          log.plugin === "rolldown:vite-resolve" &&
          log.message?.includes("has been externalized for browser compatibility") &&
          log.message.includes("/zlib-asm/")
        ) {
          return;
        }
        handler(level, log);
      },
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        // `expect(mock.terminate).toHaveBeenCalled()` reads a method without
        // calling it, which is exactly the shape `unbound-method` flags - but
        // passing the reference to `expect` is the point, not a `this` bug.
        files: ["test/**/*.spec.ts"],
        rules: {
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    // App tests live in `test/`. Exclude `preview-service/**`, which has its own
    // Worker (pool-workers) and container (node:test) runners.
    include: ["test/**/*.spec.ts"],
  },
  // Never reformat the byte-verified spec docs or the read-only fixture
  // ground truth - `vp check --fix` would otherwise rewrite them on every run.
  fmt: {
    ignorePatterns: ["docs/**", "test/fixtures/**"],
  },
});

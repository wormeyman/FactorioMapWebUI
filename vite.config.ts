import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
  },
  // Never reformat the byte-verified spec docs or the read-only fixture
  // ground truth - `vp check --fix` would otherwise rewrite them on every run.
  fmt: {
    ignorePatterns: ["docs/**", "test/fixtures/**"],
  },
});

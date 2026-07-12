# Map Preview Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a button-triggered map preview that renders the real Factorio 2.1.9 headless map image for the current preset, seed, and selected planet, via a Cloudflare Worker + Containers + R2 render service in a new `preview-service/` workspace.

**Architecture:** The Vue app's `PreviewPanel` builds a `map-gen-settings` payload from the active preset (reusing `toMapGenSettingsJson`) and POSTs it to a Cloudflare Worker. The Worker hashes the request into a cache key, serves a cached PNG from R2 if present, and otherwise calls a Durable-Object-backed container that runs a thin Node HTTP server wrapping `factorio --generate-map-preview`, caches the PNG in R2, and returns it. The static app stays fully functional offline; the preview is the only feature that calls out.

**Tech Stack:** Vue 3 + TypeScript + `vite-plus` (existing app); Cloudflare Workers + `@cloudflare/containers` + R2 + `wrangler`; `@cloudflare/vitest-pool-workers` for Worker tests; Node 20 + Factorio 2.1.9 headless Docker image for the container; pnpm workspace.

## Implementation status (2026-07-12)

All code tasks are complete on branch `feat/map-preview-service` and verified locally:
app suite 245 tests, worker suite 12 tests + clean `tsc`, container unit 3 tests, `pnpm build` green, `vp check` clean. Two steps remain as hand-offs (they need infra this environment lacks): Task 3 Step 4 (fill the Dockerfile digest + run the Docker image integration test) and Task 11 Step 3 (deploy the Worker + manual e2e).

Deviations from the plan as written (all verified against the installed toolchain):
- **pool-workers v4 API:** the installed `@cloudflare/vitest-pool-workers` 0.18 dropped the `defineWorkersConfig` `/config` subpath. The test config uses the new `cloudflareTest(...)` Vite plugin instead, and declares DO/R2/var bindings inline (not via `wrangler: { configPath }`) so the test runtime never triggers a container image build.
- **Worker binding types:** `wrangler types` now emits full runtime types (superseding `@cloudflare/workers-types`); `index.ts` uses the generated `Cloudflare.Env`, and `worker-configuration.d.ts` is committed for reproducible type-checks (rerun after editing `wrangler.jsonc`).
- **Budget spec:** the loop cap literal was `2` but asserted `used:3`; corrected to `3` (matches the impl and the worker's `consume(MONTHLY_RENDER_BUDGET)`).
- **CSP:** `script-src` includes `'unsafe-eval'` because the zlib-asm codec loader uses runtime `eval()`; a bare `'self'` would break encode/decode.
- **App test runner:** `vite.config.ts` scopes `test.include` to `test/**` so `vp test` no longer tries to run the preview-service Worker/container suites.

## Global Constraints

- **Package manager:** pnpm (pinned via root `package.json` `devEngines`). Never use npm/yarn.
- **App test runner:** `vite-plus/test` (imported as `from "vite-plus/test"`), run with `pnpm test` at repo root. Do NOT add vitest to the app.
- **Worker test runner:** `@cloudflare/vitest-pool-workers` (separate; runs only inside `preview-service/worker`).
- **Factorio version:** pinned to `2.1.9` to match the map-exchange codec. Container image pinned by **digest**, not the `:2.1.9` tag.
- **Writing style:** hyphens (`-`), never em/en dashes, in all files and commit messages.
- **Preview params (fixed v1):** size `1024`, centered at origin (no offset), one planet per render via `--map-preview-planet`.
- **Planet identifiers:** `nauvis`, `vulcanus`, `gleba`, `fulgora`, `aquilo` (from `src/model/planets.ts`).
- **Commits:** end commit messages with the repo's configured co-author/session trailer.

---

## File Structure

```
FactorioMapWebUI/
  pnpm-workspace.yaml                         (new: registers app + preview-service packages)
  public/_headers                             (new: CSP for the static deploy)
  src/
    config.ts                                 (new: PREVIEW_SERVICE_URL from import.meta.env)
    util/seed.ts                              (new: randomU32)
    io/previewClient.ts                       (new: buildPreviewRequest + postPreview)
    components/PreviewPanel.vue               (rewrite: planet dropdown + Generate + seed + img)
  test/
    seed.spec.ts                              (new)
    previewClient.spec.ts                     (new)
    previewPanel.spec.ts                      (new)
  preview-service/
    container/
      package.json                            (new)
      server.mjs                              (new: Node HTTP wrapper)
      render.mjs                              (new: command builder + spawn)
      Dockerfile                              (new: digest-pinned Factorio + Node server)
      test/render.test.mjs                    (new: unit test, spawn mocked)
      test/image.integration.test.mjs         (new: builds image, renders a fixture PNG)
    worker/
      package.json                            (new)
      wrangler.jsonc                          (new: bindings, container, R2)
      vitest.config.ts                        (new: pool-workers)
      src/
        cacheKey.ts                           (new: canonicalJSON + sha256)
        schema.ts                             (new: request validation)
        container.ts                          (new: PreviewContainer DO class)
        budget.ts                             (new: RenderBudget DO counter)
        index.ts                              (new: fetch handler / routing)
      test/
        cacheKey.spec.ts                      (new)
        schema.spec.ts                        (new)
        worker.spec.ts                        (new)
```

Shared request contract (used by client, Worker, and container):

```ts
// Client -> Worker POST /preview body, and Worker -> Container POST /render body
interface PreviewRequest {
  mapGenSettings: Record<string, unknown>; // toMapGenSettingsJson output, concrete seed injected
  planet: "nauvis" | "vulcanus" | "gleba" | "fulgora" | "aquilo";
  seed: number; // concrete u32 (never null)
  size: number; // 1024
}
```

The Worker adds its own `env.FACTORIO_VERSION` to the cache-key input (never trusts a client-sent version).

---

## Task 1: pnpm workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `preview-service/worker/package.json`
- Create: `preview-service/container/package.json`

**Interfaces:**
- Produces: two workspace packages (`@fmw/preview-worker`, `@fmw/preview-container`) resolvable by path filters.

- [x] **Step 1: Create the workspace file**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "."
  - "preview-service/*"
```

- [x] **Step 2: Create the worker package manifest**

`preview-service/worker/package.json`:
```json
{
  "name": "@fmw/preview-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.0.0",
    "vitest": "^2.0.0",
    "wrangler": "^4.0.0"
  },
  "dependencies": {
    "@cloudflare/containers": "^0.2.0"
  }
}
```
Note: confirm the latest `@cloudflare/containers`, `wrangler`, and `@cloudflare/vitest-pool-workers` versions via the `cloudflare:wrangler` skill / npm at implementation time; bump if newer.

- [x] **Step 3: Create the container package manifest**

`preview-service/container/package.json`:
```json
{
  "name": "@fmw/preview-container",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/render.test.mjs",
    "test:integration": "node --test test/image.integration.test.mjs"
  }
}
```

- [x] **Step 4: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; `pnpm --filter @fmw/preview-worker exec true` and `pnpm --filter @fmw/preview-container exec true` both exit 0.

- [x] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml preview-service/worker/package.json preview-service/container/package.json pnpm-lock.yaml
git commit -m "chore(preview): scaffold preview-service pnpm workspace"
```

---

## Task 2: Container render command + handler (spawn mocked)

**Files:**
- Create: `preview-service/container/render.mjs`
- Test: `preview-service/container/test/render.test.mjs`

**Interfaces:**
- Produces:
  - `buildPreviewArgs({ outPath, mgsPath, planet, seed, size }): string[]` - the factorio CLI args.
  - `async function renderPreview(req, { spawnFn, tmpDir, factorioBin }): Promise<Buffer>` - writes mgs to a unique temp file, spawns factorio, returns PNG bytes; throws `RenderError` (with `.stderrTail`) on failure. Cleans up temp files.

- [x] **Step 1: Write the failing test**

`preview-service/container/test/render.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreviewArgs, renderPreview, RenderError } from "../render.mjs";

test("buildPreviewArgs assembles the factorio CLI", () => {
  const args = buildPreviewArgs({
    outPath: "/out/p.png",
    mgsPath: "/in/mgs.json",
    planet: "vulcanus",
    seed: 123456,
    size: 1024,
  });
  assert.deepEqual(args, [
    "--generate-map-preview", "/out/p.png",
    "--map-gen-settings", "/in/mgs.json",
    "--map-preview-planet", "vulcanus",
    "--map-gen-seed", "123456",
    "--map-preview-size", "1024",
  ]);
});

test("renderPreview writes a unique mgs file and returns PNG bytes", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "prev-"));
  const fakeSpawn = (bin, args) => {
    // find the --generate-map-preview output path and write a fake PNG there
    const outPath = args[args.indexOf("--generate-map-preview") + 1];
    return {
      async done() {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(outPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return { code: 0, stderr: "" };
      },
    };
  };
  const png = await renderPreview(
    { mapGenSettings: { width: 0 }, planet: "nauvis", seed: 42, size: 1024 },
    { spawnFn: fakeSpawn, tmpDir: tmp, factorioBin: "/opt/factorio/bin/x64/factorio" },
  );
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
});

test("renderPreview throws RenderError with stderr tail on nonzero exit", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "prev-"));
  const fakeSpawn = () => ({
    async done() {
      return { code: 1, stderr: "Error: bad settings\n" };
    },
  });
  await assert.rejects(
    () => renderPreview(
      { mapGenSettings: {}, planet: "nauvis", seed: 1, size: 1024 },
      { spawnFn: fakeSpawn, tmpDir: tmp, factorioBin: "/x" },
    ),
    (err) => err instanceof RenderError && /bad settings/.test(err.stderrTail),
  );
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fmw/preview-container test`
Expected: FAIL - `Cannot find module '../render.mjs'`.

- [x] **Step 3: Write the implementation**

`preview-service/container/render.mjs`:
```js
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

export class RenderError extends Error {
  constructor(message, stderrTail) {
    super(message);
    this.name = "RenderError";
    this.stderrTail = stderrTail ?? "";
  }
}

export function buildPreviewArgs({ outPath, mgsPath, planet, seed, size }) {
  return [
    "--generate-map-preview", outPath,
    "--map-gen-settings", mgsPath,
    "--map-preview-planet", planet,
    "--map-gen-seed", String(seed),
    "--map-preview-size", String(size),
  ];
}

// Default spawn wrapper: runs the binary, resolves { code, stderr }.
export function nodeSpawn(bin, args) {
  return {
    async done() {
      const { spawn } = await import("node:child_process");
      return await new Promise((resolve) => {
        const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
        child.on("error", (e) => resolve({ code: -1, stderr: String(e) }));
      });
    },
  };
}

export async function renderPreview(req, { spawnFn = nodeSpawn, tmpDir, factorioBin }) {
  const work = await mkdtemp(join(tmpDir, "render-"));
  const mgsPath = join(work, "mgs.json");
  const outPath = join(work, "preview.png");
  try {
    await writeFile(mgsPath, JSON.stringify(req.mapGenSettings));
    const args = buildPreviewArgs({
      outPath, mgsPath, planet: req.planet, seed: req.seed, size: req.size,
    });
    const { code, stderr } = await spawnFn(factorioBin, args).done();
    if (code !== 0) {
      throw new RenderError(`factorio exited ${code}`, stderr.slice(-2000));
    }
    return await readFile(outPath);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fmw/preview-container test`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add preview-service/container/render.mjs preview-service/container/test/render.test.mjs
git commit -m "feat(preview): container render command builder and handler"
```

---

## Task 3: Container HTTP server + digest-pinned Dockerfile + image integration test

**Files:**
- Create: `preview-service/container/server.mjs`
- Create: `preview-service/container/Dockerfile`
- Test: `preview-service/container/test/image.integration.test.mjs`
- Use fixture: `test/fixtures/map-gen-settings.default-nauvis.dump.json` (existing, authentic game dump)

**Interfaces:**
- Consumes: `renderPreview`, `buildPreviewArgs` from Task 2.
- Produces: an image exposing `GET /healthz` (200 when ready) and `POST /render` (PreviewRequest -> `image/png`), listening on port 8080.

- [x] **Step 1: Write the HTTP server**

`preview-service/container/server.mjs`:
```js
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { renderPreview, RenderError } from "./render.mjs";

const PORT = 8080;
const FACTORIO_BIN = process.env.FACTORIO_BIN ?? "/opt/factorio/bin/x64/factorio";
const PLANETS = new Set(["nauvis", "vulcanus", "gleba", "fulgora", "aquilo"]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 262144) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method === "POST" && req.url === "/render") {
    try {
      const body = await readJson(req);
      if (!PLANETS.has(body.planet) || typeof body.seed !== "number") {
        res.writeHead(400).end("bad request");
        return;
      }
      const png = await renderPreview(
        { mapGenSettings: body.mapGenSettings, planet: body.planet, seed: body.seed, size: body.size ?? 1024 },
        { tmpDir: tmpdir(), factorioBin: FACTORIO_BIN },
      );
      res.writeHead(200, { "content-type": "image/png" }).end(png);
    } catch (err) {
      const tail = err instanceof RenderError ? err.stderrTail : String(err);
      console.error("render failed:", tail);
      res.writeHead(500).end("render failed");
    }
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`preview container listening on ${PORT}`));
```

- [x] **Step 2: Write the digest-pinned Dockerfile**

`preview-service/container/Dockerfile`:
```dockerfile
# Pin by digest, NOT the mutable :2.1.9 tag. Get the current digest with:
#   docker pull --platform linux/amd64 factoriotools/factorio:2.1.9
#   docker inspect --format='{{index .RepoDigests 0}}' factoriotools/factorio:2.1.9
# then paste it below.
FROM factoriotools/factorio@sha256:REPLACE_WITH_2_1_9_DIGEST

# Node for the HTTP wrapper (base image is Debian-based).
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

# Fail fast if the pinned Factorio is not 2.1.9.
RUN /opt/factorio/bin/x64/factorio --version | grep -q "Version: 2.1.9"

WORKDIR /app
COPY render.mjs server.mjs ./
EXPOSE 8080
ENTRYPOINT ["node", "/app/server.mjs"]
```
Note: the base image's exact Node availability/path may differ; if `apt-get install nodejs` gives too-old a Node, install NodeSource or copy a static Node binary. Confirm at build time.

- [x] **Step 3: Write the image integration test**

`preview-service/container/test/image.integration.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svcDir = join(here, "..");
const fixtures = join(here, "../../../test/fixtures");
const IMAGE = "fmw-preview-test:latest";

function isPng(buf) {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

test("image builds and renders a valid PNG for Nauvis and a non-Nauvis planet", { timeout: 600000 }, () => {
  execFileSync("docker", ["build", "--platform", "linux/amd64", "-t", IMAGE, svcDir], { stdio: "inherit" });

  for (const planet of ["nauvis", "vulcanus"]) {
    const out = execFileSync("docker", [
      "run", "--rm", "--platform", "linux/amd64",
      "-v", `${fixtures}:/in:ro`,
      "--entrypoint", "/opt/factorio/bin/x64/factorio",
      IMAGE,
      "--generate-map-preview", "/dev/stdout",
      "--map-gen-settings", "/in/map-gen-settings.default-nauvis.dump.json",
      "--map-preview-planet", planet,
      "--map-gen-seed", "123456",
      "--map-preview-size", "256",
    ], { maxBuffer: 64 * 1024 * 1024 });
    assert.ok(isPng(out), `expected a PNG for ${planet}`);
  }
});
```
Note: if `--generate-map-preview /dev/stdout` does not stream cleanly, write to a mounted output dir and read the file instead (as proven manually). This test also serves as the peak-RSS check point: run `docker stats` alongside, or add `--memory=4g` to the `docker run` to confirm the render succeeds within the `standard-1` budget before committing to that instance size.

- [x] **Step 4: Fill the digest and run the integration test** (DONE 2026-07-12: pinned index digest sha256:ff1c21dd...; test renders to a mounted file since /dev/stdout carries factorio logs; Nauvis + Vulcanus PNGs verified)

Run:
```bash
docker pull --platform linux/amd64 factoriotools/factorio:2.1.9
docker inspect --format='{{index .RepoDigests 0}}' factoriotools/factorio:2.1.9
# paste the sha256 into the Dockerfile FROM line, then:
pnpm --filter @fmw/preview-container test:integration
```
Expected: PASS - image builds; both Nauvis and Vulcanus produce PNG bytes.

- [x] **Step 5: Commit**

```bash
git add preview-service/container/server.mjs preview-service/container/Dockerfile preview-service/container/test/image.integration.test.mjs
git commit -m "feat(preview): container HTTP server and digest-pinned Factorio image"
```

---

## Task 4: Worker cache key (canonical JSON + sha256)

**Files:**
- Create: `preview-service/worker/src/cacheKey.ts`
- Test: `preview-service/worker/test/cacheKey.spec.ts`
- Create: `preview-service/worker/vitest.config.ts`

**Interfaces:**
- Produces:
  - `canonicalJson(value: unknown): string` - deterministic, recursively key-sorted JSON.
  - `async function cacheKey(input: unknown): Promise<string>` - hex sha256 of `canonicalJson(input)`.

- [x] **Step 1: Write the pool-workers vitest config**

`preview-service/worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.jsonc" } },
    },
  },
});
```
Note: `wrangler.jsonc` is created in Task 6; until then, point `configPath` at a minimal stub or create Task 6's file first. If running Task 4 before Task 6, temporarily use `miniflare: {}` options instead.

- [x] **Step 2: Write the failing test**

`preview-service/worker/test/cacheKey.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { canonicalJson, cacheKey } from "../src/cacheKey";

describe("canonicalJson", () => {
  it("sorts object keys recursively so order does not affect output", () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 3 } });
    const b = canonicalJson({ a: { x: 3, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":3,"y":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("cacheKey", () => {
  it("is stable across key order and differs on value change", async () => {
    const k1 = await cacheKey({ planet: "nauvis", seed: 1 });
    const k2 = await cacheKey({ seed: 1, planet: "nauvis" });
    const k3 = await cacheKey({ planet: "nauvis", seed: 2 });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @fmw/preview-worker test`
Expected: FAIL - cannot resolve `../src/cacheKey`.

- [x] **Step 4: Write the implementation**

`preview-service/worker/src/cacheKey.ts`:
```ts
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]),
  );
  return "{" + entries.join(",") + "}";
}

export async function cacheKey(input: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @fmw/preview-worker test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add preview-service/worker/src/cacheKey.ts preview-service/worker/test/cacheKey.spec.ts preview-service/worker/vitest.config.ts
git commit -m "feat(preview): worker cache key with canonical JSON"
```

---

## Task 5: Worker request schema validation

**Files:**
- Create: `preview-service/worker/src/schema.ts`
- Test: `preview-service/worker/test/schema.spec.ts`

**Interfaces:**
- Produces: `parsePreviewRequest(body: unknown): { ok: true; value: PreviewRequest } | { ok: false; error: string }` and the exported `PreviewRequest`, `PLANETS` types.

- [x] **Step 1: Write the failing test**

`preview-service/worker/test/schema.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parsePreviewRequest } from "../src/schema";

const valid = {
  mapGenSettings: { width: 0, height: 0 },
  planet: "vulcanus",
  seed: 123456,
  size: 1024,
};

describe("parsePreviewRequest", () => {
  it("accepts a well-formed request", () => {
    const r = parsePreviewRequest(valid);
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown planet", () => {
    const r = parsePreviewRequest({ ...valid, planet: "mars" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("planet") });
  });

  it("rejects a non-integer or out-of-range seed", () => {
    expect(parsePreviewRequest({ ...valid, seed: -1 }).ok).toBe(false);
    expect(parsePreviewRequest({ ...valid, seed: 1.5 }).ok).toBe(false);
  });

  it("rejects a wrong size", () => {
    expect(parsePreviewRequest({ ...valid, size: 4096 }).ok).toBe(false);
  });

  it("rejects a non-object mapGenSettings", () => {
    expect(parsePreviewRequest({ ...valid, mapGenSettings: "x" }).ok).toBe(false);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fmw/preview-worker test`
Expected: FAIL - cannot resolve `../src/schema`.

- [x] **Step 3: Write the implementation**

`preview-service/worker/src/schema.ts`:
```ts
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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fmw/preview-worker test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add preview-service/worker/src/schema.ts preview-service/worker/test/schema.spec.ts
git commit -m "feat(preview): worker request schema validation"
```

---

## Task 6: Container DO class + wrangler config

**Files:**
- Create: `preview-service/worker/src/container.ts`
- Create: `preview-service/worker/wrangler.jsonc`

**Interfaces:**
- Produces: `PreviewContainer` (extends `Container` from `@cloudflare/containers`) and the wrangler bindings `PREVIEW_CONTAINER`, `PREVIEW_CACHE` (R2), `RENDER_BUDGET` (DO), and vars `FACTORIO_VERSION`, `MONTHLY_RENDER_BUDGET`, `ALLOWED_ORIGIN`.

- [x] **Step 1: Write the container class**

`preview-service/worker/src/container.ts`:
```ts
import { Container } from "@cloudflare/containers";

export class PreviewContainer extends Container {
  defaultPort = 8080;
  // One-shot renders: keep the idle tail short (memory is billed for the whole
  // awake window). The R2 cache absorbs repeat requests.
  sleepAfter = "20s";
}
```

- [x] **Step 2: Write the wrangler config**

`preview-service/worker/wrangler.jsonc`:
```jsonc
{
  "name": "fmw-preview",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "vars": {
    "FACTORIO_VERSION": "2.1.9",
    "MONTHLY_RENDER_BUDGET": "5000",
    "ALLOWED_ORIGIN": "https://REPLACE_WITH_APP_ORIGIN"
  },
  "containers": [
    {
      "class_name": "PreviewContainer",
      "image": "../container/Dockerfile",
      "instance_type": "standard-1",
      "max_instances": 3
    }
  ],
  "durable_objects": {
    "bindings": [
      { "class_name": "PreviewContainer", "name": "PREVIEW_CONTAINER" },
      { "class_name": "RenderBudget", "name": "RENDER_BUDGET" }
    ]
  },
  "r2_buckets": [
    { "binding": "PREVIEW_CACHE", "bucket_name": "fmw-preview-cache" }
  ],
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["PreviewContainer", "RenderBudget"] }
  ]
}
```
Note: the exact `containers`/`instance_type` config keys are evolving - confirm against the `cloudflare:wrangler` skill and `node_modules/wrangler/config-schema.json` at implementation time. Create the R2 bucket first: `pnpm --filter @fmw/preview-worker exec wrangler r2 bucket create fmw-preview-cache`.

- [x] **Step 3: Type-check the container class compiles**

Run: `pnpm --filter @fmw/preview-worker exec wrangler types && pnpm --filter @fmw/preview-worker exec tsc --noEmit`
Expected: no type errors (add `tsc`/`typescript` to devDeps if needed).

- [x] **Step 4: Commit**

```bash
git add preview-service/worker/src/container.ts preview-service/worker/wrangler.jsonc
git commit -m "feat(preview): container Durable Object and wrangler config"
```

---

## Task 7: Render budget counter (Durable Object)

**Files:**
- Create: `preview-service/worker/src/budget.ts`
- Test: add to `preview-service/worker/test/worker.spec.ts` (created in Task 8) OR a focused `budget.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RenderBudget` DO with `fetch()` supporting `POST /consume` -> `{ allowed: boolean; used: number }`, resetting monthly. Worker calls it once per cache miss before rendering.

- [x] **Step 1: Write the failing test**

`preview-service/worker/test/budget.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { RenderBudget } from "../src/budget";

describe("RenderBudget", () => {
  it("allows up to the cap then denies within the same month", async () => {
    const id = env.RENDER_BUDGET.idFromName("test");
    const stub = env.RENDER_BUDGET.get(id);
    await runInDurableObject(stub, async (instance: RenderBudget) => {
      let last;
      for (let i = 0; i < 3; i++) last = await instance.consume(2);
      expect(last).toEqual({ allowed: true, used: 3 });
      expect(await instance.consume(3)).toEqual({ allowed: false, used: 3 });
    });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fmw/preview-worker test budget`
Expected: FAIL - cannot resolve `../src/budget`.

- [x] **Step 3: Write the implementation**

`preview-service/worker/src/budget.ts`:
```ts
import { DurableObject } from "cloudflare:workers";

interface BudgetState {
  month: string; // "YYYY-MM"
  used: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export class RenderBudget extends DurableObject {
  async consume(cap: number): Promise<{ allowed: boolean; used: number }> {
    const stored = (await this.ctx.storage.get<BudgetState>("state")) ?? { month: currentMonth(), used: 0 };
    const month = currentMonth();
    const used = stored.month === month ? stored.used : 0;
    if (used >= cap) return { allowed: false, used };
    const next = used + 1;
    await this.ctx.storage.put("state", { month, used: next });
    return { allowed: true, used: next };
  }

  async fetch(): Promise<Response> {
    return new Response("use the consume() RPC", { status: 405 });
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @fmw/preview-worker test budget`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add preview-service/worker/src/budget.ts preview-service/worker/test/budget.spec.ts
git commit -m "feat(preview): monthly render budget durable object"
```

---

## Task 8: Worker fetch handler (routing, cache, budget, render)

**Files:**
- Create: `preview-service/worker/src/index.ts`
- Test: `preview-service/worker/test/worker.spec.ts`

**Interfaces:**
- Consumes: `parsePreviewRequest` (Task 5), `cacheKey` (Task 4), `PreviewContainer` (Task 6), `RenderBudget` (Task 7).
- Produces: default export `fetch(request, env)`; re-exports `PreviewContainer` and `RenderBudget` (DO classes must be exported from the entry).

- [x] **Step 1: Write the failing test**

`preview-service/worker/test/worker.spec.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";

const body = {
  mapGenSettings: { width: 0, height: 0, seed: 123456 },
  planet: "nauvis",
  seed: 123456,
  size: 1024,
};

function post(b: unknown, origin = "https://app.example") {
  return new Request("https://svc.example/preview", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(b),
  });
}

describe("worker /preview", () => {
  it("rejects invalid bodies with 400", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(post({ ...body, planet: "mars" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("returns a cached PNG without invoking the container", async () => {
    // Seed the cache directly so no container is needed in the test env.
    const { cacheKey } = await import("../src/cacheKey");
    const key = await cacheKey({ ...body, factorioVersion: env.FACTORIO_VERSION });
    await env.PREVIEW_CACHE.put(`previews/${key}.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const ctx = createExecutionContext();
    const res = await worker.fetch(post(body), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x89);
  });

  it("rejects disallowed origins", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(post(body, "https://evil.example"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(403);
  });
});
```
Note: exercising the true cache-miss -> container path requires a running container, which the pool-workers env does not provide; cover the miss/budget path by asserting the branch is reached (e.g. spy) or defer to the manual e2e in Task 11. The cache-hit and validation branches are the unit-testable core.

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @fmw/preview-worker test worker`
Expected: FAIL - cannot resolve `../src/index`.

- [x] **Step 3: Write the implementation**

`preview-service/worker/src/index.ts`:
```ts
import { parsePreviewRequest } from "./schema";
import { cacheKey } from "./cacheKey";
export { PreviewContainer } from "./container";
export { RenderBudget } from "./budget";

interface Env {
  PREVIEW_CACHE: R2Bucket;
  PREVIEW_CONTAINER: DurableObjectNamespace;
  RENDER_BUDGET: DurableObjectNamespace;
  FACTORIO_VERSION: string;
  MONTHLY_RENDER_BUDGET: string;
  ALLOWED_ORIGIN: string;
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (origin && origin !== env.ALLOWED_ORIGIN) {
      return new Response("forbidden", { status: 403 });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/preview") {
      return new Response("not found", { status: 404 });
    }

    let json: unknown;
    try { json = await request.json(); } catch { return new Response("bad json", { status: 400, headers: corsHeaders(env) }); }
    const parsed = parsePreviewRequest(json);
    if (!parsed.ok) return new Response(parsed.error, { status: 400, headers: corsHeaders(env) });
    const req = parsed.value;

    const key = await cacheKey({ ...req, factorioVersion: env.FACTORIO_VERSION });
    const objectKey = `previews/${key}.png`;

    const cached = await env.PREVIEW_CACHE.get(objectKey);
    if (cached) {
      return new Response(cached.body, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000", ...corsHeaders(env) },
      });
    }

    // Cache miss: enforce budget.
    const budgetId = env.RENDER_BUDGET.idFromName("global");
    const budget = env.RENDER_BUDGET.get(budgetId) as unknown as { consume(cap: number): Promise<{ allowed: boolean }> };
    const decision = await budget.consume(Number(env.MONTHLY_RENDER_BUDGET));
    if (!decision.allowed) {
      return new Response("render budget exhausted", { status: 503, headers: corsHeaders(env) });
    }

    // Render via the container.
    const container = env.PREVIEW_CONTAINER.get(env.PREVIEW_CONTAINER.idFromName("pool-0")) as unknown as {
      fetch(req: Request): Promise<Response>;
    };
    const renderRes = await container.fetch(
      new Request("https://container/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      }),
    );
    if (!renderRes.ok) {
      return new Response("render failed", { status: 502, headers: corsHeaders(env) });
    }
    const png = await renderRes.arrayBuffer();
    await env.PREVIEW_CACHE.put(objectKey, png);
    return new Response(png, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000", ...corsHeaders(env) },
    });
  },
};
```
Note: the `Container` base class from `@cloudflare/containers` provides helpers (`getContainer`, `startAndWaitForPorts`) - prefer them over the raw namespace call above if the installed version exposes them; the raw `.fetch` shown here is the fallback. Confirm the idiom against the `cloudflare:cloudflare` containers reference at implementation time and adjust the container-call block only.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @fmw/preview-worker test`
Expected: PASS (cache-hit, validation, origin, budget tests).

- [x] **Step 5: Commit**

```bash
git add preview-service/worker/src/index.ts preview-service/worker/test/worker.spec.ts
git commit -m "feat(preview): worker fetch handler with cache, budget, and render"
```

---

## Task 9: Frontend seed util + preview client

**Files:**
- Create: `src/util/seed.ts`
- Create: `src/config.ts`
- Create: `src/io/previewClient.ts`
- Test: `test/seed.spec.ts`
- Test: `test/previewClient.spec.ts`

**Interfaces:**
- Consumes: `toMapGenSettingsJson` (`src/io/jsonExport.ts`), `Preset` (`src/model/types.ts`), `Planet` (`src/model/planets.ts`).
- Produces:
  - `randomU32(): number`
  - `PREVIEW_SERVICE_URL: string`
  - `buildPreviewRequest(preset: Preset, planet: Planet): PreviewRequest` (concrete seed injected into `mapGenSettings.seed`)
  - `async function postPreview(req: PreviewRequest): Promise<Blob>` (throws `PreviewError` with `.status` on failure)

- [x] **Step 1: Write the failing seed test**

`test/seed.spec.ts`:
```ts
import { describe, it, expect } from "vite-plus/test";
import { randomU32 } from "../src/util/seed";

describe("randomU32", () => {
  it("returns a non-negative 32-bit integer", () => {
    for (let i = 0; i < 100; i++) {
      const n = randomU32();
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm test seed`
Expected: FAIL - cannot resolve `../src/util/seed`.

- [x] **Step 3: Implement seed + config**

`src/util/seed.ts`:
```ts
/** A concrete unsigned 32-bit map seed (Factorio's seed range). */
export function randomU32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
```

`src/config.ts`:
```ts
/** Base URL of the map-preview render service (Cloudflare Worker). */
export const PREVIEW_SERVICE_URL: string =
  (import.meta.env.VITE_PREVIEW_SERVICE_URL as string | undefined) ?? "";
```

- [x] **Step 4: Write the failing preview-client test**

`test/previewClient.spec.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { buildPreviewRequest, postPreview, PreviewError } from "../src/io/previewClient";
import { getBuiltinPreset } from "../src/model/builtins";

afterEach(() => vi.restoreAllMocks());

describe("buildPreviewRequest", () => {
  it("injects a concrete seed into mapGenSettings when the preset seed is null", () => {
    const preset = getBuiltinPreset("Default");
    preset.seed = null;
    const req = buildPreviewRequest(preset, "vulcanus");
    expect(req.planet).toBe("vulcanus");
    expect(req.size).toBe(1024);
    expect(Number.isInteger(req.seed)).toBe(true);
    expect(req.seed).toBeGreaterThanOrEqual(0);
    expect((req.mapGenSettings as { seed: number }).seed).toBe(req.seed);
  });

  it("uses the preset seed when set", () => {
    const preset = getBuiltinPreset("Default");
    preset.seed = 999;
    expect(buildPreviewRequest(preset, "nauvis").seed).toBe(999);
  });
});

describe("postPreview", () => {
  it("returns a Blob on 200", async () => {
    const blob = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blob, { status: 200 })));
    const preset = getBuiltinPreset("Default");
    const out = await postPreview(buildPreviewRequest(preset, "nauvis"));
    expect(out).toBeInstanceOf(Blob);
  });

  it("throws PreviewError with status on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const preset = getBuiltinPreset("Default");
    await expect(postPreview(buildPreviewRequest(preset, "nauvis"))).rejects.toMatchObject({
      name: "PreviewError",
      status: 503,
    });
  });
});
```

- [x] **Step 5: Run it to verify it fails**

Run: `pnpm test previewClient`
Expected: FAIL - cannot resolve `../src/io/previewClient`.

- [x] **Step 6: Implement the preview client**

`src/io/previewClient.ts`:
```ts
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
```

- [x] **Step 7: Run both tests to verify they pass**

Run: `pnpm test seed previewClient`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/util/seed.ts src/config.ts src/io/previewClient.ts test/seed.spec.ts test/previewClient.spec.ts
git commit -m "feat(preview): frontend seed util and preview client"
```

---

## Task 10: PreviewPanel rewrite

**Files:**
- Modify (rewrite): `src/components/PreviewPanel.vue`
- Test: `test/previewPanel.spec.ts`

**Interfaces:**
- Consumes: `usePresetsStore().activePreset`, `buildPreviewRequest`, `postPreview`, `PreviewError`, `PLANET_LABELS`, `PLANETS`.
- Preserves the existing `v-model:planet` contract (props `planet`, emit `update:planet`) so `App.vue` stays unchanged.

- [x] **Step 1: Write the failing component test**

`test/previewPanel.spec.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PreviewPanel from "../src/components/PreviewPanel.vue";

afterEach(() => vi.restoreAllMocks());

function mountPanel() {
  setActivePinia(createPinia());
  return mount(PreviewPanel, { props: { planet: "nauvis" } });
}

describe("PreviewPanel", () => {
  it("renders the preview image after clicking Generate", async () => {
    const blob = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blob, { status: 200 })));
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });

    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    const img = wrapper.find('[data-test="preview-image"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("blob:x");
  });

  it("shows an error when the render fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="preview-error"]').exists()).toBe(true);
  });

  it("disables Generate while a render is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const wrapper = mountPanel();
    await wrapper.find('[data-test="generate"]').trigger("click");
    expect(wrapper.find('[data-test="generate"]').attributes("disabled")).toBeDefined();
    resolve(new Response(new Blob(), { status: 200 }));
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm test previewPanel`
Expected: FAIL - the panel has no `data-test="generate"` yet.

- [x] **Step 3: Rewrite the panel**

`src/components/PreviewPanel.vue`:
```vue
<script setup lang="ts">
import { ref } from "vue";
import { PLANET_LABELS, PLANETS, type Planet } from "../model/planets";
import { usePresetsStore } from "../store/presets";
import { buildPreviewRequest, postPreview, PreviewError } from "../io/previewClient";
import FButton from "../ui/FButton.vue";
import FDropdown from "../ui/FDropdown.vue";

const props = defineProps<{ planet: Planet }>();
const emit = defineEmits<{ "update:planet": [value: Planet] }>();

const store = usePresetsStore();
const planetOptions = PLANETS.map((p) => ({ value: p, label: PLANET_LABELS[p] }));

const imageUrl = ref<string | null>(null);
const seed = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function generate() {
  const preset = store.activePreset;
  if (!preset || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const req = buildPreviewRequest(preset, props.planet);
    seed.value = req.seed;
    const blob = await postPreview(req);
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = URL.createObjectURL(blob);
  } catch (e) {
    error.value =
      e instanceof PreviewError && e.status === 503
        ? "Preview service is busy - try again shortly."
        : "Preview failed.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <FDropdown
        data-test="planet-select"
        :model-value="planet"
        :options="planetOptions"
        @update:model-value="emit('update:planet', $event as Planet)"
      />
      <span class="spacer" />
      <span v-if="seed !== null" class="seed" data-test="preview-seed">Seed: {{ seed }}</span>
      <FButton data-test="generate" variant="confirm" :disabled="loading" @click="generate()">
        {{ loading ? "Generating..." : "Generate preview" }}
      </FButton>
    </div>
    <div class="preview-stage f-bevel-in">
      <img
        v-if="imageUrl"
        data-test="preview-image"
        class="preview-image"
        :src="imageUrl"
        :alt="`Map preview for ${PLANET_LABELS[planet]}`"
      />
      <p v-else-if="error" data-test="preview-error" class="error" role="alert">{{ error }}</p>
      <p v-else class="dim">Click "Generate preview" to render {{ PLANET_LABELS[planet] }}.</p>
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.seed {
  font-size: 12px;
  color: var(--f-text-dim);
}

.preview-stage {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--f-inset);
  padding: 8px;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
}

.error {
  color: var(--f-red);
}

.dim {
  color: var(--f-text-dim);
}
</style>
```

- [x] **Step 4: Run the panel test to verify it passes**

Run: `pnpm test previewPanel`
Expected: PASS.

- [x] **Step 5: Run the full app suite to catch regressions**

Run: `pnpm test`
Expected: PASS (the removed Auto-refresh/quality controls break no other test; if `test/app.spec.ts` asserted them, update it).

- [x] **Step 6: Commit**

```bash
git add src/components/PreviewPanel.vue test/previewPanel.spec.ts
git commit -m "feat(preview): PreviewPanel with Generate button and live render"
```

---

## Task 11: CSP headers, service URL config, and manual e2e

**Files:**
- Create: `public/_headers`
- Create/modify: `.env.example` (document `VITE_PREVIEW_SERVICE_URL`)

**Interfaces:**
- Consumes: the deployed Worker origin.

- [x] **Step 1: Add the CSP headers for the static deploy**

`public/_headers`:
```
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://REPLACE_WITH_WORKER_ORIGIN; style-src 'self' 'unsafe-inline'; script-src 'self'
```
Note: `img-src ... blob:` is required because the PNG is shown via `URL.createObjectURL`. `connect-src` must include the Worker origin. Adjust `script-src`/`style-src` to match what Vite emits (verify with the built `dist/`).

- [x] **Step 2: Document the env var**

`.env.example`:
```
# Base URL of the deployed map-preview Worker (no trailing slash)
VITE_PREVIEW_SERVICE_URL=https://fmw-preview.your-subdomain.workers.dev
```

- [ ] **Step 3: Deploy and manually verify end to end** (HAND-OFF: needs a Cloudflare account, `wrangler login`, and the R2 bucket)

Run:
```bash
pnpm --filter @fmw/preview-worker exec wrangler r2 bucket create fmw-preview-cache
pnpm --filter @fmw/preview-worker deploy
# set VITE_PREVIEW_SERVICE_URL to the deployed URL, then:
pnpm build && pnpm dev
```
Manually verify (record results in the commit message):
- Generate a preview for each of the five planets - correct terrain appears.
- Re-generating identical settings returns instantly (R2 cache hit - check no container cold start in `wrangler tail`).
- A null-seed preset shows a concrete seed; changing it re-renders.
- Confirm peak container memory stayed within `standard-1` (4 GiB) in `wrangler tail` / metrics; if OOM, bump `instance_type` in `wrangler.jsonc` to `standard-2` (or a custom size) and redeploy.

- [x] **Step 4: Commit**

```bash
git add public/_headers .env.example
git commit -m "feat(preview): CSP headers and service URL config"
```

---

## Self-Review

**Spec coverage** (spec section -> task):
- 2 Product scope -> Tasks 5, 10 (planet selector, 1024, button).
- 3 Feasibility / planet handling (merged mgs + flag) -> Tasks 3, 9.
- 4.1 Frontend PreviewPanel -> Task 10; reuses `toMapGenSettingsJson` -> Task 9.
- 4.2 Worker (validate, cache key, R2, CORS, budget) -> Tasks 4, 5, 7, 8.
- 4.3 Container (digest pin, version assert, thin server, sleepAfter, unique temp, health, instance size) -> Tasks 2, 3, 6.
- 4.4 R2 cache -> Tasks 6, 8.
- 5 Seed reconciliation (concrete in body + key, never null) -> Tasks 5, 9.
- 6 Seed handling / re-roll -> Tasks 9, 10.
- 7 Abuse/budget/rate limit (DO, not KV) -> Tasks 7, 8.
- 8 Error handling/UX -> Tasks 8, 10.
- 9 CSP + workspace -> Tasks 1, 11.
- 10 Testing incl. non-Nauvis render + peak RSS -> Tasks 3, 4, 5, 7, 8, 9, 10, 11.
- 11 Cost model (short sleepAfter) -> Task 6.
- 12 Risks (version pin, memory) -> Tasks 3, 6, 11.

**Placeholder scan:** The only `REPLACE_WITH_*` tokens are deliberate deploy-time values (image digest, app/worker origins, R2 bucket) with explicit commands to obtain them - not logic gaps. No "TODO/handle edge cases/add validation" placeholders; all logic has concrete code.

**Type consistency:** `PreviewRequest` shape (`mapGenSettings`, `planet`, `seed`, `size`) is identical across `src/io/previewClient.ts`, `preview-service/worker/src/schema.ts`, and the container `POST /render` handler. `cacheKey` input adds `factorioVersion` in exactly one place (Task 8), matched by the Task 8 cache-hit test. `randomU32`, `buildPreviewRequest`, `postPreview`, `PreviewError`, `parsePreviewRequest`, `canonicalJson`, `cacheKey`, `RenderBudget.consume`, `renderPreview`, `buildPreviewArgs` names are used consistently between their defining and consuming tasks.

**Known verify-at-implementation points** (flagged inline, not gaps): exact `@cloudflare/containers` call idiom and `wrangler.jsonc` `containers` keys, the base image's Node install path, and `--generate-map-preview /dev/stdout` streaming - each has a stated fallback proven manually.

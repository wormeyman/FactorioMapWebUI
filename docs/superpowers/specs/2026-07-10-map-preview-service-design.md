# Factorio Map WebUI - Map Preview Service Design (Tier B)

- **Date:** 2026-07-10
- **Status:** Design approved; ready for implementation plan.
- **Depends on:** the existing export pipeline (`src/io/jsonExport.ts`
  `toMapGenSettingsJson`, `src/model/convert.ts`, `src/model/types.ts`) and the
  planet-aware control catalog (`src/model/controlCatalog.ts`,
  `src/model/planets.ts`).

## 1. Summary

Add a **real map preview** to the editor: the user clicks "Generate preview" and
sees the actual Factorio-generated top-down preview image for the current
settings, seed, and selected planet. The image is produced by the real Factorio
2.1.9 **headless** engine running `--generate-map-preview` inside a container,
fronted by a Cloudflare Worker with an R2 cache.

This is the app's first backend dependency. It is strictly **opt-in**: the app
remains fully functional offline for editing, exchange-string export, and
JSON/ZIP export. Only the preview button calls out to the service.

### Why the engine, not an approximation

Factorio's map is produced by the engine's own noise-expression system, which is
not publicly specified and is effectively infeasible to reproduce pixel-accurate
in the browser. Running the headless engine is the only way to show the *true*
map. This was proven end-to-end (see Section 3).

### Non-goals (v1)

- No pan / zoom / re-center. Static image at origin (0,0).
- No auto-render on edit. Button-triggered only.
- No `map-settings.json` input (pollution/enemies/pathfinder do not affect the
  visual preview; only `map-gen-settings` is sent).
- No in-browser / WASM engine (container2wasm and similar rejected: full-system
  x86 emulation in the browser is too slow, ships a huge download, and would
  redistribute Factorio's game data to every visitor).
- Google Cloud Run / Fly.io documented as fallback hosts but not built.

## 2. Product scope (locked)

| Decision | Choice |
| --- | --- |
| Trigger | Button ("Generate preview") - one render per click. |
| Image | Static, 1024x1024, centered at origin. |
| Planet | Selector on the preview panel (Nauvis, Vulcanus, Gleba, Fulgora, Aquilo). |
| Layout | Monorepo: new `preview-service/` subfolder in this repo. |
| Host | Cloudflare (Worker + Containers + R2). |

## 3. Feasibility proof (already run)

Using the free `factoriotools/factorio:2.1.9` headless image (amd64; runs native
on Cloudflare, emulated on Apple Silicon via `--platform linux/amd64`):

- Rendered a preview from our own `toMapGenSettingsJson(Default)` output -
  **pixel-identical** to the game's own settings dump. Our export is genuinely
  game-consumable.
- Render time: **~0.15s** map-gen, **~1.5s** total wall clock (cold engine init
  included), on Apple Silicon under emulation. Native amd64 on Cloudflare is
  expected to be at least as fast.
- **All five planets render correctly** via `--map-preview-planet`
  (Nauvis, Vulcanus, Gleba, Fulgora, Aquilo). The `space-age` mod ships in the
  headless image, so DLC planets work.
- **Foreign controls are ignored gracefully:** feeding our Nauvis-derived merged
  `map-gen-settings` to `--map-preview-planet vulcanus` did not error and
  produced correct Vulcanus terrain. The engine applies only the controls
  relevant to the selected planet.

**Consequence for the design:** because `Preset.autoplaceControls` is one flat
dict holding every planet's controls, a **single merged `map-gen-settings` plus
the planet flag is correct for every planet** - no per-planet filtering of the
mgs is required for correctness. (Filtering is an optional payload-size
optimization, not a correctness need.)

Required CLI shape:

```
factorio --generate-map-preview <out.png> \
  --map-gen-settings <mgs.json> \
  --map-preview-planet <planet> \
  --map-gen-seed <u32> \
  --map-preview-size 1024
```

## 4. Architecture

```
Vue app (existing, static; e.g. Cloudflare Pages)
  │  POST /preview  { mapGenSettings, planet, seed, size, factorioVersion }
  ▼
Cloudflare Worker (preview-service/worker)
  │  validate → cacheKey = sha256(canonicalJSON(payload))
  │  R2 GET previews/<cacheKey>.png
  │    ├─ hit  → return PNG (container never wakes)
  │    └─ miss → rate-limit check → Container.fetch(/render)
  │               → R2 PUT → return PNG
  ▼
Container = Durable Object (preview-service/container)
  thin Node HTTP server on :8080  →  spawns `factorio --generate-map-preview`
  returns PNG bytes
```

Four components:

### 4.1 Frontend - `PreviewPanel.vue` (replaces the current placeholder)

The existing `PreviewPanel.vue` has an "Auto-refresh" checkbox and a
Normal/High "quality" dropdown that contradict the locked scope; **remove
both**. New UI:

- A **planet dropdown** (default: the app's current `selectedPlanet` in
  `App.vue`; the panel and the editor stay in sync).
- A **"Generate preview"** button (disabled while a render is in flight).
- A **seed display + re-roll** affordance (see Section 6).
- A rendered `<img>` on success; a loading state on first cold hit (~4-5s);
  distinct error states (Section 8).

On click it:
1. Builds the payload `mapGenSettings` by calling the existing
   `toMapGenSettingsJson(preset)` (reused unchanged), with the concrete seed
   injected (Section 6).
2. POSTs JSON to the Worker `/preview` endpoint (URL from build-time config).
3. Displays the returned PNG (served through the Worker, so it is same-origin
   with the API and needs no extra `img-src`).

### 4.2 Worker - `preview-service/worker`

`POST /preview`:
1. **Validate** the body against a strict schema; reject unknown shapes; cap
   body size (e.g. 64 KB).
2. Compute `cacheKey = sha256(canonicalJSON({ mapGenSettings, planet, seed,
   size, factorioVersion }))`. Canonicalization **recursively sorts object
   keys** before stringifying (float formatting is stable across V8 client and
   Worker; key order is not, hence the sort).
3. `R2.get("previews/" + cacheKey + ".png")`. On **hit**, return the PNG with
   `Content-Type: image/png` and long-lived cache headers. The container is
   never woken.
4. On **miss**: enforce the rate limit / global budget (Section 7); then call
   the Container binding, `startAndWaitForPorts()`, forward the render request,
   receive PNG, `R2.put(...)`, and return it.
5. CORS headers for the app origin (CORS is UX, not security - see Section 7).

### 4.3 Container - `preview-service/container`

A Durable-Object-backed container (Cloudflare's model). The image:

- `FROM factoriotools/factorio@sha256:<digest>` - **pinned by digest**, not the
  `:2.1.9` tag (tags are mutable and would silently break parity with the
  2.1.9 exchange-format codec).
- A **thin Node HTTP server** on port 8080 (the factorio binary does not serve
  HTTP). Endpoints:
  - `GET /healthz` → 200 once ready (so `startAndWaitForPorts` passes).
  - `POST /render { mapGenSettings, planet, seed, size }` → writes the settings
    to a **unique temp path** (`mktemp`), spawns
    `factorio --generate-map-preview`, returns the PNG bytes (or 5xx with a
    stderr tail on failure). Cleans up temp files in a `finally`.
- **Startup assertion:** run `factorio --version` and fail fast if it is not the
  expected 2.1.9 build.
- **`sleepAfter` ≈ 15-30s** (NOT minutes). Each render is an independent
  one-shot; a long idle tail only burns the memory allowance. Optionally
  `stop()` promptly via `onActivityExpired`.
- **Concurrency:** each request shells out a fresh factorio process (which
  reloads all prototypes, ~most of the ~1s). Define a DO sharding strategy
  (start with a small fixed pool via `getByName` over a few ids, or `getRandom`
  with low `max_instances`); guard against temp-file collisions with unique
  paths; cap in-container concurrency.
- **Instance type:** start at **standard-1** (1/2 vCPU, 4 GiB, 8 GB disk). 4 GiB
  sufficiency for the Space Age prototype load is **unmeasured** - see the
  verification task in Section 10. If it OOMs (surfaces as a container kill /
  5xx), move to a **custom instance** (e.g. ~5-6 GiB) or **standard-2**
  (1 vCPU, 6 GiB).

### 4.4 R2 - PNG cache

- Bucket keyed `previews/<sha256>.png`.
- The cache is what makes the awake-time billing a non-issue: identical inputs
  are free and never wake the container.
- Lifecycle: default to **unbounded retention** (objects are tiny, ~0.1-0.4 MB,
  and deterministic); revisit only if storage grows. State this explicitly
  rather than leaving it implied.

## 5. Data flow (miss path)

1. User picks planet, clicks Generate.
2. App serializes `toMapGenSettingsJson(preset)` with concrete seed → POST.
3. Worker validates, hashes, R2 miss, rate-limit OK.
4. Worker → Container `/render` (cold: container boot ~2-3s + factorio init ~1s;
   warm: ~1-1.5s).
5. Container renders PNG, returns bytes.
6. Worker `R2.put`, returns PNG (same-origin) → app shows `<img>`.

## 6. Seed handling

`Preset.seed` is `number | null` (`null` = "random each map", wire 0). A preview
needs a **concrete** seed:

- If `seed` is non-null, use it.
- If `seed` is null, the app picks a random `u32` **for this render** and
  displays it (with a re-roll control that picks a new u32 and re-renders).
- **Reconciliation:** `toMapGenSettingsJson` embeds `seed` in the body. Inject
  the chosen concrete u32 into the mgs body so the body and `--map-gen-seed`
  agree. The **cache key uses the concrete seed, never null** - otherwise
  "random" renders would never cache or would wrongly collide.

## 7. Abuse, budget, and security

The render endpoint is public and unauthenticated - a cost-amplification / DoS
vector (an attacker varies seed/settings to force cache misses; each miss can
keep a 4 GiB container warm). Mitigations:

- **Global render budget + kill switch:** a hard monthly cap on cache-miss
  renders; once exceeded, `/preview` returns cached-only (or 503). Backed by a
  Durable Object or the Rate Limiting binding, with an alarm on spend.
- **Rate limit per client:** use the Workers **Rate Limiting binding** or a
  **Durable Object counter** - **not KV** (eventually consistent; counters race
  and under-count).
- **`max_instances` low**, so a burst cannot fan out into many billed
  containers.
- **Strict schema validation + body-size cap** on `/preview`.
- **Optional Turnstile** on the button if abuse materializes.
- CORS restricts *browser* callers to the app origin but is **not** a security
  boundary (trivially bypassed by non-browser clients); the budget + rate limit
  are the real controls.

## 8. Error handling & UX

Distinct handling for:

- **Invalid settings** (schema reject) → 400, "Invalid settings".
- **Render failure** (factorio nonzero exit / no PNG) → 500 with stderr tail
  logged, "Preview failed".
- **OOM** (container killed) → surfaces as 5xx; log and, if recurring, signals
  the instance-size bump.
- **Cold-start / port timeout** → consider raising `portReadyTimeoutMS` to ~30s
  to survive a first-time image pull; client timeout > 30s.
- **Rate-limited / over budget** → 429 / 503, "Too many requests, try again".
- Client shows a loading spinner on the first cold hit (~4-5s) and a clear error
  card otherwise.

## 9. CSP & repo layout

- **CSP:** the repo has no CSP today (no meta CSP, no `_headers`). Define where
  CSP lives (host-level `_headers` on the static deploy) and add `connect-src`
  for the Worker origin. Because the PNG is returned **through the Worker**
  (same origin as the API), `img-src` does not need to open to a public R2
  domain.
- **Workspace:** `package.json` pins pnpm via `devEngines` but there is no
  `pnpm-workspace.yaml`. Add one so `preview-service/` (Worker + container Node
  server, each with its own deps and a Miniflare/vitest setup distinct from the
  app's `vite-plus` vitest) does not collide with the app toolchain.

```
FactorioMapWebUI/
  src/                     (existing Vue app)
  preview-service/
    worker/                (CF Worker: API + cache + rate limit)
    container/             (Dockerfile + Node HTTP wrapper)
    wrangler.jsonc
  pnpm-workspace.yaml
```

## 10. Testing & verification

- **Container (integration):** run the built image and assert a valid PNG comes
  back for a fixture `map-gen-settings.json` - promote today's manual proof to
  an automated check. Include **one non-Nauvis planet** render.
- **Peak-RSS measurement (spec task):** measure Factorio's peak memory in the
  CF-shaped container to confirm the 4 GiB `standard-1` choice (or size up).
- **Worker (unit, Miniflare/vitest):** cache-key stability (key-order &
  float-invariance), R2 hit/miss branching, seed reconciliation (null → concrete
  in body + key), CORS, rate-limit / budget, error paths - with the container
  binding and R2 mocked.
- **Frontend (component):** `PreviewPanel` - button disabled while loading,
  renders `<img>` on success, error states, planet dropdown syncs with
  `selectedPlanet`, seed re-roll triggers a new request. Fetch mocked.
- **Manual e2e:** deploy to a Cloudflare preview and render each planet.

## 11. Cost model

- Cloudflare Containers require **Workers Paid ($5/mo)**. **CPU is billed on
  active usage** (since Nov 2025); **memory and disk are billed on provisioned
  resources for the whole awake window** (including the `sleepAfter` tail) -
  hence the short `sleepAfter`. Included monthly: 25 GiB-hours memory,
  375 vCPU-minutes CPU, 200 GB-hours disk, 1 TB egress (NA/EU). Memory overage
  ≈ $0.0000025/GiB-s (trivial).
- With a short `sleepAfter` + the R2 cache (hits never wake the container),
  **$5/mo is the realistic all-in cost at hobby scale**, with overages in cents.
- Fallbacks if volume/latency ever demands: **Google Cloud Run** (request-based
  billing, no idle tail, larger instances) or **Fly.io** (fast wake). Not built.

## 12. Risks & open questions

- **4 GiB sufficiency** for Space Age prototype load - unmeasured; gated by the
  Section 10 peak-RSS task. Custom instance sizes de-risk this.
- **Version pinning** - the image must match the 2.1.9 exchange format; digest
  pin + `--version` assertion + version-in-cache-key guard against drift. When
  the app's fixtures move to a new Factorio version, rebuild the image and bump
  the pin.
- **Public-endpoint abuse** - mitigated by budget + rate limit + cap, but
  monitor spend via observability/alarms.
- **First-render latency** - cold path ~4-5s; acceptable for an explicit button,
  masked by a loading state and amortized by the cache.

## 13. Success criteria

1. Clicking "Generate preview" returns the correct Factorio preview image for
   the current settings, seed, and each of the five planets.
2. Identical inputs are served from R2 without waking the container.
3. A "random" (null-seed) preset renders with a concrete displayed seed, and
   re-roll produces a new image; the cache keys on the concrete seed.
4. The public endpoint cannot exceed the configured monthly render budget.
5. The static app still builds and runs fully offline; the preview is the only
   feature that calls the service.
6. `pnpm test` (app) and the `preview-service` tests pass; the container
   integration test renders a valid PNG including a non-Nauvis planet.

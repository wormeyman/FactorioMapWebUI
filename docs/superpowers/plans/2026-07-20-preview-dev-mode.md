# Preview Developer Mode + Render Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the preview panel's six view-toggle buttons and a new elapsed-ms render readout behind a developer-mode flag (toggled by a toolbar checkbox, seedable via `?dev=1`), so a normal user sees a clean `Seed … [Generate]` toolbar rendering the full composite map, while development keeps an honest in-browser timing number.

**Architecture:** Three layers, each independently testable. A pure resolver (`src/model/devMode.ts`) decides the flag from a URL query string plus a stored value - no DOM, no framework. A small Pinia store (`src/store/ui.ts`) owns the reactive flag, reads `window.location.search` + `localStorage` once at construction, and persists on every set. `ElevationPreviewPanel.vue` consumes the store: it renders the checkbox unconditionally, gates the view buttons and the timing readout on the flag, and (a small cleanup along the way) replaces the stateful `watch` that force-reset the view with a derived `effectiveView` computed.

**Tech Stack:** Vue 3 `<script setup>`, Pinia (options-API `defineStore`, matching `src/store/presets.ts`), vite-plus test runner with happy-dom, `@vue/test-utils`.

## Global Constraints

- Run everything through pnpm: `pnpm vp test` (full suite), `pnpm vp test test/<file>.spec.ts` (one file), `pnpm vp check --fix` (lint + format, the only lint step).
- There is **no** `tsc`/`vue-tsc` type-check step. Verify by running tests, not by trusting editor diagnostics; a stale "cannot find module" on a newly created file is expected noise.
- Imports under `src/**` are **extensionless** (`from "../model/devMode"`). Tests import from `"vite-plus/test"`.
- TDD: write the failing test, watch it fail for the right reason, then implement.
- Use hyphens (`-`) in all prose and comments - never em dashes or en dashes.
- Work happens on branch `feat/preview-dev-mode` (already created off `main`). Commit per task. Do **not** push, merge, or deploy.
- Commit message footer, on the last two lines of every commit:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
```

- Do not touch anything under `src/noise/**`, `src/codec/**`, or `test/fixtures/**`. This plan is UI-only; the renderer's byte-exactness is not in scope.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/model/devMode.ts` (create) | Pure flag resolution + the localStorage key constant. No DOM. |
| `test/devMode.spec.ts` (create) | Unit tests for the resolution rules. |
| `src/store/ui.ts` (create) | Pinia store owning the reactive `devMode` flag; reads the DOM sources once, persists on set. |
| `test/uiStore.spec.ts` (create) | Store construction (URL/storage precedence) and persistence. |
| `src/components/ElevationPreviewPanel.vue` (modify) | Checkbox, gated view buttons, gated elapsed readout, `effectiveView` cleanup. |
| `test/elevationPreviewPanel.spec.ts` (modify) | Existing view-toggle tests get dev mode on; new tests for gating, default view, timing. |

---

### Task 1: Pure dev-mode resolver

**Files:**

- Create: `src/model/devMode.ts`
- Test: `test/devMode.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const DEV_MODE_STORAGE_KEY = "fmw.devMode"`
  - `export function resolveDevMode(search: string, stored: string | null): boolean`

Resolution rules, in order: an explicit `dev` query parameter wins (`?dev=0` means off, any other value - including a bare `?dev` - means on); otherwise the stored value is on only when it is exactly `"1"`; otherwise off.

- [ ] **Step 1: Write the failing test**

Create `test/devMode.spec.ts`:

```ts
import { describe, it, expect } from "vite-plus/test";
import { DEV_MODE_STORAGE_KEY, resolveDevMode } from "../src/model/devMode";

describe("resolveDevMode", () => {
  it("is off with no query parameter and nothing stored", () => {
    expect(resolveDevMode("", null)).toBe(false);
    expect(resolveDevMode("?seed=5", null)).toBe(false);
  });

  it("reads the stored value when the URL says nothing", () => {
    expect(resolveDevMode("", "1")).toBe(true);
    expect(resolveDevMode("", "0")).toBe(false);
    expect(resolveDevMode("?seed=5", "1")).toBe(true);
  });

  it("lets an explicit ?dev= override the stored value in both directions", () => {
    expect(resolveDevMode("?dev=1", "0")).toBe(true);
    expect(resolveDevMode("?dev=0", "1")).toBe(false);
  });

  it("treats a bare ?dev as on", () => {
    expect(resolveDevMode("?dev", null)).toBe(true);
    expect(resolveDevMode("?dev=", null)).toBe(true);
  });

  it("exposes a storage key that cannot collide with the preset store's", () => {
    expect(DEV_MODE_STORAGE_KEY).toBe("fmw.devMode");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vp test test/devMode.spec.ts`
Expected: FAIL - the file `src/model/devMode.ts` does not exist ("Failed to resolve import").

- [ ] **Step 3: Write the implementation**

Create `src/model/devMode.ts`:

```ts
/**
 * The developer-mode flag: it reveals the preview panel's view toggles and the
 * render-timing readout. Deliberately separate from the preset store's
 * localStorage key - this is UI chrome, not map data, so it persists
 * immediately rather than waiting for a Save (see store/presets.ts).
 */
export const DEV_MODE_STORAGE_KEY = "fmw.devMode";

/**
 * Resolve the flag from its two sources. An explicit `?dev=` in the URL wins in
 * both directions, so a bookmarked `?dev=1` turns it on and `?dev=0` forces it
 * off regardless of what was stored; with no parameter the stored value decides.
 */
export function resolveDevMode(search: string, stored: string | null): boolean {
  const param = new URLSearchParams(search).get("dev");
  if (param !== null) return param !== "0";
  return stored === "1";
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vp test test/devMode.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, then commit**

```bash
pnpm vp check --fix
git add src/model/devMode.ts test/devMode.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): pure dev-mode flag resolver (URL beats storage)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
EOF
)"
```

---

### Task 2: UI store owning the flag

**Files:**

- Create: `src/store/ui.ts`
- Test: `test/uiStore.spec.ts`

**Interfaces:**

- Consumes: `DEV_MODE_STORAGE_KEY`, `resolveDevMode` from `src/model/devMode`.
- Produces: `export const useUiStore` - a Pinia store with state `{ devMode: boolean }` and action `setDevMode(value: boolean): void`.

Note for the implementer: the store reads its DOM sources **once, at construction**. Under Pinia that means every `setActivePinia(createPinia())` in a test re-reads them, which is exactly the isolation the tests below rely on.

- [ ] **Step 1: Write the failing test**

Create `test/uiStore.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { DEV_MODE_STORAGE_KEY } from "../src/model/devMode";
import { useUiStore } from "../src/store/ui";

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  setActivePinia(createPinia());
});

describe("useUiStore devMode", () => {
  it("defaults to off with clean storage and a bare URL", () => {
    expect(useUiStore().devMode).toBe(false);
  });

  it("starts on when storage says so", () => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });

  it("lets ?dev=1 in the URL win over stored off", () => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    history.replaceState(null, "", "/?dev=1");
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });

  it("persists both directions through setDevMode", () => {
    const ui = useUiStore();
    ui.setDevMode(true);
    expect(ui.devMode).toBe(true);
    expect(localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe("1");

    ui.setDevMode(false);
    expect(ui.devMode).toBe(false);
    expect(localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe("0");
  });

  it("restores a stored flag in a fresh store instance", () => {
    useUiStore().setDevMode(true);
    setActivePinia(createPinia());
    expect(useUiStore().devMode).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vp test test/uiStore.spec.ts`
Expected: FAIL - `src/store/ui.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/store/ui.ts`:

```ts
import { defineStore } from "pinia";
import { DEV_MODE_STORAGE_KEY, resolveDevMode } from "../model/devMode";

/** `window.location.search`, or "" where there is no DOM. */
function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(DEV_MODE_STORAGE_KEY);
  } catch {
    // Storage can throw in private-browsing modes; the flag still works in-session.
    return null;
  }
}

/**
 * UI-only preferences, kept out of the preset store: this is panel chrome, not
 * map data, so it persists on every set instead of waiting for a Save.
 *
 * The URL and storage are read once, when the store is constructed. Toggling the
 * flag deliberately does NOT rewrite the URL, so a bookmarked `?dev=1` still
 * comes back in dev mode after a reload.
 */
export const useUiStore = defineStore("ui", {
  state: () => ({
    devMode: resolveDevMode(currentSearch(), readStored()),
  }),
  actions: {
    setDevMode(value: boolean) {
      this.devMode = value;
      try {
        localStorage.setItem(DEV_MODE_STORAGE_KEY, value ? "1" : "0");
      } catch {
        // Storage unavailable - keep the in-session flag and move on.
      }
    },
  },
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm vp test test/uiStore.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, then commit**

```bash
pnpm vp check --fix
git add src/store/ui.ts test/uiStore.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): ui store owning the persisted dev-mode flag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
EOF
)"
```

---

### Task 3: Default to the composite view, derive it instead of watching

**Files:**

- Modify: `src/components/ElevationPreviewPanel.vue` (script lines 39-43 and 61; template lines 105-172)
- Test: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: no exported API change. Internally, `view` becomes the user's *desired* view (default `"all"`) and a new `effectiveView` computed is what actually gets rendered and highlighted.

Why: today `view` starts at `"elevation"` and a `watch(terrainAvailable)` force-resets it whenever the preset is not Nauvis. Once Task 4 hides the buttons that watch becomes the only thing setting the view, and it is lossy - switching Lakes then back to Nauvis leaves you stuck on Elevation. A derived value has no such state. It also gives non-dev users the full composite, which is the closest thing to the game's own map preview.

`renderTerrain` (and therefore every overlay view) is only faithful for Nauvis, so `effectiveView` must still collapse to `"elevation"` off-Nauvis. That invariant is what the existing "falls back to Elevation view" test guards; do not weaken it.

- [ ] **Step 1: Write the failing test**

Add to `test/elevationPreviewPanel.spec.ts`, inside the existing `describe("ElevationPreviewPanel", ...)` block:

```ts
  it("defaults to the composite All view on a Nauvis preset with no toggle clicked", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "all", mapType: "nauvis" });
  });

  it("restores the chosen view when a preset switches away from Nauvis and back", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer);
    const store = usePresetsStore();

    await w.find('[data-test="view-terrain"]').trigger("click");
    writeMapType(store.activePreset!.propertyExpressionNames, "lakes");
    await w.vm.$nextTick();
    writeMapType(store.activePreset!.propertyExpressionNames, "nauvis");
    await w.vm.$nextTick();

    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "terrain" });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL on both new tests - the first gets `view: "elevation"` (the current default), the second gets `view: "elevation"` (the watch stomped the choice and never restored it).

- [ ] **Step 3: Replace the watch with a computed**

In `src/components/ElevationPreviewPanel.vue`, replace this block:

```ts
const view = ref<"elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "all">("elevation");
const terrainAvailable = computed(() => preview.value?.mapType === "nauvis");
watch(terrainAvailable, (available) => {
  if (!available) view.value = "elevation";
});
```

with:

```ts
// The user's desired view. Defaults to the full composite, which is the closest
// thing to the game's own map preview - and with dev mode off (the default) it
// is the only view a user ever gets, since the toggles are hidden.
const view = ref<"elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "all">("all");
const terrainAvailable = computed(() => preview.value?.mapType === "nauvis");
// What actually renders. renderTerrain always evaluates the Nauvis climate + tile
// catalog regardless of the preset's map type, so every non-elevation view
// collapses to "elevation" off-Nauvis rather than rendering the wrong climate.
// Deriving this (instead of the old watch that reset `view`) means a round trip
// through a Lakes preset no longer destroys the chosen view.
const effectiveView = computed(() => (terrainAvailable.value ? view.value : "elevation"));
```

Then update the comment block above it (lines 33-38) to drop the now-stale "Gate the toggle on that rather than rendering …" wording, keeping the Nauvis-only explanation that `effectiveView` now carries.

Remove `watch` from the `vue` import on line 3 - it becomes unused, and `vp check` will flag it:

```ts
import { computed, ref } from "vue";
```

In `generate()`, change line 61 from `view: view.value,` to:

```ts
      view: effectiveView.value,
```

In the template, change every view button's `:variant` comparison from `view === '…'` to `effectiveView === '…'`, so the highlighted button matches what will actually render (all six buttons: `view-elevation`, `view-terrain`, `view-resources`, `view-enemies`, `view-cliffs`, `view-all`). For example:

```html
        <FButton
          data-test="view-elevation"
          :variant="effectiveView === 'elevation' ? 'tool' : 'default'"
          @click="view = 'elevation'"
        >
          Elevation
        </FButton>
```

Leave every `@click="view = '…'"` handler, `:disabled`, and `:title` exactly as they are.

- [ ] **Step 4: Run the whole panel spec**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS, including the pre-existing "falls back to Elevation view when switching to a preset whose map type disables Terrain" test (it clicks Terrain, switches to Lakes, and must still render `view: "elevation"`).

- [ ] **Step 5: Run the full suite**

Run: `pnpm vp test`
Expected: PASS. `test/elevationPreviewPanel.spec.ts` is the only spec that touches the view toggles (verified by grep), so nothing else should move.

- [ ] **Step 6: Lint, then commit**

```bash
pnpm vp check --fix
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
refactor(preview): derive effectiveView, default to the All composite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
EOF
)"
```

---

### Task 4: Dev-mode checkbox gating the view toggles

**Files:**

- Modify: `src/components/ElevationPreviewPanel.vue` (script imports; template toolbar)
- Test: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**

- Consumes: `useUiStore` from `src/store/ui` (Task 2), `FCheckbox` from `src/ui/FCheckbox.vue`.
- Produces: `data-test="dev-mode"` on the checkbox's root `<label>` (so tests reach the input via `[data-test="dev-mode"] input`). The `view-*` buttons exist in the DOM only when dev mode is on.

Note on `FCheckbox`: it takes `modelValue: boolean` + optional `label`, emits `update:modelValue`. It has a single root `<label>`, so a `data-test` attribute falls through onto that label, not onto the `<input>`.

- [ ] **Step 1: Update the shared test setup so existing tests keep their toggles**

Almost every existing test in `test/elevationPreviewPanel.spec.ts` clicks a `view-*` button, which will no longer exist with dev mode off. Give `setup` an explicit dev-mode argument that defaults to on, and always set it (never leave it to whatever a previous test persisted).

Replace the existing `setup` helper and add the import:

```ts
import { useUiStore } from "../src/store/ui";

function setup(mapTypeId: string, renderer: ElevationRenderer, opts: { dev?: boolean } = {}) {
  localStorage.clear();
  history.replaceState(null, "", "/");
  setActivePinia(createPinia());
  // Dev mode is set explicitly (not left to whatever persisted) so tests cannot
  // leak the flag into each other through localStorage.
  useUiStore().setDevMode(opts.dev ?? true);
  const store = usePresetsStore();
  store.createFromBuiltin("Default", "t");
  store.activePreset!.seed = 123456;
  writeMapType(store.activePreset!.propertyExpressionNames, mapTypeId);
  return mount(ElevationPreviewPanel, { props: { renderer } });
}
```

- [ ] **Step 2: Write the failing tests**

Add to the same `describe` block:

```ts
  it("hides the view toggles when dev mode is off", () => {
    const w = setup("nauvis", okRenderer(), { dev: false });
    for (const t of ["elevation", "terrain", "resources", "enemies", "cliffs", "all"]) {
      expect(w.find(`[data-test="view-${t}"]`).exists()).toBe(false);
    }
    expect(w.find('[data-test="generate"]').exists()).toBe(true);
    expect(w.find('[data-test="dev-mode"]').exists()).toBe(true);
  });

  it("still renders the composite view with the toggles hidden (Nauvis)", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("nauvis", renderer, { dev: false });
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "all", mapType: "nauvis" });
  });

  it("still renders Elevation with the toggles hidden (Lakes)", async () => {
    stubCanvas();
    const renderer = okRenderer();
    const w = setup("lakes", renderer, { dev: false });
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    const arg = (renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ view: "elevation", mapType: "lakes" });
  });

  it("reveals the view toggles when the dev-mode checkbox is ticked", async () => {
    const w = setup("nauvis", okRenderer(), { dev: false });
    expect(w.find('[data-test="view-all"]').exists()).toBe(false);

    await w.find('[data-test="dev-mode"] input').setValue(true);

    expect(w.find('[data-test="view-all"]').exists()).toBe(true);
    expect(useUiStore().devMode).toBe(true);
  });
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL - the toggles are still unconditionally present, and `[data-test="dev-mode"]` does not exist.

- [ ] **Step 4: Add the checkbox and gate the toggles**

In `src/components/ElevationPreviewPanel.vue`, add to the script imports:

```ts
import { useUiStore } from "../store/ui";
import FCheckbox from "../ui/FCheckbox.vue";
```

and, next to the existing `const store = usePresetsStore();`:

```ts
const ui = useUiStore();
```

In the template, add `v-if="ui.devMode"` to the view-toggle group's opening tag:

```html
      <div v-if="ui.devMode" class="view-toggle" role="group" aria-label="Preview view">
```

and add the checkbox between the spacer and the Generate button:

```html
      <span class="spacer" />
      <FCheckbox
        data-test="dev-mode"
        label="Debug"
        :model-value="ui.devMode"
        @update:model-value="ui.setDevMode($event)"
      />
      <FButton
```

- [ ] **Step 5: Run the panel spec**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS - the four new tests plus every pre-existing test (which now run with dev mode on via `setup`'s default).

- [ ] **Step 6: Run the full suite**

Run: `pnpm vp test`
Expected: PASS. No other spec queries a `view-*` button (verified by grep), so this gating should not move any other test.

- [ ] **Step 7: Lint, then commit**

```bash
pnpm vp check --fix
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): dev-mode checkbox gating the view toggles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
EOF
)"
```

---

### Task 5: Elapsed-ms render readout

**Files:**

- Modify: `src/components/ElevationPreviewPanel.vue` (script `generate()`; template toolbar; scoped styles)
- Test: `test/elevationPreviewPanel.spec.ts`

**Interfaces:**

- Consumes: `ui.devMode` (Task 4).
- Produces: `data-test="preview-elapsed"`, present only when dev mode is on **and** a render has completed. Text format: `1,234 ms` (`Number.toLocaleString("en-US")` - the locale is pinned so the thousands separator does not vary by machine).

What it measures: wall-clock from immediately before `renderer.render(...)` to immediately after `putImageData` - the full user-visible latency including the worker round trip and buffer transfer, not just compute. That is the number the region-tiling work has to move, so it must not be narrowed to the compute call.

- [ ] **Step 1: Write the failing tests**

Add to the same `describe` block:

```ts
  it("reports the elapsed render time after a render, and nothing before one", async () => {
    stubCanvas();
    const w = setup("nauvis", okRenderer());
    expect(w.find('[data-test="preview-elapsed"]').exists()).toBe(false);

    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();

    // The clock is real, so assert the shape, not a duration.
    expect(w.find('[data-test="preview-elapsed"]').text()).toMatch(/^\d[\d,]* ms$/);
  });

  it("hides the elapsed readout when dev mode is off", async () => {
    stubCanvas();
    const w = setup("nauvis", okRenderer(), { dev: false });
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="preview-elapsed"]').exists()).toBe(false);
  });

  it("reports no elapsed time when the render fails", async () => {
    stubCanvas();
    const renderer: ElevationRenderer = {
      render: vi.fn(async () => {
        throw new Error("boom");
      }),
      dispose: vi.fn(),
    };
    const w = setup("nauvis", renderer);
    await w.find('[data-test="generate"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="preview-elapsed"]').exists()).toBe(false);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: FAIL on the first test - `[data-test="preview-elapsed"]` never exists, so `.text()` throws on a non-existent wrapper. (The other two pass vacuously for now; they are the regression guards.)

- [ ] **Step 3: Implement the timer**

In `src/components/ElevationPreviewPanel.vue`, add the state next to `const hasRendered = ref(false);`:

```ts
/** Wall-clock ms of the last completed render, or null before/behind a failure. */
const elapsedMs = ref<number | null>(null);
```

In `generate()`, clear it alongside the other per-render resets and start the clock immediately before the render call:

```ts
  loading.value = true;
  error.value = null;
  elapsedMs.value = null;
  const startedAt = performance.now();
  try {
    const result = await renderer.render({
```

and stamp it inside the successful-blit branch, right after `hasRendered.value = true;`:

```ts
      hasRendered.value = true;
      // Measured across the whole round trip (worker post, compute, transfer,
      // blit) - that is the latency a user feels, and what tiling has to move.
      elapsedMs.value = Math.round(performance.now() - startedAt);
```

Stamping it inside the `if (el && g)` branch (rather than in `finally`) means a missing canvas reports no time instead of a meaningless one, and the `catch` path leaves it `null`.

In the template, add the readout next to the seed label:

```html
      <span v-if="seed !== null" class="seed" data-test="preview-seed">Seed: {{ seed }}</span>
      <span
        v-if="ui.devMode && elapsedMs !== null"
        class="seed"
        data-test="preview-elapsed"
        title="Wall-clock time from render request to canvas blit"
        >{{ elapsedMs.toLocaleString("en-US") }} ms</span
      >
```

It reuses the existing `.seed` class (dim, 12px), so no new style rule is needed.

- [ ] **Step 4: Run the panel spec**

Run: `pnpm vp test test/elevationPreviewPanel.spec.ts`
Expected: PASS (all three new tests plus everything before them).

- [ ] **Step 5: Run the full suite and lint**

Run: `pnpm vp test && pnpm vp check --fix`
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ElevationPreviewPanel.vue test/elevationPreviewPanel.spec.ts
git commit -m "$(cat <<'EOF'
feat(preview): elapsed-ms render readout behind dev mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcdG3NqMYA36PuUVsuh5f6
EOF
)"
```

---

## Manual verification (after Task 5)

Not a test - this is how the in-browser baseline for the region-tiling work gets captured.

- [ ] Run `pnpm vp dev` and open the app.
- [ ] Confirm the default toolbar shows only `Seed …`, the `Debug` checkbox, and `Generate` - no view buttons, no timing.
- [ ] Click Generate on a Nauvis preset; confirm a full composite map renders (terrain + ore + enemy bases + cliffs).
- [ ] Tick `Debug`; confirm the six view buttons and the `N ms` readout appear, and that `All` is highlighted.
- [ ] Reload; confirm dev mode stayed on. Open `/?dev=0`; confirm it turns off.
- [ ] Record the `ms` figure for the `All` view at 1024x1024 - that is the honest before-number the tiling work is measured against (the `pnpm perf` harness runs ~2.5-3x pessimistic against it, so it is a relative-cost tool only).

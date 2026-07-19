import { onBeforeUnmount } from "vue";
import type {
  ElevationRenderRequest,
  ElevationRenderResult,
} from "../noise/preview/elevationRenderRequest";

/** The minimal Worker surface the renderer uses, so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface ElevationRenderer {
  render(req: Omit<ElevationRenderRequest, "id">): Promise<ElevationRenderResult>;
  dispose(): void;
}

function createRenderWorker(): WorkerLike {
  return new Worker(new URL("../noise/preview/elevationRender.worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Own a single worker and match each response to its request by id. A response
 * with no pending id is dropped (a superseded render), so a late result never
 * paints over a newer one. Lifecycle-free; callers own dispose().
 */
export function createElevationRenderer(
  createWorker: () => WorkerLike = createRenderWorker,
): ElevationRenderer {
  const worker = createWorker();
  const pending = new Map<
    number,
    { resolve: (r: ElevationRenderResult) => void; reject: (e: unknown) => void }
  >();
  let nextId = 1;

  worker.onmessage = (e: MessageEvent) => {
    const result = e.data as ElevationRenderResult;
    const entry = pending.get(result.id);
    if (entry) {
      pending.delete(result.id);
      entry.resolve(result);
    }
  };

  // A real worker crash would otherwise leave render()'s promise pending
  // forever; reject every in-flight request so the panel's catch fires.
  worker.onerror = () => {
    const entries = [...pending.values()];
    pending.clear();
    for (const { reject } of entries) reject(new Error("Elevation render worker error"));
  };

  return {
    render(req) {
      const id = nextId++;
      return new Promise<ElevationRenderResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...req, id } satisfies ElevationRenderRequest);
      });
    },
    dispose() {
      pending.clear();
      worker.terminate();
    },
  };
}

/** Vue composable: a renderer auto-disposed when the calling component unmounts. */
export function useElevationPreview(
  createWorker: () => WorkerLike = createRenderWorker,
): ElevationRenderer {
  const renderer = createElevationRenderer(createWorker);
  onBeforeUnmount(() => renderer.dispose());
  return renderer;
}

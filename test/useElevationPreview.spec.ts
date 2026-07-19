import { describe, it, expect, vi } from "vite-plus/test";
import { createElevationRenderer, type WorkerLike } from "../src/components/useElevationPreview";

function fakeWorker(): WorkerLike & { posted: unknown[] } {
  return {
    posted: [],
    postMessage(m) {
      this.posted.push(m);
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
}

const REQ = {
  seed0: 1,
  width: 2,
  height: 2,
  originX: 0,
  originY: 0,
  tilesPerPixel: 1,
  waterLevel: 0,
  segmentationMultiplier: 1,
  startingPositions: [{ x: 0, y: 0 }],
};

describe("createElevationRenderer", () => {
  it("posts a request with an incrementing id and resolves on the matching response", async () => {
    const worker = fakeWorker();
    const r = createElevationRenderer(() => worker);
    const p = r.render(REQ);
    const posted = worker.posted[0] as { id: number };
    expect(posted.id).toBe(1);
    worker.onmessage!({
      data: { id: posted.id, buffer: new ArrayBuffer(16), width: 2, height: 2 },
    } as MessageEvent);
    const result = await p;
    expect(result.width).toBe(2);
  });

  it("ignores a response whose id does not match a pending request", async () => {
    const worker = fakeWorker();
    const r = createElevationRenderer(() => worker);
    const p = r.render(REQ);
    // Stale/unknown id: must not throw and must not resolve the pending promise.
    worker.onmessage!({
      data: { id: 999, buffer: new ArrayBuffer(4), width: 1, height: 1 },
    } as MessageEvent);
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const posted = worker.posted[0] as { id: number };
    worker.onmessage!({
      data: { id: posted.id, buffer: new ArrayBuffer(16), width: 2, height: 2 },
    } as MessageEvent);
    await p;
  });

  it("terminates the worker on dispose", () => {
    const worker = fakeWorker();
    createElevationRenderer(() => worker).dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects pending renders when the worker errors", async () => {
    const worker = fakeWorker();
    const r = createElevationRenderer(() => worker);
    const p = r.render(REQ);
    worker.onerror!(new Error("boom"));
    await expect(p).rejects.toBeInstanceOf(Error);
  });
});

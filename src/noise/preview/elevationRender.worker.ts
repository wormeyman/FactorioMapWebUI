/// <reference lib="webworker" />
import { runRenderRequest, type ElevationRenderRequest } from "./elevationRenderRequest";

self.onmessage = (e: MessageEvent<ElevationRenderRequest>) => {
  const result = runRenderRequest(e.data);
  self.postMessage(result, [result.buffer]);
};

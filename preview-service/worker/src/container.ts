import { Container } from "@cloudflare/containers";

export class PreviewContainer extends Container {
  defaultPort = 8080;
  // One-shot renders: keep the idle tail short (memory is billed for the whole
  // awake window). The R2 cache absorbs repeat requests.
  sleepAfter = "20s";
}

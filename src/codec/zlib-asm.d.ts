// The zlib-asm package ships no types for its browser subpath entry, which
// exposes only the pure (Buffer/stream-free) deflate/inflate. Both return a
// Uint8Array. Verified during Phase 1a planning to match the game's zlib@9
// byte-for-byte on all 9 fixtures.
declare module "zlib-asm/browser" {
  export function deflate(input: Uint8Array, level?: number, chunkSize?: number): Uint8Array;
  export function inflate(input: Uint8Array, chunkSize?: number): Uint8Array;
}

import { deflate as zlibDeflate, inflate as zlibInflate } from "zlib-asm/browser";

export function inflate(bytes: Uint8Array): Uint8Array {
  return zlibInflate(bytes);
}

/**
 * zlib deflate pinned to level 9 (Z_BEST_COMPRESSION) to match the `78 da`
 * streams Factorio emits. Backed by zlib-asm (an asm.js port of madler zlib):
 * verified to reproduce all 9 fixtures byte-for-byte, where pako/fflate diverge.
 * Do not change the level or the library: byte-identical string export depends
 * on it (spec Section 6).
 */
export function deflateLevel9(bytes: Uint8Array): Uint8Array {
  return zlibDeflate(bytes, 9);
}

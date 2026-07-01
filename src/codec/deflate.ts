import * as pako from "pako";

export function inflate(bytes: Uint8Array): Uint8Array {
  return pako.inflate(bytes);
}

/**
 * zlib deflate pinned to level 9 (Z_BEST_COMPRESSION) to match the `78 da`
 * streams Factorio emits. Do not change the level: byte-identical string
 * export depends on it (spec Section 6).
 */
export function deflateLevel9(bytes: Uint8Array): Uint8Array {
  return pako.deflate(bytes, { level: 9 });
}

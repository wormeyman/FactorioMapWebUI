/** A concrete unsigned 32-bit map seed (Factorio's seed range). */
export function randomU32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

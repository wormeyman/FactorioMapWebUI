/**
 * The Factorio "Map type" GUI dropdown. Unlike climate controls, elevation is a
 * named noise expression, not a `control:<name>:frequency|bias` constant, so it
 * is a single string enum written to one `property_expression_names` key.
 *
 * Option data captured from Factorio 2.1.10 (base mod) - see
 * docs/mapexchangestrings/maptype-elevation-NOTES.md.
 */
export const ELEVATION_KEY = "elevation";

export interface MapType {
  /** Stable dropdown option id (also the FDropdown option `value`). */
  readonly id: string;
  /** GUI label from core.cfg. */
  readonly label: string;
  /**
   * Value written to pen[ELEVATION_KEY] on selection. `null` marks the default
   * option -> selecting it deletes the key (default-omission), keeping a
   * Default-based preset byte-identical. The option IS the default iff
   * `writeValue === null` (no separate flag, which could desync).
   */
  readonly writeValue: string | null;
  /**
   * Extra explicit values that also read back as this option, beyond
   * `writeValue`. Nauvis aliases the engine's technical-default expression name
   * ("elevation") so an explicit occurrence still shows as Nauvis and is
   * preserved on an untouched read.
   */
  readonly readAliases?: readonly string[];
}

export const MAP_TYPES: readonly MapType[] = [
  { id: "nauvis", label: "Nauvis elevation", writeValue: null, readAliases: ["elevation"] },
  { id: "lakes", label: "Lakes elevation", writeValue: "elevation_lakes" },
  { id: "island", label: "Island elevation", writeValue: "elevation_island" },
];

function defaultType(types: readonly MapType[]): MapType {
  return types.find((t) => t.writeValue === null) ?? types[0];
}

/**
 * Resolve a stored elevation value to a map-type option. Pure; never mutates.
 * - `undefined` (absent key) -> the default option.
 * - a value equal to an option's `writeValue` or a `readAliases` entry -> it.
 * - any other (modded/future) value -> a transient preserve-option carrying it,
 *   so the value is displayed and never silently lost.
 */
export function matchMapType(
  value: string | undefined,
  types: readonly MapType[] = MAP_TYPES,
): MapType {
  if (value === undefined) return defaultType(types);
  for (const t of types) {
    if (t.writeValue === value) return t;
    if (t.readAliases?.includes(value)) return t;
  }
  return { id: value, label: value, writeValue: value };
}

export function readMapType(pen: Record<string, string>): MapType {
  return matchMapType(pen[ELEVATION_KEY]);
}

/**
 * Apply a selected option id to the PEN dict. A known option with a `null`
 * writeValue deletes the key (default-omission); otherwise the writeValue is
 * stored. An id not in MAP_TYPES (the transient preserve-option) writes itself,
 * so re-selecting a preserved unknown value is an idempotent no-op.
 */
export function writeMapType(pen: Record<string, string>, id: string): void {
  const option = MAP_TYPES.find((m) => m.id === id);
  const writeValue = option ? option.writeValue : id;
  if (writeValue === null) {
    delete pen[ELEVATION_KEY];
  } else {
    pen[ELEVATION_KEY] = writeValue;
  }
}

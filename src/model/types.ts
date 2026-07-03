import type { AutoplaceSetting, FormatVersion } from "../codec/mapExchangeString";

export type { AutoplaceSetting, FormatVersion };

export interface Preset {
  name: string;
  builtin: boolean;
  /** null = "Random each new map". Not codec-wired until Phase 1 maps the seed offset. */
  seed: number | null;
  randomEachMap: boolean;
  autoplaceControls: Record<string, AutoplaceSetting>;
  /** Map width in tiles (typed from the mid-block; editable). */
  width: number;
  /** Map height in tiles (typed from the mid-block; editable). */
  height: number;
  /** Base64 of the 6 opaque mid-block bytes before width (unmapped until Phase 1c). */
  opaqueMidHeadB64: string;
  /** Base64 of the 41 opaque mid-block bytes after height (unmapped until Phase 1c). */
  opaqueMidRestB64: string;
  propertyExpressionNames: Record<string, string>;
  /**
   * Base64 of the undecoded payload bytes after property_expression_names
   * (cliffs, MapSettings, difficulty).
   * Carried opaquely so the Phase 1 encoder can round-trip before those
   * fields are individually mapped. Replaced by typed fields in Phase 1.
   */
  opaqueTailB64: string;
  formatVersion: FormatVersion;
}

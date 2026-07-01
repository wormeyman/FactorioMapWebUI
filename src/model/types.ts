import type { AutoplaceSetting, FormatVersion } from "../codec/mapExchangeString";

export type { AutoplaceSetting, FormatVersion };

export interface Preset {
  name: string;
  builtin: boolean;
  /** null = "Random each new map". Not codec-wired until Phase 1 maps the seed offset. */
  seed: number | null;
  randomEachMap: boolean;
  autoplaceControls: Record<string, AutoplaceSetting>;
  /**
   * Base64 of the undecoded 55-byte MapGenSettings block that sits between
   * autoplace and property_expression_names on the wire (terrain / water /
   * starting-area scalars; varies per preset). Mapped to typed fields in
   * Phase 1.
   */
  opaqueMidB64: string;
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

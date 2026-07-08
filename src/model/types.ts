import type { AutoplaceSetting, FormatVersion } from "../codec/mapExchangeString";
import type { CliffSettings, MapSettings } from "./mapSettings";

export type { AutoplaceSetting, FormatVersion };

export interface Preset {
  name: string;
  builtin: boolean;
  /** Map generation seed (u32 LE at mid offset 2). null means "random each new map"; encoded as 0 when null until Task 12 reconciles the random-seed UI. */
  seed: number | null;
  randomEachMap: boolean;
  autoplaceControls: Record<string, AutoplaceSetting>;
  /** Map width in tiles (typed from the mid-block; editable). */
  width: number;
  /** Map height in tiles (typed from the mid-block; editable). */
  height: number;
  /** Starting-area size scale (f32 LE at mid offset 38; typed in Phase 1c). */
  startingArea: number;
  /** peaceful_mode flag (bool at mid offset 42; typed from the mid-block). */
  peacefulMode: boolean;
  /** no_enemies_mode flag (bool at mid offset 43; typed from the mid-block). */
  noEnemiesMode: boolean;
  /** Base64 of the 2 opaque mid-block bytes before seed (unmapped). */
  opaqueMidHeadB64: string;
  /** Base64 of the 24 opaque mid-block bytes between height and starting_area (unmapped). */
  opaqueMidRestAB64: string;
  /** Base64 of the 11 opaque mid-block bytes after no_enemies_mode (unmapped). */
  opaqueMidRestBB64: string;
  propertyExpressionNames: Record<string, string>;
  /**
   * Base64 of the undecoded payload bytes after property_expression_names
   * (cliffs, MapSettings, difficulty).
   * Carried opaquely so the Phase 1 encoder can round-trip before those
   * fields are individually mapped. Replaced by typed fields in Phase 1.
   */
  opaqueTailB64: string;
  /** Nested, typed view of the cliff section of the tail, derived from `opaqueTailB64` for JSON export/display. Read-only this phase; not the round-trip source of truth. */
  cliffSettings: CliffSettings;
  /** Nested, typed view of the MapSettings sections of the tail, derived from `opaqueTailB64` for JSON export/display. Read-only this phase; not the round-trip source of truth. */
  mapSettings: MapSettings;
  formatVersion: FormatVersion;
}

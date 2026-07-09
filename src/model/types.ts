import type { AutoplaceSetting, FormatVersion, StartingPoint } from "../codec/mapExchangeString";
import type { CliffSettings, MapSettings } from "./mapSettings";

export type { AutoplaceSetting, FormatVersion, StartingPoint };

export interface Preset {
  name: string;
  builtin: boolean;
  /**
   * Map generation seed (u32 LE at mid offset 2). `null` is the single source
   * of truth for "random each new map" and encodes to wire 0; a wire 0 decodes
   * back to `null`. The "Random each new map" UI checkbox is a pure computed
   * view over this field (checked iff seed === null).
   */
  seed: number | null;
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
  /** default_enable_all_autoplace_controls (bool at mid offset 1; typed from the mid-block). */
  defaultEnableAllAutoplaceControls: boolean;
  /** Base64 of the 24 opaque mid-block bytes between height and starting_area (BoundingBox-shaped; likely territory_settings, not the 1.x-era area_to_generate_at_start; unmapped). */
  opaqueMidRestAB64: string;
  /** starting_points (MapGenSettings.starting_points): map spawn positions in tile coordinates, typed from the variable-length mid-block trailer. */
  startingPoints: StartingPoint[];
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

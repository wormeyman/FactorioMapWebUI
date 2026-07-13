import type { AutoplaceSetting } from "./types";

/**
 * A derived, non-persisted view of an autoplace control's enabled state. The
 * game encodes "disabled" as `size === 0` (only reachable via the row's
 * checkbox, never a slider notch, which start at ~17%). Keeping the convention
 * here avoids scattering `=== 0` across components.
 */
export function isEnabled(control: AutoplaceSetting): boolean {
  return control.size !== 0;
}

/**
 * Enable -> size 1 (100%); disable -> size 0. `frequency` and `richness` are
 * untouched. Re-enabling always restores size to 1 (no remembered pre-disable
 * value), matching the game's own behavior on import.
 */
export function setEnabled(control: AutoplaceSetting, on: boolean): void {
  control.size = on ? 1 : 0;
}

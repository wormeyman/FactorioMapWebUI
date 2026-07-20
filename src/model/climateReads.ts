/**
 * Reads the `control:*` climate levers from a preset's `property_expression_names`
 * dict, applying the game's own defaults for keys the app model does not carry.
 *
 * Unlike `climateControls.ts` (which stores/reads a GUI-facing "scale" as the
 * inverse of the wire frequency), this helper returns the RAW wire frequency
 * verbatim - the climate noise expressions read `var('control:X:frequency')`
 * directly, with no inversion. Do not reuse `readScale` here.
 */

type Pen = Record<string, string>;

export interface ClimateReads {
  readonly temperature: { readonly frequency: number; readonly bias: number };
  readonly moisture: { readonly frequency: number; readonly bias: number };
  readonly aux: { readonly frequency: number; readonly bias: number };
  readonly startingAreaMoisture: { readonly size: number; readonly frequency: number };
  readonly waterFrequency: number;
}

function readNumber(pen: Pen, key: string, fallback: number): number {
  return Number(pen[key] ?? String(fallback));
}

export function readClimateControls(pen: Pen): ClimateReads {
  return {
    temperature: {
      frequency: readNumber(pen, "control:temperature:frequency", 1),
      bias: readNumber(pen, "control:temperature:bias", 0),
    },
    moisture: {
      frequency: readNumber(pen, "control:moisture:frequency", 1),
      bias: readNumber(pen, "control:moisture:bias", 0),
    },
    aux: {
      frequency: readNumber(pen, "control:aux:frequency", 1),
      bias: readNumber(pen, "control:aux:bias", 0),
    },
    startingAreaMoisture: {
      size: readNumber(pen, "control:starting_area_moisture:size", 1),
      frequency: readNumber(pen, "control:starting_area_moisture:frequency", 1),
    },
    waterFrequency: readNumber(pen, "control:water:frequency", 1),
  };
}

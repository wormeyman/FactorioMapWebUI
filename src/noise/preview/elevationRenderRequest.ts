import type { Point } from "../distanceFromNearestPoint";
import { CLIFF_MARK_RADIUS_PX } from "../cliffs/cliffCatalog";
import type { CliffControls, CliffSettingsInput } from "../cliffs/cliffCatalog";
import type { EnemyControls } from "../enemies/enemyCatalog";
import type { ResourceControlLevers } from "../resources/resolveResource";
import { renderCliffs } from "./renderCliffs";
import { renderElevation } from "./renderElevation";
import { renderEnemies } from "./renderEnemies";
import { renderResources } from "./renderResources";
import { renderTerrain } from "./renderTerrain";

/** A render job posted to the worker. `id` tags the response for staleness. */
export interface ElevationRenderRequest {
  id: number;
  seed0: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  tilesPerPixel: number;
  waterLevel: number;
  segmentationMultiplier: number;
  startingPositions: Point[];
  /** Omitted => the game's real lake positions are computed inside the render. */
  startingLakePositions?: Point[];
  /**
   * Climate controls (Task 12b) - consumed only when `view: "terrain"`; the
   * elevation renderers ignore these. Each defaults to the game's default
   * (freq 1, bias 0, starting-area size/frequency 1) when omitted.
   */
  moistureFrequency?: number;
  moistureBias?: number;
  auxFrequency?: number;
  auxBias?: number;
  startingAreaMoistureSize?: number;
  startingAreaMoistureFrequency?: number;
  /** Which elevation tree to render. Default "lakes". */
  mapType?: "lakes" | "nauvis" | "island";
  /**
   * Which render to run: the water/land elevation mask ("elevation"), the full
   * terrain-tile color render ("terrain"), the terrain with the resource-patch
   * overlay composited on top ("resources"), the terrain with the enemy-base
   * footprint overlay composited on top ("enemies"), or the terrain with the
   * cliff footprint overlay composited on top ("cliffs"), or the terrain with
   * all three overlays composited on top at once ("all"). Default "elevation".
   * renderTerrain (and therefore "resources"/"enemies"/"cliffs"/"all") always uses the
   * Nauvis climate + tile catalog (see renderTerrain.ts), so it is only faithful
   * when `mapType` is "nauvis" - callers (the preview panel) disable those
   * toggles for lakes/island presets rather than send an unfaithful request here.
   */
  view?: "elevation" | "terrain" | "resources" | "enemies" | "cliffs" | "all";
  /**
   * Per-resource control levers (control:<res>:frequency|size|richness), keyed by
   * controlName - consumed only when `view: "resources"`. Missing entries default
   * to 1/1/1 inside the resolver.
   */
  resourceControls?: Record<string, ResourceControlLevers>;
  /**
   * The enemy-base autoplace control's frequency/size (control:enemy-base:*) -
   * consumed only when `view: "enemies"`. Defaults to `{ frequency: 1, size: 1 }`
   * when omitted.
   */
  enemyControls?: EnemyControls;
  /**
   * The `nauvis_cliff` autoplace control's frequency/size (control:nauvis_cliff:*,
   * size doubles as continuity) - consumed only when `view: "cliffs"`. Defaults to
   * `{ frequency: 1, continuity: 1 }` when omitted.
   */
  cliffControls?: CliffControls;
  /**
   * The cliff-related MapGenSettings fields (cliff_elevation_0,
   * cliff_elevation_interval, cliff richness) - consumed only when
   * `view: "cliffs"`. Defaults to `{ cliffElevation0: 10, cliffElevationInterval:
   * 40, richness: 1 }` (the game's defaults) when omitted.
   */
  cliffSettings?: CliffSettingsInput;
  /**
   * The full image this request is one tile of, when the renderer is tiling.
   * Absent means the request *is* the whole image (the single-render path).
   *
   * Used for exactly one thing: clamping the widened cliff cell-query box, so a
   * tiled render reproduces the untiled render byte for byte - including at the
   * image border, where the untiled render drops cliff cells centered outside
   * the image. `tilesPerPixel` is shared with the request.
   */
  fullImage?: {
    readonly originX: number;
    readonly originY: number;
    readonly width: number;
    readonly height: number;
  };
}

/** The rendered pixels, with `buffer` posted back as a transferable. */
export interface ElevationRenderResult {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * The world box to enumerate cliff cells over for `req`: its own pixel box,
 * widened by the cliff mark radius so marks are not clipped at tile seams, then
 * intersected with the full image so the outer border keeps the untiled
 * behavior.
 *
 * The halo is exact rather than conservative. A cell at world `wx` maps to pixel
 * `cx = floor((wx - originX) / tpp)` and paints `cx - r .. cx + r`, so it touches
 * the tile on the low side exactly when `wx - originX >= -r * tpp` (because
 * `floor(v) >= -r` iff `v >= -r` for integer `r`), and on the high side exactly
 * when `wx < x1 + r * tpp`. Those pair with `placedCells`' inclusive-lower,
 * exclusive-upper filter, so widening by `r * tpp` adds every cell that can
 * paint here and none that cannot.
 *
 * Exported for direct unit testing: the tiled-equals-untiled gate pins the
 * widening (drop it and the gate fails) but cannot pin the clamp, which only
 * changes pixels when a cliff cell happens to sit just outside the image border
 * next to non-water terrain.
 */
export function cliffCellQueryBox(req: ElevationRenderRequest): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const tpp = req.tilesPerPixel;
  const x0 = req.originX;
  const y0 = req.originY;
  const x1 = req.originX + req.width * tpp;
  const y1 = req.originY + req.height * tpp;
  const full = req.fullImage;
  if (!full) return { x0, y0, x1, y1 };
  const halo = CLIFF_MARK_RADIUS_PX * tpp;
  return {
    x0: Math.max(x0 - halo, full.originX),
    y0: Math.max(y0 - halo, full.originY),
    x1: Math.min(x1 + halo, full.originX + full.width * tpp),
    y1: Math.min(y1 + halo, full.originY + full.height * tpp),
  };
}

/**
 * Pure render step shared by the worker and its tests: run renderElevation or
 * renderTerrain (per `req.view`) and hand back the transferable RGBA buffer. No
 * Worker or DOM canvas involved.
 */
export function runRenderRequest(req: ElevationRenderRequest): ElevationRenderResult {
  let image: ImageData;
  if (
    req.view === "terrain" ||
    req.view === "resources" ||
    req.view === "enemies" ||
    req.view === "cliffs" ||
    req.view === "all"
  ) {
    image = renderTerrain({
      seed0: req.seed0,
      width: req.width,
      height: req.height,
      originX: req.originX,
      originY: req.originY,
      tilesPerPixel: req.tilesPerPixel,
      ctx: {
        segmentationMultiplier: req.segmentationMultiplier,
        startingPositions: req.startingPositions,
        moistureFrequency: req.moistureFrequency,
        moistureBias: req.moistureBias,
        auxFrequency: req.auxFrequency,
        auxBias: req.auxBias,
        startingAreaMoistureSize: req.startingAreaMoistureSize,
        startingAreaMoistureFrequency: req.startingAreaMoistureFrequency,
      },
    });
    if (req.view === "resources" || req.view === "all") {
      renderResources(image, {
        seed0: req.seed0,
        originX: req.originX,
        originY: req.originY,
        tilesPerPixel: req.tilesPerPixel,
        controls: req.resourceControls ?? {},
        startingPositions: req.startingPositions,
        segmentationMultiplier: req.segmentationMultiplier,
        waterLevel: req.waterLevel,
        startingLakePositions: req.startingLakePositions,
      });
    }
    if (req.view === "enemies" || req.view === "all") {
      renderEnemies(image, {
        seed0: req.seed0,
        originX: req.originX,
        originY: req.originY,
        tilesPerPixel: req.tilesPerPixel,
        controls: req.enemyControls ?? { frequency: 1, size: 1 },
        startingPositions: req.startingPositions,
      });
    }
    if (req.view === "cliffs" || req.view === "all") {
      renderCliffs(image, {
        seed0: req.seed0,
        originX: req.originX,
        originY: req.originY,
        tilesPerPixel: req.tilesPerPixel,
        controls: req.cliffControls ?? { frequency: 1, continuity: 1 },
        settings: req.cliffSettings ?? {
          cliffElevation0: 10,
          cliffElevationInterval: 40,
          richness: 1,
        },
        segmentationMultiplier: req.segmentationMultiplier,
        waterLevel: req.waterLevel,
        startingPositions: req.startingPositions,
        startingLakePositions: req.startingLakePositions,
        cellQueryBox: cliffCellQueryBox(req),
      });
    }
  } else {
    image = renderElevation({
      seed0: req.seed0,
      width: req.width,
      height: req.height,
      originX: req.originX,
      originY: req.originY,
      tilesPerPixel: req.tilesPerPixel,
      mapType: req.mapType,
      ctx: {
        waterLevel: req.waterLevel,
        segmentationMultiplier: req.segmentationMultiplier,
        startingPositions: req.startingPositions,
        startingLakePositions: req.startingLakePositions,
      },
    });
  }
  return { id: req.id, buffer: image.data.buffer, width: req.width, height: req.height };
}

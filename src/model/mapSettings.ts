import type { TailBlock } from "../codec/mapExchangeString";

/**
 * Nested, typed views of the map-exchange tail, derived from the flat
 * dotted-key `TailBlock` purely for JSON export / display. These are NOT the
 * round-trip source of truth - `Preset.opaqueTailB64` (the raw serialized
 * tail) remains that, so encoding stays byte-exact and independent of these
 * views. `cliff.unknownFloat`, `pathFinder.trailingA`, and `opaqueTail` are
 * byte-level round-trip artifacts, not JSON fields, and are intentionally
 * excluded here.
 */

export interface CliffSettings {
  name: string;
  control: string;
  cliffElevation0: number;
  cliffElevationInterval: number;
  cliffSmoothing: number;
  richness: number;
}

export interface PollutionSettings {
  enabled: boolean;
  diffusionRatio: number;
  minToDiffuse: number;
  ageing: number;
  expectedMaxPerChunk: number;
  minToShowPerChunk: number;
  minPollutionToDamageTrees: number;
  pollutionWithMaxForestDamage: number;
  pollutionPerTreeDamage: number;
  pollutionRestoredPerTreeDamage: number;
  maxPollutionToRestoreTrees: number;
  enemyAttackPollutionConsumptionModifier: number;
}

export interface EnemyEvolutionSettings {
  enabled: boolean;
  timeFactor: number;
  destroyFactor: number;
  pollutionFactor: number;
}

export interface EnemyExpansionSettings {
  enabled: boolean;
  maxExpansionDistance: number;
  minExpansionDistance: number;
  friendlyBaseInfluenceRadius: number;
  enemyBuildingInfluenceRadius: number;
  buildingCoefficient: number;
  otherBaseCoefficient: number;
  neighbouringChunkCoefficient: number;
  neighbouringBaseChunkCoefficient: number;
  maxCollidingTilesCoefficient: number;
  settlerGroupMinSize: number;
  settlerGroupMaxSize: number;
  evolutionGroupSizeFactor: number;
  minExpansionCooldown: number;
  maxExpansionCooldown: number;
}

export interface UnitGroupSettings {
  minGroupGatheringTime: number;
  maxGroupGatheringTime: number;
  maxWaitTimeForLateMembers: number;
  maxGroupRadius: number;
  minGroupRadius: number;
  maxMemberSpeedupWhenBehind: number;
  maxMemberSlowdownWhenAhead: number;
  maxGroupSlowdownFactor: number;
  maxGroupMemberFallbackFactor: number;
  memberDisownDistance: number;
  tickToleranceWhenMemberArrives: number;
  maxGatheringUnitGroups: number;
  maxUnitGroupSize: number;
}

export interface PathFinderSettings {
  fwd2bwdRatio: number;
  goalPressureRatio: number;
  maxStepsWorkedPerTick: number;
  maxWorkDonePerTick: number;
  usePathCache: boolean;
  shortCacheSize: number;
  longCacheSize: number;
  shortCacheMinCacheableDistance: number;
  shortCacheMinAlgoStepsToCache: number;
  longCacheMinCacheableDistance: number;
  cacheMaxConnectToCacheStepsMultiplier: number;
  cacheAcceptPathStartDistanceRatio: number;
  cacheAcceptPathEndDistanceRatio: number;
  negativeCacheAcceptPathStartDistanceRatio: number;
  negativeCacheAcceptPathEndDistanceRatio: number;
  cachePathStartDistanceRatingMultiplier: number;
  cachePathEndDistanceRatingMultiplier: number;
  staleEnemyWithSameDestinationCollisionPenalty: number;
  ignoreMovingEnemyCollisionDistance: number;
  enemyWithDifferentDestinationCollisionPenalty: number;
  generalEntityCollisionPenalty: number;
  generalEntitySubsequentCollisionPenalty: number;
  extendedCollisionPenalty: number;
  maxClientsToAcceptAnyNewRequest: number;
  maxClientsToAcceptShortNewRequest: number;
  directDistanceToConsiderShortRequest: number;
  shortRequestMaxSteps: number;
  shortRequestRatio: number;
  minStepsToCheckPathFindTermination: number;
  startToGoalCostMultiplierToTerminatePathFind: number;
  overloadLevels: number[];
  overloadMultipliers: number[];
  negativePathCacheDelayInterval: number;
}

export interface DifficultySettings {
  technologyPriceMultiplier: number;
  spoilTimeModifier: number;
}

export interface AsteroidsSettings {
  spawningRate: number;
  maxRayPortalsExpandedPerTick: number;
}

export interface MapSettings {
  pollution: PollutionSettings;
  enemyEvolution: EnemyEvolutionSettings;
  enemyExpansion: EnemyExpansionSettings;
  unitGroup: UnitGroupSettings;
  pathFinder: PathFinderSettings;
  difficulty: DifficultySettings;
  asteroids: AsteroidsSettings;
  maxFailedBehaviorCount: number;
}

/**
 * Reshape the flat dotted-key tail into nested, JSON-serializable views for
 * export/display. Reads each known dotted key explicitly (rather than a
 * blind generic split) so byte-level round-trip artifacts -
 * `cliff.unknownFloat`, `pathFinder.trailingA`, and `opaqueTail` - are never
 * dragged into the result.
 */
export function tailToNested(tail: TailBlock): { cliff: CliffSettings; mapSettings: MapSettings } {
  const cliff: CliffSettings = {
    name: tail["cliff.name"] as string,
    control: tail["cliff.control"] as string,
    cliffElevation0: tail["cliff.cliffElevation0"] as number,
    cliffElevationInterval: tail["cliff.cliffElevationInterval"] as number,
    cliffSmoothing: tail["cliff.cliffSmoothing"] as number,
    richness: tail["cliff.richness"] as number,
  };

  const mapSettings: MapSettings = {
    pollution: {
      enabled: tail["pollution.enabled"] as boolean,
      diffusionRatio: tail["pollution.diffusionRatio"] as number,
      minToDiffuse: tail["pollution.minToDiffuse"] as number,
      ageing: tail["pollution.ageing"] as number,
      expectedMaxPerChunk: tail["pollution.expectedMaxPerChunk"] as number,
      minToShowPerChunk: tail["pollution.minToShowPerChunk"] as number,
      minPollutionToDamageTrees: tail["pollution.minPollutionToDamageTrees"] as number,
      pollutionWithMaxForestDamage: tail["pollution.pollutionWithMaxForestDamage"] as number,
      pollutionPerTreeDamage: tail["pollution.pollutionPerTreeDamage"] as number,
      pollutionRestoredPerTreeDamage: tail["pollution.pollutionRestoredPerTreeDamage"] as number,
      maxPollutionToRestoreTrees: tail["pollution.maxPollutionToRestoreTrees"] as number,
      enemyAttackPollutionConsumptionModifier: tail[
        "pollution.enemyAttackPollutionConsumptionModifier"
      ] as number,
    },
    enemyEvolution: {
      enabled: tail["enemyEvolution.enabled"] as boolean,
      timeFactor: tail["enemyEvolution.timeFactor"] as number,
      destroyFactor: tail["enemyEvolution.destroyFactor"] as number,
      pollutionFactor: tail["enemyEvolution.pollutionFactor"] as number,
    },
    enemyExpansion: {
      enabled: tail["enemyExpansion.enabled"] as boolean,
      maxExpansionDistance: tail["enemyExpansion.maxExpansionDistance"] as number,
      minExpansionDistance: tail["enemyExpansion.minExpansionDistance"] as number,
      friendlyBaseInfluenceRadius: tail["enemyExpansion.friendlyBaseInfluenceRadius"] as number,
      enemyBuildingInfluenceRadius: tail["enemyExpansion.enemyBuildingInfluenceRadius"] as number,
      buildingCoefficient: tail["enemyExpansion.buildingCoefficient"] as number,
      otherBaseCoefficient: tail["enemyExpansion.otherBaseCoefficient"] as number,
      neighbouringChunkCoefficient: tail["enemyExpansion.neighbouringChunkCoefficient"] as number,
      neighbouringBaseChunkCoefficient: tail[
        "enemyExpansion.neighbouringBaseChunkCoefficient"
      ] as number,
      maxCollidingTilesCoefficient: tail["enemyExpansion.maxCollidingTilesCoefficient"] as number,
      settlerGroupMinSize: tail["enemyExpansion.settlerGroupMinSize"] as number,
      settlerGroupMaxSize: tail["enemyExpansion.settlerGroupMaxSize"] as number,
      evolutionGroupSizeFactor: tail["enemyExpansion.evolutionGroupSizeFactor"] as number,
      minExpansionCooldown: tail["enemyExpansion.minExpansionCooldown"] as number,
      maxExpansionCooldown: tail["enemyExpansion.maxExpansionCooldown"] as number,
    },
    unitGroup: {
      minGroupGatheringTime: tail["unitGroup.minGroupGatheringTime"] as number,
      maxGroupGatheringTime: tail["unitGroup.maxGroupGatheringTime"] as number,
      maxWaitTimeForLateMembers: tail["unitGroup.maxWaitTimeForLateMembers"] as number,
      maxGroupRadius: tail["unitGroup.maxGroupRadius"] as number,
      minGroupRadius: tail["unitGroup.minGroupRadius"] as number,
      maxMemberSpeedupWhenBehind: tail["unitGroup.maxMemberSpeedupWhenBehind"] as number,
      maxMemberSlowdownWhenAhead: tail["unitGroup.maxMemberSlowdownWhenAhead"] as number,
      maxGroupSlowdownFactor: tail["unitGroup.maxGroupSlowdownFactor"] as number,
      maxGroupMemberFallbackFactor: tail["unitGroup.maxGroupMemberFallbackFactor"] as number,
      memberDisownDistance: tail["unitGroup.memberDisownDistance"] as number,
      tickToleranceWhenMemberArrives: tail["unitGroup.tickToleranceWhenMemberArrives"] as number,
      maxGatheringUnitGroups: tail["unitGroup.maxGatheringUnitGroups"] as number,
      maxUnitGroupSize: tail["unitGroup.maxUnitGroupSize"] as number,
    },
    pathFinder: {
      fwd2bwdRatio: tail["pathFinder.fwd2bwdRatio"] as number,
      goalPressureRatio: tail["pathFinder.goalPressureRatio"] as number,
      maxStepsWorkedPerTick: tail["pathFinder.maxStepsWorkedPerTick"] as number,
      maxWorkDonePerTick: tail["pathFinder.maxWorkDonePerTick"] as number,
      usePathCache: tail["pathFinder.usePathCache"] as boolean,
      shortCacheSize: tail["pathFinder.shortCacheSize"] as number,
      longCacheSize: tail["pathFinder.longCacheSize"] as number,
      shortCacheMinCacheableDistance: tail["pathFinder.shortCacheMinCacheableDistance"] as number,
      shortCacheMinAlgoStepsToCache: tail["pathFinder.shortCacheMinAlgoStepsToCache"] as number,
      longCacheMinCacheableDistance: tail["pathFinder.longCacheMinCacheableDistance"] as number,
      cacheMaxConnectToCacheStepsMultiplier: tail[
        "pathFinder.cacheMaxConnectToCacheStepsMultiplier"
      ] as number,
      cacheAcceptPathStartDistanceRatio: tail[
        "pathFinder.cacheAcceptPathStartDistanceRatio"
      ] as number,
      cacheAcceptPathEndDistanceRatio: tail["pathFinder.cacheAcceptPathEndDistanceRatio"] as number,
      negativeCacheAcceptPathStartDistanceRatio: tail[
        "pathFinder.negativeCacheAcceptPathStartDistanceRatio"
      ] as number,
      negativeCacheAcceptPathEndDistanceRatio: tail[
        "pathFinder.negativeCacheAcceptPathEndDistanceRatio"
      ] as number,
      cachePathStartDistanceRatingMultiplier: tail[
        "pathFinder.cachePathStartDistanceRatingMultiplier"
      ] as number,
      cachePathEndDistanceRatingMultiplier: tail[
        "pathFinder.cachePathEndDistanceRatingMultiplier"
      ] as number,
      staleEnemyWithSameDestinationCollisionPenalty: tail[
        "pathFinder.staleEnemyWithSameDestinationCollisionPenalty"
      ] as number,
      ignoreMovingEnemyCollisionDistance: tail[
        "pathFinder.ignoreMovingEnemyCollisionDistance"
      ] as number,
      enemyWithDifferentDestinationCollisionPenalty: tail[
        "pathFinder.enemyWithDifferentDestinationCollisionPenalty"
      ] as number,
      generalEntityCollisionPenalty: tail["pathFinder.generalEntityCollisionPenalty"] as number,
      generalEntitySubsequentCollisionPenalty: tail[
        "pathFinder.generalEntitySubsequentCollisionPenalty"
      ] as number,
      extendedCollisionPenalty: tail["pathFinder.extendedCollisionPenalty"] as number,
      maxClientsToAcceptAnyNewRequest: tail["pathFinder.maxClientsToAcceptAnyNewRequest"] as number,
      maxClientsToAcceptShortNewRequest: tail[
        "pathFinder.maxClientsToAcceptShortNewRequest"
      ] as number,
      directDistanceToConsiderShortRequest: tail[
        "pathFinder.directDistanceToConsiderShortRequest"
      ] as number,
      shortRequestMaxSteps: tail["pathFinder.shortRequestMaxSteps"] as number,
      shortRequestRatio: tail["pathFinder.shortRequestRatio"] as number,
      minStepsToCheckPathFindTermination: tail[
        "pathFinder.minStepsToCheckPathFindTermination"
      ] as number,
      startToGoalCostMultiplierToTerminatePathFind: tail[
        "pathFinder.startToGoalCostMultiplierToTerminatePathFind"
      ] as number,
      overloadLevels: tail["pathFinder.overloadLevels"] as number[],
      overloadMultipliers: tail["pathFinder.overloadMultipliers"] as number[],
      negativePathCacheDelayInterval: tail["pathFinder.negativePathCacheDelayInterval"] as number,
    },
    difficulty: {
      technologyPriceMultiplier: tail["difficulty.technologyPriceMultiplier"] as number,
      spoilTimeModifier: tail["difficulty.spoilTimeModifier"] as number,
    },
    asteroids: {
      spawningRate: tail["asteroids.spawningRate"] as number,
      maxRayPortalsExpandedPerTick: tail["asteroids.maxRayPortalsExpandedPerTick"] as number,
    },
    maxFailedBehaviorCount: tail["maxFailedBehaviorCount"] as number,
  };

  return { cliff, mapSettings };
}

/**
 * Overlay the two editable enemy sections back onto a flat `TailBlock` - the
 * exact inverse of the `enemyEvolution.*` / `enemyExpansion.*` reads in
 * `tailToNested`. Writes ONLY enemy dotted keys (never the sibling
 * pollution/unitGroup/pathFinder/difficulty/asteroids keys, which stay
 * carried opaquely), and copies a field only when `value !== undefined` so a
 * field that decoded genuinely absent is not spuriously added. A `false` /
 * `0` edit IS written (that is the point of the undefined-check rather than a
 * truthiness check). Used by `presetToEncodable` to make these sections
 * round-trip-editable while every other tail byte round-trips from
 * `opaqueTailB64`.
 */
export function writeEnemyToTail(
  tail: TailBlock,
  evolution: EnemyEvolutionSettings,
  expansion: EnemyExpansionSettings,
): void {
  const put = (key: string, value: number | boolean | undefined) => {
    if (value !== undefined) tail[key] = value;
  };

  put("enemyEvolution.enabled", evolution.enabled);
  put("enemyEvolution.timeFactor", evolution.timeFactor);
  put("enemyEvolution.destroyFactor", evolution.destroyFactor);
  put("enemyEvolution.pollutionFactor", evolution.pollutionFactor);

  put("enemyExpansion.enabled", expansion.enabled);
  put("enemyExpansion.maxExpansionDistance", expansion.maxExpansionDistance);
  put("enemyExpansion.minExpansionDistance", expansion.minExpansionDistance);
  put("enemyExpansion.friendlyBaseInfluenceRadius", expansion.friendlyBaseInfluenceRadius);
  put("enemyExpansion.enemyBuildingInfluenceRadius", expansion.enemyBuildingInfluenceRadius);
  put("enemyExpansion.buildingCoefficient", expansion.buildingCoefficient);
  put("enemyExpansion.otherBaseCoefficient", expansion.otherBaseCoefficient);
  put("enemyExpansion.neighbouringChunkCoefficient", expansion.neighbouringChunkCoefficient);
  put(
    "enemyExpansion.neighbouringBaseChunkCoefficient",
    expansion.neighbouringBaseChunkCoefficient,
  );
  put("enemyExpansion.maxCollidingTilesCoefficient", expansion.maxCollidingTilesCoefficient);
  put("enemyExpansion.settlerGroupMinSize", expansion.settlerGroupMinSize);
  put("enemyExpansion.settlerGroupMaxSize", expansion.settlerGroupMaxSize);
  put("enemyExpansion.evolutionGroupSizeFactor", expansion.evolutionGroupSizeFactor);
  put("enemyExpansion.minExpansionCooldown", expansion.minExpansionCooldown);
  put("enemyExpansion.maxExpansionCooldown", expansion.maxExpansionCooldown);
}

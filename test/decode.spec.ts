import { describe, expect, it } from "vite-plus/test";
import { bytesToBase64 } from "../src/codec/base64";
import { crc32 } from "../src/codec/crc32";
import { deflateLevel9 } from "../src/codec/deflate";
import { decodeExchangeString, ExchangeStringError } from "../src/codec/mapExchangeString";
import fixtures from "./fixtures/builtin-presets.json";
import mapDefaults from "./fixtures/map-settings.example.json";

const presets = fixtures.presets as Record<string, string>;
const NAMES = Object.keys(presets);

describe("decodeExchangeString", () => {
  it.each(NAMES)("decodes %s as format 2.1.9.3 with a valid CRC", (name) => {
    const decoded = decodeExchangeString(presets[name] as string);
    expect(decoded.version).toEqual([2, 1, 9, 3]);
    expect(decoded.flagByte).toBe(0);
  });

  it.each(NAMES)("payload size of %s matches the recorded _decodeStatus", (name) => {
    const status = (fixtures._decodeStatus as Record<string, string>)[name] as string;
    const expectedSize = Number(/\((\d+) bytes/.exec(status)?.[1]);
    expect(decodeExchangeString(presets[name] as string).payload.length).toBe(expectedSize);
  });

  it("ignores whitespace/newlines inside the base64 body", () => {
    const wrapped = presets["Default"] as string;
    const compact = wrapped.replaceAll(/\s+/g, "");
    const rewrapped = `>>>\n${compact.slice(3, -3).replaceAll(/(.{57})/g, "$1\n")}\n<<<`;
    expect(decodeExchangeString(rewrapped).payload).toEqual(decodeExchangeString(wrapped).payload);
  });

  it("reads 28 autoplace controls from Default, in ordinal key order", () => {
    const controls = decodeExchangeString(presets["Default"] as string).autoplaceControls;
    const keys = Object.keys(controls);
    expect(keys).toHaveLength(28);
    // Wire order is ordinal (code-point) sorted; JS default sort is code-unit
    // order, identical for these ASCII names ('-' 0x2d sorts before '_' 0x5f).
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain("coal");
    expect(keys).toContain("vulcanus_coal");
    expect(keys).toContain("aquilo_crude_oil");
    expect(controls["coal"]).toEqual({ frequency: 1, size: 1, richness: 1 });
  });

  it("Rich Resources differs from Default exactly by richness 2.0 on the six nauvis resources", () => {
    const def = decodeExchangeString(presets["Default"] as string).autoplaceControls;
    const rich = decodeExchangeString(presets["Rich Resources"] as string).autoplaceControls;
    expect(Object.keys(rich)).toEqual(Object.keys(def));
    const changed: string[] = [];
    for (const [name, value] of Object.entries(rich)) {
      const base = def[name] as (typeof rich)[string];
      if (
        value.frequency !== base.frequency ||
        value.size !== base.size ||
        value.richness !== base.richness
      ) {
        changed.push(name);
        expect(value.frequency).toBe(base.frequency);
        expect(value.size).toBe(base.size);
        expect(value.richness).toBe(2);
      }
    }
    expect(changed.sort()).toEqual([
      "coal",
      "copper-ore",
      "crude-oil",
      "iron-ore",
      "stone",
      "uranium-ore",
    ]);
  });

  it.each(NAMES)(
    "mid block of %s splits into head(2) + seed + width + height + restA(24) + startingArea + restB(13)",
    (name) => {
      const mid = decodeExchangeString(presets[name] as string).mid;
      expect(mid.opaqueHead.length).toBe(2);
      expect(mid.opaqueRestA.length).toBe(24);
      expect(mid.opaqueRestB.length).toBe(13);
      expect(mid.width).toBe(2000000);
      expect(typeof mid.seed).toBe("number");
      expect(typeof mid.startingArea).toBe("number");
    },
  );

  it("types seed and starting_area from the mid-block", () => {
    const mid = decodeExchangeString(presets["Default"] as string).mid;
    expect(mid.seed).toBe(34658944); // 0x0210DA80, Default's baked seed
    expect(mid.startingArea).toBeCloseTo(1.0, 6);
    expect(mid.opaqueHead.length).toBe(2);
    expect(mid.opaqueRestA.length).toBe(24);
    expect(mid.opaqueRestB.length).toBe(13);
  });

  it("types map width and height from the mid-block (Ribbon world proves the height offset)", () => {
    expect(decodeExchangeString(presets["Default"] as string).mid.height).toBe(2000000);
    // Ribbon world is the only fixture with a non-default height (128), which is
    // what pins the u32 height offset at mid+10.
    expect(decodeExchangeString(presets["Ribbon world"] as string).mid.height).toBe(128);
    expect(decodeExchangeString(presets["Ribbon world"] as string).mid.width).toBe(2000000);
  });

  it("property_expression_names is empty in Default and pinned in Lakes, Island, Ribbon world", () => {
    expect(decodeExchangeString(presets["Default"] as string).propertyExpressionNames).toEqual({});
    const lakesKeys = [
      "aux",
      "cliff_elevation",
      "cliffiness",
      "elevation",
      "moisture",
      "trees_forest_path_cutout",
    ];
    expect(
      Object.keys(decodeExchangeString(presets["Lakes"] as string).propertyExpressionNames),
    ).toEqual(lakesKeys);
    expect(
      Object.keys(decodeExchangeString(presets["Island"] as string).propertyExpressionNames),
    ).toEqual(lakesKeys);
    expect(
      Object.keys(decodeExchangeString(presets["Ribbon world"] as string).propertyExpressionNames),
    ).toEqual(["elevation", "trees_forest_path_cutout"]);
  });

  it.each(NAMES)("tail of %s is fully typed: opaqueTail is empty", (name) => {
    expect(
      (decodeExchangeString(presets[name] as string).tail.opaqueTail as Uint8Array).length,
    ).toBe(0);
  });

  it("resolves the cliff anomaly: Default cliff name is 'cliff', others are ''", () => {
    expect(decodeExchangeString(presets["Default"] as string).tail["cliff.name"]).toBe("cliff");
    for (const name of NAMES.filter((n) => n !== "Default")) {
      expect(decodeExchangeString(presets[name] as string).tail["cliff.name"]).toBe("");
    }
  });

  it("decodes the cliff control string (empty across the corpus)", () => {
    expect(decodeExchangeString(presets["Default"] as string).tail["cliff.control"]).toBe("");
  });

  it("types the cliff floats and the pollution section for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["cliff.cliffElevation0"]).toBeCloseTo(10, 4);
    expect(t["cliff.cliffElevationInterval"]).toBeCloseTo(40, 4);
    expect(t["pollution.diffusionRatio"]).toBeCloseTo(0.02, 9);
    expect(t["pollution.minToDiffuse"]).toBeCloseTo(15, 9);
    expect(t["pollution.expectedMaxPerChunk"]).toBeCloseTo(150, 9);
    expect(t["pollution.enemyAttackPollutionConsumptionModifier"]).toBeCloseTo(1, 9);
  });

  it("types enemy_evolution and enemy_expansion for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["enemyEvolution.timeFactor"]).toBeCloseTo(0.000004, 12);
    expect(t["enemyEvolution.destroyFactor"]).toBeCloseTo(0.002, 9);
    expect(t["enemyEvolution.pollutionFactor"]).toBeCloseTo(0.0000009, 12);
    expect(t["enemyExpansion.maxExpansionDistance"]).toBe(5);
    expect(t["enemyExpansion.otherBaseCoefficient"]).toBeCloseTo(3.0, 9);
    expect(t["enemyExpansion.maxExpansionCooldown"]).toBe(216000);
  });

  it("Death world has a higher enemy_evolution time_factor than Default", () => {
    const def = decodeExchangeString(presets["Default"] as string).tail;
    const dw = decodeExchangeString(presets["Death world"] as string).tail;
    expect(dw["enemyEvolution.timeFactor"]).not.toBe(def["enemyEvolution.timeFactor"]);
  });

  it("types the unit_group section for Default, matching every map-settings.example.json default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    const ug = mapDefaults.unit_group;
    expect(t["unitGroup.minGroupGatheringTime"]).toBe(ug.min_group_gathering_time);
    expect(t["unitGroup.maxGroupGatheringTime"]).toBe(ug.max_group_gathering_time);
    expect(t["unitGroup.maxWaitTimeForLateMembers"]).toBe(ug.max_wait_time_for_late_members);
    expect(t["unitGroup.maxGroupRadius"]).toBeCloseTo(ug.max_group_radius, 6);
    expect(t["unitGroup.minGroupRadius"]).toBeCloseTo(ug.min_group_radius, 6);
    expect(t["unitGroup.maxMemberSpeedupWhenBehind"]).toBeCloseTo(
      ug.max_member_speedup_when_behind,
      6,
    );
    expect(t["unitGroup.maxMemberSlowdownWhenAhead"]).toBeCloseTo(
      ug.max_member_slowdown_when_ahead,
      6,
    );
    expect(t["unitGroup.maxGroupSlowdownFactor"]).toBeCloseTo(ug.max_group_slowdown_factor, 6);
    expect(t["unitGroup.maxGroupMemberFallbackFactor"]).toBeCloseTo(
      ug.max_group_member_fallback_factor,
      6,
    );
    expect(t["unitGroup.memberDisownDistance"]).toBeCloseTo(ug.member_disown_distance, 6);
    expect(t["unitGroup.tickToleranceWhenMemberArrives"]).toBe(
      ug.tick_tolerance_when_member_arrives,
    );
    expect(t["unitGroup.maxGatheringUnitGroups"]).toBe(ug.max_gathering_unit_groups);
    expect(t["unitGroup.maxUnitGroupSize"]).toBe(ug.max_unit_group_size);
  });

  it("types the path_finder section incl. overload arrays for Default, matching every map-settings.example.json default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    const pf = mapDefaults.path_finder;
    expect(t["pathFinder.fwd2bwdRatio"]).toBe(pf.fwd2bwd_ratio);
    expect(t["pathFinder.goalPressureRatio"]).toBeCloseTo(pf.goal_pressure_ratio, 6);
    expect(t["pathFinder.maxStepsWorkedPerTick"]).toBe(pf.max_steps_worked_per_tick);
    expect(t["pathFinder.maxWorkDonePerTick"]).toBe(pf.max_work_done_per_tick);
    expect(t["pathFinder.usePathCache"]).toBe(pf.use_path_cache);
    expect(t["pathFinder.shortCacheSize"]).toBe(pf.short_cache_size);
    expect(t["pathFinder.longCacheSize"]).toBe(pf.long_cache_size);
    expect(t["pathFinder.shortCacheMinCacheableDistance"]).toBe(
      pf.short_cache_min_cacheable_distance,
    );
    expect(t["pathFinder.shortCacheMinAlgoStepsToCache"]).toBe(
      pf.short_cache_min_algo_steps_to_cache,
    );
    expect(t["pathFinder.longCacheMinCacheableDistance"]).toBe(
      pf.long_cache_min_cacheable_distance,
    );
    expect(t["pathFinder.cacheMaxConnectToCacheStepsMultiplier"]).toBe(
      pf.cache_max_connect_to_cache_steps_multiplier,
    );
    expect(t["pathFinder.cacheAcceptPathStartDistanceRatio"]).toBeCloseTo(
      pf.cache_accept_path_start_distance_ratio,
      6,
    );
    expect(t["pathFinder.cacheAcceptPathEndDistanceRatio"]).toBeCloseTo(
      pf.cache_accept_path_end_distance_ratio,
      6,
    );
    expect(t["pathFinder.negativeCacheAcceptPathStartDistanceRatio"]).toBeCloseTo(
      pf.negative_cache_accept_path_start_distance_ratio,
      6,
    );
    expect(t["pathFinder.negativeCacheAcceptPathEndDistanceRatio"]).toBeCloseTo(
      pf.negative_cache_accept_path_end_distance_ratio,
      6,
    );
    expect(t["pathFinder.cachePathStartDistanceRatingMultiplier"]).toBe(
      pf.cache_path_start_distance_rating_multiplier,
    );
    expect(t["pathFinder.cachePathEndDistanceRatingMultiplier"]).toBe(
      pf.cache_path_end_distance_rating_multiplier,
    );
    expect(t["pathFinder.staleEnemyWithSameDestinationCollisionPenalty"]).toBeCloseTo(
      pf.stale_enemy_with_same_destination_collision_penalty,
      6,
    );
    expect(t["pathFinder.ignoreMovingEnemyCollisionDistance"]).toBeCloseTo(
      pf.ignore_moving_enemy_collision_distance,
      6,
    );
    expect(t["pathFinder.enemyWithDifferentDestinationCollisionPenalty"]).toBeCloseTo(
      pf.enemy_with_different_destination_collision_penalty,
      6,
    );
    expect(t["pathFinder.generalEntityCollisionPenalty"]).toBeCloseTo(
      pf.general_entity_collision_penalty,
      6,
    );
    expect(t["pathFinder.generalEntitySubsequentCollisionPenalty"]).toBeCloseTo(
      pf.general_entity_subsequent_collision_penalty,
      6,
    );
    expect(t["pathFinder.extendedCollisionPenalty"]).toBeCloseTo(pf.extended_collision_penalty, 6);
    expect(t["pathFinder.maxClientsToAcceptAnyNewRequest"]).toBe(
      pf.max_clients_to_accept_any_new_request,
    );
    expect(t["pathFinder.maxClientsToAcceptShortNewRequest"]).toBe(
      pf.max_clients_to_accept_short_new_request,
    );
    expect(t["pathFinder.directDistanceToConsiderShortRequest"]).toBe(
      pf.direct_distance_to_consider_short_request,
    );
    expect(t["pathFinder.shortRequestMaxSteps"]).toBe(pf.short_request_max_steps);
    expect(t["pathFinder.shortRequestRatio"]).toBeCloseTo(pf.short_request_ratio, 6);
    expect(t["pathFinder.minStepsToCheckPathFindTermination"]).toBe(
      pf.min_steps_to_check_path_find_termination,
    );
    expect(t["pathFinder.startToGoalCostMultiplierToTerminatePathFind"]).toBeCloseTo(
      pf.start_to_goal_cost_multiplier_to_terminate_path_find,
      6,
    );
    expect(t["pathFinder.overloadLevels"]).toEqual(pf.overload_levels);
    expect(t["pathFinder.overloadMultipliers"]).toEqual(pf.overload_multipliers);
    expect(t["pathFinder.negativePathCacheDelayInterval"]).toBe(
      pf.negative_path_cache_delay_interval,
    );
  });

  it("types difficulty/asteroids/max_failed and closes the opaque tail for Default", () => {
    const t = decodeExchangeString(presets["Default"] as string).tail;
    expect(t["difficulty.technologyPriceMultiplier"]).toBeCloseTo(
      mapDefaults.difficulty_settings.technology_price_multiplier,
      6,
    );
    expect(t["difficulty.spoilTimeModifier"]).toBeCloseTo(
      mapDefaults.difficulty_settings.spoil_time_modifier,
      6,
    );
    expect(t["asteroids.spawningRate"]).toBeCloseTo(mapDefaults.asteroids.spawning_rate, 6);
    expect(t["asteroids.maxRayPortalsExpandedPerTick"]).toBe(
      mapDefaults.asteroids.max_ray_portals_expanded_per_tick,
    );
    expect(t["maxFailedBehaviorCount"]).toBe(mapDefaults.max_failed_behavior_count);
    // Whole MapSettings typed: no bytes left over.
    expect((t["opaqueTail"] as Uint8Array).length).toBe(0);
  });

  it("Marathon has technology_price_multiplier 4", () => {
    const t = decodeExchangeString(presets["Marathon"] as string).tail;
    expect(t["difficulty.technologyPriceMultiplier"]).toBeCloseTo(4.0, 6);
  });

  it("rejects a missing envelope", () => {
    expect(() => decodeExchangeString("eNqLjgUAARUAuQ==")).toThrow(ExchangeStringError);
    expect(() => decodeExchangeString(">>>eNqLjgUAARUAuQ==")).toThrow(ExchangeStringError);
  });

  it("rejects invalid base64 and invalid zlib streams", () => {
    expect(() => decodeExchangeString(">>>!!!!<<<")).toThrow(ExchangeStringError);
    expect(() => decodeExchangeString(">>>AAAAAAAA<<<")).toThrow(ExchangeStringError);
  });

  it("rejects a payload whose CRC does not match", () => {
    const good = decodeExchangeString(presets["Default"] as string);
    const corrupted = good.payload.slice();
    corrupted[20] = (corrupted[20] as number) ^ 0xff;
    const tampered = `>>>${bytesToBase64(deflateLevel9(corrupted))}<<<`;
    expect(() => decodeExchangeString(tampered)).toThrow(/CRC/);
  });

  it("rejects a payload with an unsupported format version", () => {
    const good = decodeExchangeString(presets["Default"] as string);
    const body = good.payload.slice(0, -4);
    body[0] = 3; // version major 2 -> 3 (uint16 LE low byte)
    const crc = crc32(body);
    const tampered = new Uint8Array(body.length + 4);
    tampered.set(body, 0);
    new DataView(tampered.buffer).setUint32(body.length, crc, true);
    const restrung = `>>>${bytesToBase64(deflateLevel9(tampered))}<<<`;
    expect(() => decodeExchangeString(restrung)).toThrow(/unsupported exchange format 3\.1\.9\.3/);
  });
});

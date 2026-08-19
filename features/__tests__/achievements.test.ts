import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAchievementRepository = {
  findByPlayerId: vi.fn(),
  findSummariesByPlayerId: vi.fn(),
  upsertMany: vi.fn().mockResolvedValue(undefined),
  deleteByPlayerId: vi.fn(),
};

const mockPlayerRepository = {
  findReferralFieldsById: vi.fn().mockResolvedValue(null),
};

const mockResultRepository = {
  countByPlayerId: vi.fn().mockResolvedValue(0),
  findWinIdsByPlayerId: vi.fn().mockResolvedValue([]),
  findRatingPointsByPlayerId: vi.fn().mockResolvedValue([]),
  findKnockoutsByPlayerId: vi.fn().mockResolvedValue([]),
  countItmFinishesByPlayerId: vi.fn().mockResolvedValue(0),
  findBossKnockoutsByPlayerId: vi.fn().mockResolvedValue([]),
  findArrivedTournamentIdsByPlayerId: vi.fn().mockResolvedValue([]),
  findArrivedPlacementsByPlayerId: vi.fn().mockResolvedValue([]),
};

const mockTournamentRepository = {
  listCompleted: vi.fn().mockResolvedValue([]),
};

const mockGetAppSetting = vi.fn();

vi.mock("@/lib/repositories", () => ({
  achievementRepository: mockAchievementRepository,
  playerRepository: mockPlayerRepository,
  resultRepository: mockResultRepository,
  tournamentRepository: mockTournamentRepository,
}));

vi.mock("@/lib/app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

// Imported after the mock so features/achievements.ts picks up the fakes,
// not the real Repository Layer -- same pattern already used by
// features/__tests__/waitlist.test.ts for its own vi.mock target.
const {
  syncPlayerAchievements,
  syncPlayersAchievementsIfEnabled,
  isAutomaticAchievementsEnabled,
  getManualAchievementsForPlayer,
  grantManualAchievement,
  revokeManualAchievement,
} = await import("@/features/achievements");

const PLAYER_ID = "player-1";
const NOW_ISO = "2026-08-19T12:00:00.000Z";

function upsertedPayload() {
  return mockAchievementRepository.upsertMany.mock.calls.at(-1)?.[0] as Array<{
    player_id: string;
    achievement_code: string;
    current_value: number;
    completed_at: string | null;
    updated_at: string;
  }>;
}

function findByCode(code: string) {
  return upsertedPayload().find((row) => row.achievement_code === code);
}

function tournament(id: string, startAt: string, createdAt = startAt) {
  return { id, start_at: startAt, created_at: createdAt };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  mockAchievementRepository.findByPlayerId.mockReset();
  mockAchievementRepository.findSummariesByPlayerId.mockReset().mockResolvedValue([]);
  mockAchievementRepository.upsertMany.mockClear();
  mockPlayerRepository.findReferralFieldsById.mockReset().mockResolvedValue(null);
  mockResultRepository.countByPlayerId.mockReset().mockResolvedValue(0);
  mockResultRepository.findWinIdsByPlayerId.mockReset().mockResolvedValue([]);
  mockResultRepository.findRatingPointsByPlayerId.mockReset().mockResolvedValue([]);
  mockResultRepository.findKnockoutsByPlayerId.mockReset().mockResolvedValue([]);
  mockResultRepository.countItmFinishesByPlayerId.mockReset().mockResolvedValue(0);
  mockResultRepository.findBossKnockoutsByPlayerId.mockReset().mockResolvedValue([]);
  mockResultRepository.findArrivedTournamentIdsByPlayerId.mockReset().mockResolvedValue([]);
  mockResultRepository.findArrivedPlacementsByPlayerId.mockReset().mockResolvedValue([]);
  mockTournamentRepository.listCompleted.mockReset().mockResolvedValue([]);
  // Default: no row in app_settings at all -- the real "first deploy,
  // nobody has touched the toggle yet" state. Individual tests override
  // this to simulate an explicit true/false/malformed value.
  mockGetAppSetting.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("syncPlayerAchievements — completed_at preservation", () => {
  it("sets completed_at = now the first time an achievement is completed", async () => {
    mockResultRepository.countByPlayerId.mockResolvedValue(1); // first_tournament, target 1
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([]); // no prior row

    await syncPlayerAchievements(PLAYER_ID);

    const row = findByCode("first_tournament");
    expect(row).toMatchObject({ current_value: 1, completed_at: NOW_ISO });
  });

  it("does NOT overwrite completed_at on a repeat sync of an already-completed achievement", async () => {
    const ORIGINAL_COMPLETED_AT = "2020-01-01T00:00:00.000Z";
    mockResultRepository.countByPlayerId.mockResolvedValue(1); // still exactly 1 tournament
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "first_tournament", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    const row = findByCode("first_tournament");
    expect(row?.completed_at).toBe(ORIGINAL_COMPLETED_AT);
    expect(row?.completed_at).not.toBe(NOW_ISO);
  });

  it("keeps the original completed_at when progress grows past the target but the achievement stays completed", async () => {
    const ORIGINAL_COMPLETED_AT = "2021-05-05T00:00:00.000Z";
    // ten_itm target = 10; player now has 15 ITM finishes (grew since the
    // achievement was first completed at exactly 10).
    mockResultRepository.countItmFinishesByPlayerId.mockResolvedValue(15);
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "ten_itm", current_value: 10, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    const row = findByCode("ten_itm");
    expect(row).toMatchObject({
      current_value: 10, // capped at target, per evaluateCappedMetric
      completed_at: ORIGINAL_COMPLETED_AT,
    });
  });

  it("an already-granted Number One (event-based automatic) is never touched by an ordinary resync", async () => {
    // Number One is type: AUTOMATIC (so it's NOT filtered out by the
    // manual-only exclusion), but has no `metric` -- no evaluator's
    // supports() matches that, so the engine silently skips it. This is
    // the actual permanence mechanism: it's never in progress[], so it's
    // never in the upsertMany payload, so its row is never touched.
    const ORIGINAL_COMPLETED_AT = "2025-03-01T00:00:00.000Z";
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "number_one", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("number_one")).toBeUndefined();
    const codes = upsertedPayload().map((row) => row.achievement_code);
    expect(codes).not.toContain("number_one");
  });

  it("a manual (Legendary) achievement already granted is not part of the automatic resync payload", async () => {
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "royal_flush", current_value: 0, completed_at: "2019-01-01T00:00:00.000Z" },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("royal_flush")).toBeUndefined();
    // upsertMany was still called (for automatic achievements) -- manual
    // rows are simply absent from its payload, not explicitly excluded.
    expect(mockAchievementRepository.upsertMany).toHaveBeenCalled();
    const codes = upsertedPayload().map((row) => row.achievement_code);
    expect(codes).not.toContain("royal_flush");
  });

  it("not-yet-completed achievements keep completed_at null regardless of prior rows", async () => {
    mockResultRepository.countByPlayerId.mockResolvedValue(0);
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([]);

    await syncPlayerAchievements(PLAYER_ID);

    const row = findByCode("first_tournament");
    expect(row).toMatchObject({ current_value: 0, completed_at: null });
  });
});

describe("syncPlayerAchievements — Boss Hunter (boss_knockouts)", () => {
  function withBossKnockouts(total: number) {
    mockResultRepository.findBossKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, boss_knockouts: total },
    ]);
  }

  it("0 boss knockouts -> nothing completed", async () => {
    withBossKnockouts(0);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("five_boss_knockouts")).toMatchObject({ current_value: 0, completed_at: null });
  });

  it("4 -> below Bronze (5)", async () => {
    withBossKnockouts(4);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("five_boss_knockouts")).toMatchObject({ current_value: 4, completed_at: null });
  });

  it("5 -> Bronze completed", async () => {
    withBossKnockouts(5);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("five_boss_knockouts")).toMatchObject({ current_value: 5, completed_at: NOW_ISO });
  });

  it("24/25 -> Silver boundary", async () => {
    withBossKnockouts(24);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("twenty_five_boss_knockouts")?.completed_at).toBeNull();

    withBossKnockouts(25);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("twenty_five_boss_knockouts")).toMatchObject({ current_value: 25, completed_at: NOW_ISO });
  });

  it("49/50 -> Gold boundary", async () => {
    withBossKnockouts(49);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("fifty_boss_knockouts")?.completed_at).toBeNull();

    withBossKnockouts(50);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("fifty_boss_knockouts")).toMatchObject({ current_value: 50, completed_at: NOW_ISO });
  });

  it("99/100 -> Platinum boundary", async () => {
    withBossKnockouts(99);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("hundred_boss_knockouts")?.completed_at).toBeNull();

    withBossKnockouts(100);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("hundred_boss_knockouts")).toMatchObject({ current_value: 100, completed_at: NOW_ISO });
  });

  it("ordinary knockouts do not affect Boss Hunter", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 500 }, // huge ordinary knockout count
    ]);
    withBossKnockouts(0);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("five_boss_knockouts")).toMatchObject({ current_value: 0, completed_at: null });
    // Terminator (ordinary knockouts) is unaffected and correctly completed.
    expect(findByCode("two_hundred_fifty_knockouts")?.completed_at).toBe(NOW_ISO);
  });
});

describe("syncPlayerAchievements — Headhunter (max knockouts in a single tournament)", () => {
  it("5 + 5 knockouts across two different tournaments does NOT complete Headhunter", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 5 },
      { player_id: PLAYER_ID, knockouts: 5 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    const row = findByCode("headhunter");
    expect(row).toMatchObject({ current_value: 5, completed_at: null });
  });

  it("9 knockouts in one tournament does not complete Headhunter", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 9 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("headhunter")).toMatchObject({ current_value: 9, completed_at: null });
  });

  it("10 knockouts in one tournament completes Headhunter", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 3 },
      { player_id: PLAYER_ID, knockouts: 10 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("headhunter")).toMatchObject({ current_value: 10, completed_at: NOW_ISO });
  });

  it("more than 10 in one tournament still completes (capped at target)", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 14 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("headhunter")).toMatchObject({ current_value: 10, completed_at: NOW_ISO });
  });

  it("boss knockouts do not count toward Headhunter", async () => {
    mockResultRepository.findKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, knockouts: 2 },
    ]);
    mockResultRepository.findBossKnockoutsByPlayerId.mockResolvedValue([
      { player_id: PLAYER_ID, boss_knockouts: 50 }, // huge boss knockout count
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("headhunter")).toMatchObject({ current_value: 2, completed_at: null });
  });
});

describe("syncPlayerAchievements — Tournament Streak (max_tournament_streak)", () => {
  it("0 completed tournaments -> streak 0", async () => {
    mockTournamentRepository.listCompleted.mockResolvedValue([]);
    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("tournament_streak_bronze")).toMatchObject({ current_value: 0, completed_at: null });
  });

  it("1/2 tournaments attended out of order, streak stays below target", async () => {
    mockTournamentRepository.listCompleted.mockResolvedValue([
      tournament("t1", "2026-01-01T00:00:00.000Z"),
      tournament("t2", "2026-01-08T00:00:00.000Z"),
    ]);
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue([
      { tournament_id: "t1" },
    ]);

    await syncPlayerAchievements(PLAYER_ID);
    expect(findByCode("tournament_streak_bronze")).toMatchObject({ current_value: 1, completed_at: null });
  });

  it("T1 T2 T3 T4 T5 T6 T7, attendance YES YES YES NO YES YES YES -> max streak 3", async () => {
    const tournaments = Array.from({ length: 7 }, (_, i) =>
      tournament(`t${i + 1}`, `2026-01-0${i + 1}T00:00:00.000Z`)
    );
    mockTournamentRepository.listCompleted.mockResolvedValue(tournaments);
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue(
      ["t1", "t2", "t3", "t5", "t6", "t7"].map((id) => ({ tournament_id: id }))
    );

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("tournament_streak_bronze")).toMatchObject({ current_value: 3, completed_at: NOW_ISO });
    expect(findByCode("tournament_streak_silver")).toMatchObject({ current_value: 3, completed_at: null });
  });

  it("exact target streaks (5/10/20) complete their tier", async () => {
    const tournaments = Array.from({ length: 20 }, (_, i) =>
      tournament(`t${i + 1}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`)
    );
    mockTournamentRepository.listCompleted.mockResolvedValue(tournaments);
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue(
      tournaments.map((t) => ({ tournament_id: t.id }))
    );

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("tournament_streak_silver")).toMatchObject({ current_value: 5, completed_at: NOW_ISO });
    expect(findByCode("tournament_streak_gold")).toMatchObject({ current_value: 10, completed_at: NOW_ISO });
    expect(findByCode("tournament_streak_platinum")).toMatchObject({ current_value: 20, completed_at: NOW_ISO });
  });

  it("an already-earned streak achievement is not lost after a later miss (completed_at preserved)", async () => {
    const ORIGINAL_COMPLETED_AT = "2025-01-01T00:00:00.000Z";
    // Player already has tournament_streak_gold (10) completed historically.
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "tournament_streak_gold", current_value: 10, completed_at: ORIGINAL_COMPLETED_AT },
    ]);
    // Now: 10 tournaments attended, then a miss, then 1 more attended --
    // max streak is still 10 (the historical run), current run is only 1.
    const tournaments = [
      ...Array.from({ length: 10 }, (_, i) => tournament(`t${i + 1}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`)),
      tournament("t11", "2026-01-11T00:00:00.000Z"), // missed
      tournament("t12", "2026-01-12T00:00:00.000Z"), // attended
    ];
    mockTournamentRepository.listCompleted.mockResolvedValue(tournaments);
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue(
      [...tournaments.slice(0, 10), tournaments[11]].map((t) => ({ tournament_id: t.id }))
    );

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("tournament_streak_gold")).toMatchObject({
      current_value: 10,
      completed_at: ORIGINAL_COMPLETED_AT, // NOT reset, NOT bumped to now
    });
  });

  it("a cancelled/non-completed tournament (absent from listCompleted) does not break sequence semantics", async () => {
    // listCompleted() already excludes non-completed tournaments -- this
    // test proves the streak sequence is built purely from what it
    // returns, so a cancelled tournament (never in this list) simply isn't
    // part of the sequence at all, rather than counting as a miss.
    mockTournamentRepository.listCompleted.mockResolvedValue([
      tournament("t1", "2026-01-01T00:00:00.000Z"),
      tournament("t2", "2026-01-02T00:00:00.000Z"),
      tournament("t3", "2026-01-03T00:00:00.000Z"),
    ]);
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue(
      ["t1", "t2", "t3"].map((id) => ({ tournament_id: id }))
    );

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("tournament_streak_bronze")).toMatchObject({ current_value: 3, completed_at: NOW_ISO });
  });

  it("deterministic ordering: same start_at falls back to created_at, then id", async () => {
    // t2 and t3 share start_at; created_at breaks the tie so the real
    // chronological order is t1, t3, t2 (t3 created before t2).
    mockTournamentRepository.listCompleted.mockResolvedValue([
      tournament("t2", "2026-01-02T00:00:00.000Z", "2026-01-02T12:00:00.000Z"),
      tournament("t1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      tournament("t3", "2026-01-02T00:00:00.000Z", "2026-01-02T06:00:00.000Z"),
    ]);
    // Player attended t1 and t3 but NOT t2 -- if ordering were wrong
    // (t2 before t3), this would look like a broken streak instead of a
    // clean run of 2 (t1 -> t3) followed by a miss (t2).
    mockResultRepository.findArrivedTournamentIdsByPlayerId.mockResolvedValue([
      { tournament_id: "t1" },
      { tournament_id: "t3" },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("tournament_streak_bronze")).toMatchObject({ current_value: 2, completed_at: null });
  });
});

describe("syncPlayerAchievements — Marco Reus (bubble)", () => {
  // getExpectedPrizePlaces(20) = min(max(ceil(20*0.3), 3), 20) = 6 --
  // exactly the spec's own example (zone 1-6, bubble = place 7).
  it("place immediately after a 20-player field's rating zone (place 7) counts as a bubble", async () => {
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 7, field_size: 20 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 1, completed_at: NOW_ISO });
  });

  it("a place INSIDE the rating zone (place 6 of 20) is not a bubble", async () => {
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 6, field_size: 20 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 0, completed_at: null });
  });

  it("two places after the rating zone (place 8 of 20) is not a bubble", async () => {
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 8, field_size: 20 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 0, completed_at: null });
  });

  it("reuses getExpectedPrizePlaces for a different field size (5 -> zone 3, bubble = place 4)", async () => {
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 4, field_size: 5 },
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 1, completed_at: NOW_ISO });
  });

  it("only counts actual bubble finishes across multiple tournaments", async () => {
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 7, field_size: 20 }, // bubble
      { tournament_id: "t2", place: 1, field_size: 20 }, // win, not bubble
      { tournament_id: "t3", place: 4, field_size: 5 }, // bubble
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 1, completed_at: NOW_ISO }); // capped at target 1
  });

  it("once earned, stays completed with the original completed_at even without a new bubble finish", async () => {
    const ORIGINAL_COMPLETED_AT = "2025-06-01T00:00:00.000Z";
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "marco_reus", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);
    mockResultRepository.findArrivedPlacementsByPlayerId.mockResolvedValue([
      { tournament_id: "t1", place: 7, field_size: 20 },
      { tournament_id: "t2", place: 1, field_size: 10 }, // new tournament, no new bubble
    ]);

    await syncPlayerAchievements(PLAYER_ID);

    expect(findByCode("marco_reus")).toMatchObject({ current_value: 1, completed_at: ORIGINAL_COMPLETED_AT });
  });
});

describe("isAutomaticAchievementsEnabled", () => {
  it("a missing setting (no row at all) resolves to false -- the safe first-deploy default", async () => {
    mockGetAppSetting.mockResolvedValue(null);
    await expect(isAutomaticAchievementsEnabled()).resolves.toBe(false);
  });

  it("explicit true resolves to true", async () => {
    mockGetAppSetting.mockResolvedValue(true);
    await expect(isAutomaticAchievementsEnabled()).resolves.toBe(true);
  });

  it("explicit false resolves to false", async () => {
    mockGetAppSetting.mockResolvedValue(false);
    await expect(isAutomaticAchievementsEnabled()).resolves.toBe(false);
  });

  it("a malformed/non-boolean stored value resolves to false, not true", async () => {
    mockGetAppSetting.mockResolvedValue("true"); // string, not boolean -- must not coerce
    await expect(isAutomaticAchievementsEnabled()).resolves.toBe(false);
  });

  it("reads the exact key name automatic_achievements_enabled", async () => {
    mockGetAppSetting.mockResolvedValue(true);
    await isAutomaticAchievementsEnabled();
    expect(mockGetAppSetting).toHaveBeenCalledWith("automatic_achievements_enabled");
  });
});

describe("syncPlayersAchievementsIfEnabled — the tournament-completion guard", () => {
  it("OFF: does not touch player_achievements at all", async () => {
    mockGetAppSetting.mockResolvedValue(false);
    // A player who would otherwise clearly complete first_tournament.
    mockResultRepository.countByPlayerId.mockResolvedValue(1);

    await syncPlayersAchievementsIfEnabled([PLAYER_ID]);

    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("OFF (missing setting): same as explicit false -- still no writes", async () => {
    mockGetAppSetting.mockResolvedValue(null);
    mockResultRepository.countByPlayerId.mockResolvedValue(1);

    await syncPlayersAchievementsIfEnabled([PLAYER_ID]);

    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("OFF: does not even read player metrics -- a true no-op, not just a discarded result", async () => {
    mockGetAppSetting.mockResolvedValue(false);

    await syncPlayersAchievementsIfEnabled([PLAYER_ID]);

    expect(mockResultRepository.countByPlayerId).not.toHaveBeenCalled();
    expect(mockResultRepository.findKnockoutsByPlayerId).not.toHaveBeenCalled();
    expect(mockTournamentRepository.listCompleted).not.toHaveBeenCalled();
  });

  it("ON: behaves exactly like the underlying sync -- writes computed automatic achievements", async () => {
    mockGetAppSetting.mockResolvedValue(true);
    mockResultRepository.countByPlayerId.mockResolvedValue(1);

    await syncPlayersAchievementsIfEnabled([PLAYER_ID]);

    expect(mockAchievementRepository.upsertMany).toHaveBeenCalled();
    const row = upsertedPayload().find((r) => r.achievement_code === "first_tournament");
    expect(row).toMatchObject({ current_value: 1, completed_at: NOW_ISO });
  });

  it("ON: multiple players are all synced, matching syncPlayersAchievements", async () => {
    mockGetAppSetting.mockResolvedValue(true);
    mockResultRepository.countByPlayerId.mockResolvedValue(1);

    await syncPlayersAchievementsIfEnabled(["player-a", "player-b"]);

    expect(mockAchievementRepository.upsertMany).toHaveBeenCalledTimes(2);
  });
});

describe("manual achievement moderation", () => {
  it("grants Royal Flush", async () => {
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([]);

    await grantManualAchievement(PLAYER_ID, "royal_flush");

    expect(mockAchievementRepository.upsertMany).toHaveBeenCalledWith([
      {
        player_id: PLAYER_ID,
        achievement_code: "royal_flush",
        current_value: 1,
        completed_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ]);
  });

  it("repeated grant preserves the original completed_at (idempotent)", async () => {
    const ORIGINAL_COMPLETED_AT = "2022-03-03T00:00:00.000Z";
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "royal_flush", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await grantManualAchievement(PLAYER_ID, "royal_flush");

    const payload = mockAchievementRepository.upsertMany.mock.calls.at(-1)?.[0];
    expect(payload[0]).toMatchObject({ current_value: 1, completed_at: ORIGINAL_COMPLETED_AT });
  });

  it("revokes a granted achievement", async () => {
    await revokeManualAchievement(PLAYER_ID, "royal_flush");

    expect(mockAchievementRepository.upsertMany).toHaveBeenCalledWith([
      {
        player_id: PLAYER_ID,
        achievement_code: "royal_flush",
        current_value: 0,
        completed_at: null,
        updated_at: NOW_ISO,
      },
    ]);
  });

  it("rejects granting an automatic achievement through the manual API", async () => {
    await expect(grantManualAchievement(PLAYER_ID, "first_tournament")).rejects.toThrow(
      /automatic/
    );
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("rejects revoking an automatic achievement through the manual API", async () => {
    await expect(revokeManualAchievement(PLAYER_ID, "ten_itm")).rejects.toThrow(/automatic/);
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown achievement code", async () => {
    await expect(grantManualAchievement(PLAYER_ID, "does_not_exist")).rejects.toThrow();
  });

  it("getManualAchievementsForPlayer lists only manual achievements with granted status", async () => {
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "royal_flush", current_value: 1, completed_at: "2020-01-01T00:00:00.000Z" },
      { achievement_code: "first_tournament", current_value: 1, completed_at: "2020-01-01T00:00:00.000Z" },
    ]);

    const list = await getManualAchievementsForPlayer(PLAYER_ID);
    const codes = list.map((a) => a.code);

    // royal_flush is the only manual achievement left in the catalog as of
    // this stage -- number_one/headhunter/marco_reus are all automatic now.
    expect(codes).toEqual(["royal_flush"]);
    expect(codes).not.toContain("first_tournament"); // metric-based automatic, excluded
    expect(codes).not.toContain("headhunter"); // automatic, excluded
    expect(codes).not.toContain("marco_reus"); // automatic, excluded
    expect(codes).not.toContain("number_one"); // event-based automatic, excluded

    const royalFlush = list.find((a) => a.code === "royal_flush");
    expect(royalFlush).toMatchObject({ granted: true, completed_at: "2020-01-01T00:00:00.000Z" });
  });

  it("rejects granting number_one (event-based automatic) through the manual API", async () => {
    await expect(grantManualAchievement(PLAYER_ID, "number_one")).rejects.toThrow(/automatic/);
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });
});

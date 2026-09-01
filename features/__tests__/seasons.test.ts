import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSeasonRepository = {
  listAll: vi.fn(),
  setActive: vi.fn().mockResolvedValue(undefined),
  insert: vi.fn(),
  update: vi.fn(),
  setActivePair: vi.fn().mockResolvedValue(undefined),
};

const mockTournamentRepository = {
  listExcludingStatus: vi.fn().mockResolvedValue([]),
  patch: vi.fn().mockResolvedValue(undefined),
};

const mockAchievementRepository = {
  findSummariesByPlayerId: vi.fn().mockResolvedValue([]),
  upsertMany: vi.fn().mockResolvedValue(undefined),
};

const mockGetOfficialSeasonLeaderboard = vi.fn();

vi.mock("@/lib/repositories", () => ({
  seasonRepository: mockSeasonRepository,
  tournamentRepository: mockTournamentRepository,
  achievementRepository: mockAchievementRepository,
}));

vi.mock("@/features/leaderboard", () => ({
  getOfficialSeasonLeaderboard: mockGetOfficialSeasonLeaderboard,
}));

// Real features/achievements.ts (only its achievementRepository import is
// mocked, via the shared @/lib/repositories mock above) -- exercises the
// actual grantEventAutomaticAchievement, not a stub, for genuine
// end-to-end confidence on the idempotency/completed_at behavior.
const {
  closeSeason,
  rolloverSeason,
  createSeason,
  updateSeason,
  resolveSeasonForTournamentDate,
  resyncUpcomingTournamentSeasonAssignments,
  SeasonEditRejectedError,
} = await import("@/features/seasons");

const SEASON_ID = "season-1";
const NOW_ISO = "2026-08-20T12:00:00.000Z";

function season(
  overrides: Partial<{
    id: string;
    title: string;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
  }> = {}
) {
  return {
    id: SEASON_ID,
    title: "Сезон 1",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function entry(playerId: string, rating: number) {
  return {
    player_id: playerId,
    username: null,
    display_name: playerId,
    telegram_avatar_url: null,
    custom_avatar_url: null,
    rating,
  };
}

function upsertedRows() {
  return mockAchievementRepository.upsertMany.mock.calls.flatMap(([rows]) => rows) as Array<{
    player_id: string;
    achievement_code: string;
    completed_at: string | null;
  }>;
}

function tournament(overrides: Partial<{
  id: string;
  start_at: string;
  season_id: string | null;
  status: string;
}> = {}) {
  return {
    id: "t1",
    start_at: "2026-07-01T18:00:00.000Z",
    season_id: "opening",
    status: "open",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  mockSeasonRepository.listAll.mockReset();
  mockSeasonRepository.setActive.mockReset().mockResolvedValue(undefined);
  mockSeasonRepository.insert.mockReset();
  mockSeasonRepository.update.mockReset();
  mockSeasonRepository.setActivePair.mockReset().mockResolvedValue(undefined);
  mockTournamentRepository.listExcludingStatus.mockReset().mockResolvedValue([]);
  mockTournamentRepository.patch.mockReset().mockResolvedValue(undefined);
  mockAchievementRepository.findSummariesByPlayerId.mockReset().mockResolvedValue([]);
  mockAchievementRepository.upsertMany.mockClear();
  mockGetOfficialSeasonLeaderboard.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("closeSeason", () => {
  it("grants Number One to the sole winner and closes the season", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [entry("winner", 100), entry("runner-up", 80)], outOfCompetition: [] });

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({
      status: "closed",
      seasonId: SEASON_ID,
      winnerPlayerId: "winner",
      winnerRating: 100,
    });

    const rows = upsertedRows();
    expect(rows).toEqual([
      { player_id: "winner", achievement_code: "number_one", current_value: 1, completed_at: NOW_ISO, updated_at: NOW_ISO },
    ]);
    // #2 never gets a number_one row at all.
    expect(rows.some((r) => r.player_id === "runner-up")).toBe(false);

    expect(mockSeasonRepository.setActive).toHaveBeenCalledWith(SEASON_ID, false);
  });

  it("does NOT grant the runner-up (#2) Number One", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [entry("winner", 100), entry("runner-up", 80)], outOfCompetition: [] });

    await closeSeason(SEASON_ID);

    const grantedPlayerIds = upsertedRows().map((r) => r.player_id);
    expect(grantedPlayerIds).toEqual(["winner"]);
  });

  it("a repeat finalization attempt on an already-closed season is rejected, not re-run", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season({ is_active: false })]);

    await expect(closeSeason(SEASON_ID)).rejects.toThrow(/уже закрыт/);
    expect(mockGetOfficialSeasonLeaderboard).not.toHaveBeenCalled();
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).not.toHaveBeenCalled();
  });

  it("rejects finalizing a season that doesn't exist", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([]);
    await expect(closeSeason("does-not-exist")).rejects.toThrow(/не найден/);
  });

  it("retrying a grant preserves the original completed_at (idempotent)", async () => {
    const ORIGINAL_COMPLETED_AT = "2025-01-01T00:00:00.000Z";
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [entry("winner", 100)], outOfCompetition: [] });
    mockAchievementRepository.findSummariesByPlayerId.mockResolvedValue([
      { achievement_code: "number_one", current_value: 1, completed_at: ORIGINAL_COMPLETED_AT },
    ]);

    await closeSeason(SEASON_ID);

    const row = upsertedRows().find((r) => r.achievement_code === "number_one");
    expect(row?.completed_at).toBe(ORIGINAL_COMPLETED_AT);
    expect(row?.completed_at).not.toBe(NOW_ISO);
  });

  it("a tie for #1 is NOT resolved by guessing -- no grant, season stays open", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [
      entry("player-a", 100),
      entry("player-b", 100),
      entry("player-c", 50),
    ], outOfCompetition: [] });

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({
      status: "tie",
      seasonId: SEASON_ID,
      tiedPlayerIds: ["player-a", "player-b"],
      rating: 100,
    });
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).not.toHaveBeenCalled();
  });

  it("a three-way tie for #1 reports all three tied players", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [
      entry("player-a", 50),
      entry("player-b", 50),
      entry("player-c", 50),
    ], outOfCompetition: [] });

    const result = await closeSeason(SEASON_ID);

    expect(result.status).toBe("tie");
    if (result.status === "tie") {
      expect(result.tiedPlayerIds.sort()).toEqual(["player-a", "player-b", "player-c"]);
    }
  });

  it("a tie further down the leaderboard (not at #1) does not block finalization", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [
      entry("winner", 100),
      entry("tied-2nd-a", 50),
      entry("tied-2nd-b", 50),
    ], outOfCompetition: [] });

    const result = await closeSeason(SEASON_ID);

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner" });
  });

  it("no results at all closes the season without granting anything", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [], outOfCompetition: [] });

    const result = await closeSeason(SEASON_ID);

    expect(result).toEqual({ status: "no_results", seasonId: SEASON_ID });
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActive).toHaveBeenCalledWith(SEASON_ID, false);
  });

  it("reads the OFFICIAL (eligibility-aware) leaderboard, not the raw per-player total", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [entry("winner", 100)], outOfCompetition: [] });

    await closeSeason(SEASON_ID);

    expect(mockGetOfficialSeasonLeaderboard).toHaveBeenCalledWith(SEASON_ID);
  });

  it("a raw top scorer marked Вне зачёта is absent from the official leaderboard, so the next eligible player wins Number One", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    // getOfficialSeasonLeaderboard already excludes "owner" (raw #1, 1000
    // points) -- closeSeason only ever sees the eligible list, so it can't
    // pick an excluded player even though they still have the highest
    // rating_points overall.
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [entry("winner", 100), entry("runner-up", 80)],
      outOfCompetition: [entry("owner", 1000)],
    });

    const result = await closeSeason(SEASON_ID);

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner", winnerRating: 100 });
    const grantedPlayerIds = upsertedRows().map((r) => r.player_id);
    expect(grantedPlayerIds).toEqual(["winner"]);
    expect(grantedPlayerIds).not.toContain("owner");
  });

  it("an excluded player tied with an eligible player is ignored in rank-1 tie detection", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([season()]);
    // "owner" would tie with "winner" at 100 points on the RAW leaderboard,
    // but is already partitioned out of `leaderboard` by
    // getOfficialSeasonLeaderboard -- so closeSeason must see a clean win,
    // not a tie.
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [entry("winner", 100), entry("runner-up", 80)],
      outOfCompetition: [entry("owner", 100)],
    });

    const result = await closeSeason(SEASON_ID);

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner" });
  });
});

const OPENING_SEASON = season({ id: "opening", title: "Открытие", start_date: "2026-06-01", end_date: "2026-08-31" });
const AUTUMN_SEASON = season({
  id: "autumn",
  title: "Осень 2026",
  start_date: "2026-09-01",
  end_date: "2026-11-30",
  is_active: false,
});

describe("resolveSeasonForTournamentDate", () => {
  it("resolves a September tournament to the future, still-inactive Autumn season while Opening is still active", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);

    const resolved = await resolveSeasonForTournamentDate("2026-09-01T00:30:00+03:00");

    expect(resolved.id).toBe("autumn");
  });

  it("does NOT fall back to the active season when the date has no match", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON]);

    await expect(resolveSeasonForTournamentDate("2026-12-25T18:00:00.000Z")).rejects.toThrow(
      /не настроен сезон/
    );
  });
});

describe("createSeason / updateSeason", () => {
  it("createSeason inserts a new inactive season and runs resync, reporting reassignments", async () => {
    // Validation (first listAll call) sees only the pre-existing season;
    // the resync that runs AFTER insert (second call) sees the DB as it
    // now actually is, including the just-created Autumn season -- same
    // as real sequential DB reads would.
    mockSeasonRepository.listAll
      .mockResolvedValueOnce([OPENING_SEASON])
      .mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);
    mockSeasonRepository.insert.mockResolvedValue(AUTUMN_SEASON);
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([
      tournament({ id: "sep-tournament", start_at: "2026-09-05T18:00:00.000Z", season_id: "opening" }),
    ]);

    const { season: created, resync } = await createSeason({
      title: "Осень 2026",
      start_date: "2026-09-01",
      end_date: "2026-11-30",
    });

    expect(created.id).toBe("autumn");
    expect(mockSeasonRepository.insert).toHaveBeenCalledWith({
      title: "Осень 2026",
      start_date: "2026-09-01",
      end_date: "2026-11-30",
      is_active: false,
    });
    expect(resync.reassigned).toBe(1);
    expect(mockTournamentRepository.patch).toHaveBeenCalledWith("sep-tournament", { season_id: "autumn" });
  });

  it("rejects a new season that overlaps an existing one", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON]);

    await expect(
      createSeason({ title: "Overlap", start_date: "2026-08-15", end_date: "2026-09-15" })
    ).rejects.toThrow();
    expect(mockSeasonRepository.insert).not.toHaveBeenCalled();
  });

  it("rejects a season edit that would make an existing non-completed tournament unresolvable", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);
    // A tournament dated inside Autumn's current range...
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([
      tournament({ id: "autumn-tournament", start_at: "2026-10-01T18:00:00.000Z", season_id: "autumn" }),
    ]);

    // ...but the proposed edit shrinks Autumn to end before that date, and
    // no other season covers it -- must be rejected, not silently applied.
    await expect(
      updateSeason("autumn", { end_date: "2026-09-15" })
    ).rejects.toThrow(SeasonEditRejectedError);
    expect(mockSeasonRepository.update).not.toHaveBeenCalled();
  });

  it("updateSeason never touches is_active", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON]);
    mockSeasonRepository.update.mockResolvedValue({ ...OPENING_SEASON, title: "Открытие (ред.)" });

    await updateSeason("opening", { title: "Открытие (ред.)" });

    expect(mockSeasonRepository.update).toHaveBeenCalledWith("opening", { title: "Открытие (ред.)" });
  });
});

describe("resyncUpcomingTournamentSeasonAssignments", () => {
  it("moves an existing non-completed September tournament into the newly configured Autumn season", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([
      tournament({ id: "sep-t", start_at: "2026-09-10T18:00:00.000Z", season_id: "opening" }),
    ]);

    const result = await resyncUpcomingTournamentSeasonAssignments();

    expect(result).toMatchObject({ checked: 1, reassigned: 1 });
    expect(result.reassignments).toEqual([
      { tournamentId: "sep-t", fromSeasonId: "opening", toSeasonId: "autumn" },
    ]);
    expect(mockTournamentRepository.patch).toHaveBeenCalledWith("sep-t", { season_id: "autumn" });
  });

  it("a second run is a no-op once already correct", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([
      tournament({ id: "sep-t", start_at: "2026-09-10T18:00:00.000Z", season_id: "autumn" }),
    ]);

    const result = await resyncUpcomingTournamentSeasonAssignments();

    expect(result).toMatchObject({ checked: 1, reassigned: 0 });
    expect(mockTournamentRepository.patch).not.toHaveBeenCalled();
  });

  it("never touches a completed tournament -- listExcludingStatus('completed') already filters it out", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([]);

    const result = await resyncUpcomingTournamentSeasonAssignments();

    expect(mockTournamentRepository.listExcludingStatus).toHaveBeenCalledWith("completed");
    expect(result).toEqual({ checked: 0, reassigned: 0, reassignments: [], unresolved: [] });
    expect(mockTournamentRepository.patch).not.toHaveBeenCalled();
  });

  it("reports (never guesses) a tournament whose date no longer resolves", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON]);
    mockTournamentRepository.listExcludingStatus.mockResolvedValue([
      tournament({ id: "orphan", start_at: "2026-12-25T18:00:00.000Z", season_id: "opening" }),
    ]);

    const result = await resyncUpcomingTournamentSeasonAssignments();

    expect(result.unresolved).toEqual([{ tournamentId: "orphan", reason: expect.stringContaining("не настроен сезон") }]);
    expect(mockTournamentRepository.patch).not.toHaveBeenCalled();
  });
});

describe("rolloverSeason", () => {
  function activeCurrent() {
    return season({ id: SEASON_ID, title: "Открытие", is_active: true });
  }
  function inactiveNext() {
    return season({ id: "next-season", title: "Осень 2026", start_date: "2026-09-01", is_active: false });
  }

  it("unique winner: grants Number One, deactivates current, activates next -- all via one transactional setActivePair call", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([activeCurrent(), inactiveNext()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [entry("winner", 100), entry("runner-up", 80)],
      outOfCompetition: [],
    });

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toEqual({
      status: "closed",
      seasonId: SEASON_ID,
      nextSeasonId: "next-season",
      winnerPlayerId: "winner",
      winnerRating: 100,
    });
    expect(upsertedRows().map((r) => r.player_id)).toEqual(["winner"]);
    expect(mockSeasonRepository.setActivePair).toHaveBeenCalledWith(SEASON_ID, "next-season");
    expect(mockSeasonRepository.setActivePair).toHaveBeenCalledTimes(1);
  });

  it("an OOC (Вне зачёта) player cannot become Number One via rollover", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([activeCurrent(), inactiveNext()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [entry("winner", 100)],
      outOfCompetition: [entry("owner", 1000)],
    });

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner" });
    expect(upsertedRows().some((r) => r.player_id === "owner")).toBe(false);
  });

  it("no-results rollover still activates next season, grants nothing", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([activeCurrent(), inactiveNext()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [], outOfCompetition: [] });

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toEqual({ status: "no_results", seasonId: SEASON_ID, nextSeasonId: "next-season" });
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActivePair).toHaveBeenCalledWith(SEASON_ID, "next-season");
  });

  it("a first-place tie blocks rollover completely -- current stays as-is, next never activated", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([activeCurrent(), inactiveNext()]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({
      leaderboard: [entry("player-a", 100), entry("player-b", 100)],
      outOfCompetition: [],
    });

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toEqual({
      status: "tie",
      seasonId: SEASON_ID,
      tiedPlayerIds: ["player-a", "player-b"],
      rating: 100,
    });
    expect(mockSeasonRepository.setActivePair).not.toHaveBeenCalled();
    expect(mockAchievementRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("retry after current was already deactivated (partial prior failure) resumes without re-deactivating or duplicating the grant", async () => {
    // Current already inactive (a prior attempt got this far), next still inactive.
    mockSeasonRepository.listAll.mockResolvedValue([
      season({ id: SEASON_ID, title: "Открытие", is_active: false }),
      inactiveNext(),
    ]);
    mockGetOfficialSeasonLeaderboard.mockResolvedValue({ leaderboard: [entry("winner", 100)], outOfCompetition: [] });

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toMatchObject({ status: "closed", winnerPlayerId: "winner" });
    // deactivateId is null -- current was already inactive, only next gets activated.
    expect(mockSeasonRepository.setActivePair).toHaveBeenCalledWith(null, "next-season");
  });

  it("retry after full success is an idempotent no-op (next already active)", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([
      season({ id: SEASON_ID, title: "Открытие", is_active: false }),
      season({ id: "next-season", title: "Осень 2026", is_active: true }),
    ]);

    const result = await rolloverSeason(SEASON_ID, "next-season");

    expect(result).toEqual({ status: "already_active", seasonId: SEASON_ID, nextSeasonId: "next-season" });
    expect(mockGetOfficialSeasonLeaderboard).not.toHaveBeenCalled();
    expect(mockSeasonRepository.setActivePair).not.toHaveBeenCalled();
  });

  it("never ends with two active seasons -- rejects a next season that is not chronologically after current", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([
      activeCurrent(),
      season({ id: "earlier", title: "Earlier", start_date: "2020-01-01", is_active: false }),
    ]);

    await expect(rolloverSeason(SEASON_ID, "earlier")).rejects.toThrow();
    expect(mockSeasonRepository.setActivePair).not.toHaveBeenCalled();
  });
});

describe("listSeasonsPublic -- privacy", () => {
  it("never includes start_date/end_date, only id/title/isActive", async () => {
    mockSeasonRepository.listAll.mockResolvedValue([OPENING_SEASON, AUTUMN_SEASON]);

    const { listSeasonsPublic } = await import("@/features/seasons");
    const publicSeasons = await listSeasonsPublic();

    expect(publicSeasons).toEqual([
      { id: "opening", title: "Открытие", isActive: true },
      { id: "autumn", title: "Осень 2026", isActive: false },
    ]);
    for (const season of publicSeasons) {
      expect(season).not.toHaveProperty("start_date");
      expect(season).not.toHaveProperty("end_date");
    }
  });
});

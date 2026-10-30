import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findPlayer: vi.fn(), history: vi.fn(), knockouts: vi.fn(), dealer: vi.fn(), teamState: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: m.findPlayer },
  resultRepository: { sumHistoryKnockoutsByPlayerId: m.knockouts },
}));
vi.mock("@/features/dealers", () => ({ getPersonalDealerSummary: m.dealer }));
vi.mock("@/features/achievements", () => ({ getPlayerAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/featured-achievements", () => ({ getFeaturedAchievementKeys: vi.fn().mockResolvedValue([]) }));
vi.mock("@/features/leaderboard", () => ({ getPlayerRatingSummary: vi.fn().mockResolvedValue({ currentSeason: { points: 265, rank: 45 }, allTime: { points: 806, rank: 12 } }) }));
vi.mock("@/features/teams", () => ({ getMyTeamState: m.teamState, getPlayerActiveTeamSummary: vi.fn().mockResolvedValue(null) }));
vi.mock("@/features/tournaments", () => ({
  getPlayerTournamentHistory: m.history,
  getPlayedTournamentsCount: vi.fn().mockResolvedValue(65),
  getMyTournaments: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));
const { getProfileV2, getProfileResults } = await import("@/features/profile-v2");
const rows = Array.from({ length: 65 }, (_, i) => ({ tournament: { id: `t-${i}` }, result: { rating_points: 65 - i, knockouts: 1 } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.findPlayer.mockImplementation(async (id: string) => ({ id, display_name: "Player", username: "player", free_reentries_balance: 2, email: "private@test.local", role: "admin", is_blocked: false, created_at: "2025-01-01" }));
  m.history.mockImplementation(async (_id: string, page: { offset: number; limit: number }) => rows.slice(page.offset, page.offset + page.limit));
  m.knockouts.mockResolvedValue(99);
  m.dealer.mockResolvedValue(null);
  m.teamState.mockResolvedValue({ pending_invitations: [], pending_outgoing_join_requests: [] });
});

describe("Profile V2 read-model privacy and bounds", () => {
  it("returns actual legacy credits to the owner and keeps all-time KPIs independent of six recent results", async () => {
    const response = await getProfileV2({ targetPlayerId: "owner", viewerId: "owner" });
    expect(response.mode).toBe("own");
    expect(response.profile).toHaveProperty("free_reentries_balance", 2);
    expect(response.profile.knockouts).toBe(99);
    expect(response.profile.tournaments_played).toBe(65);
    expect(response.profile.recent_form).toHaveLength(6);
    expect(response.profile).not.toHaveProperty("tournament_history");
    expect(m.history).toHaveBeenCalledWith("owner", { offset: 0, limit: 6 });
  });

  it.each([null, "someone-else"])("never serializes private fields for public viewer %s", async (viewerId) => {
    const { profile } = await getProfileV2({ targetPlayerId: "owner", viewerId });
    for (const field of ["email", "free_reentries_balance", "dealer", "team_state", "role", "is_blocked", "nickname_status", "upcoming_tournaments"]) {
      expect(JSON.parse(JSON.stringify(profile))).not.toHaveProperty(field);
    }
    expect(m.dealer).not.toHaveBeenCalled();
    expect(m.teamState).not.toHaveBeenCalled();
  });

  it("resolves a merged target before authorizing the private balance", async () => {
    m.findPlayer.mockImplementation(async (id: string) => id === "old" ? { id, merged_into_player_id: "canonical", free_reentries_balance: 100 } : { id, display_name: "Canonical", free_reentries_balance: 3 });
    const own = await getProfileV2({ targetPlayerId: "old", viewerId: "canonical" });
    expect(own.profile).toHaveProperty("free_reentries_balance", 3);
    const publicResult = await getProfileV2({ targetPlayerId: "old", viewerId: "old" });
    expect(publicResult.mode).toBe("public");
    expect(publicResult.profile).not.toHaveProperty("free_reentries_balance");
  });

  it("paginates 65 frozen results without duplication, exposing only public identity", async () => {
    const pages = await Promise.all([0, 20, 40, 60].map(offset => getProfileResults("owner", offset)));
    expect(pages.map(page => page.items.length)).toEqual([20, 20, 20, 5]);
    expect(pages.map(page => page.next_offset)).toEqual([20, 40, 60, null]);
    expect(new Set(pages.flatMap(page => page.items.map(item => item.tournament.id))).size).toBe(65);
    expect(pages[3].items[4].result.rating_points).toBe(1);
    expect(pages[0].player).toEqual({ id: "owner", display_name: "Player" });
    expect(m.history).toHaveBeenCalledWith("owner", { limit: 21, offset: 60 });
  });

  it.each([-1, 1.5, NaN, 100001])("rejects invalid offset %s before querying", async (offset) => {
    await expect(getProfileResults("owner", offset)).rejects.toThrow("Некорректная страница");
    expect(m.history).not.toHaveBeenCalled();
  });
});

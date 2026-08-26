import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = { findById: vi.fn() };
const mockRegistrationRepository = { findLatestByPlayerAndTournament: vi.fn() };

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  registrationRepository: mockRegistrationRepository,
  seasonRepository: {},
  tournamentRepository: {},
  tournamentLiveStateRepository: {},
  resultRepository: {},
}));

vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: vi.fn(),
}));
vi.mock("@/features/club-activity", () => ({
  publishTournamentWinnerEvent: vi.fn(),
}));
vi.mock("@/features/rating-v2", () => ({
  calculateRatingPointsForTournament: vi.fn(),
}));

const { registerPlayerForTournament } = await import("@/features/tournaments");

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: "player-1",
    role: "player" as const,
    is_blocked: false,
    display_name: "Player One",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findById.mockReset();
  mockRegistrationRepository.findLatestByPlayerAndTournament.mockReset();
});

describe("registerPlayerForTournament — server-side block enforcement", () => {
  it("rejects a blocked player before touching any registration data, even via a direct call with a stale session", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));

    await expect(
      registerPlayerForTournament("player-1", "tournament-1")
    ).rejects.toThrow("Аккаунт заблокирован администратором");

    expect(mockRegistrationRepository.findLatestByPlayerAndTournament).not.toHaveBeenCalled();
  });

  it("lets an active player proceed past the block check", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockRegistrationRepository.findLatestByPlayerAndTournament.mockResolvedValue([
      { id: "reg-1", player_id: "player-1", tournament_id: "tournament-1", status: "registered", created_at: "2024-01-01T00:00:00Z" },
    ]);

    const result = await registerPlayerForTournament("player-1", "tournament-1");

    expect(result.status).toBe("registered");
    expect(mockRegistrationRepository.findLatestByPlayerAndTournament).toHaveBeenCalledWith(
      "player-1",
      "tournament-1"
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = { findById: vi.fn(), update: vi.fn() };
const mockRegistrationRepository = {
  findActiveOrWaitlistByPlayerAndTournamentOrThrow: vi.fn(),
  findOldestWaitlisted: vi.fn(),
  updateStatusSilent: vi.fn(),
};

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

const { cancelPlayerRegistration } = await import("@/features/tournaments");
const { acceptTerms, completeProfile, submitNicknameForModeration } = await import(
  "@/features/auth"
);

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: "player-1",
    telegram_id: null,
    username: null,
    role: "player" as const,
    is_blocked: false,
    display_name: "Player One",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findById.mockReset();
  mockPlayerRepository.update.mockReset();
  mockRegistrationRepository.findActiveOrWaitlistByPlayerAndTournamentOrThrow.mockReset();
  mockRegistrationRepository.findOldestWaitlisted.mockReset();
  mockRegistrationRepository.updateStatusSilent.mockReset();
});

describe("player write-path audit — server-side block enforcement", () => {
  it("cancelPlayerRegistration rejects a blocked player before touching the registration", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));

    await expect(
      cancelPlayerRegistration("player-1", "tournament-1")
    ).rejects.toThrow("Аккаунт заблокирован администратором");
    expect(
      mockRegistrationRepository.findActiveOrWaitlistByPlayerAndTournamentOrThrow
    ).not.toHaveBeenCalled();
  });

  it("acceptTerms rejects a blocked player before writing anything", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));

    await expect(acceptTerms("player-1")).rejects.toThrow(
      "Аккаунт заблокирован администратором"
    );
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("completeProfile rejects a blocked player even though the caller supplies its own Player object", async () => {
    // The passed-in `player` claims is_blocked: false -- assertPlayerActive
    // must re-fetch by id from the DB instead of trusting the argument.
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));
    const staleClientPlayer = player({ is_blocked: false });

    await expect(completeProfile(staleClientPlayer, "NewNick")).rejects.toThrow(
      "Аккаунт заблокирован администратором"
    );
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("submitNicknameForModeration rejects a blocked player the same way", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));
    const staleClientPlayer = player({ is_blocked: false });

    await expect(
      submitNicknameForModeration(staleClientPlayer, "NewNick")
    ).rejects.toThrow("Аккаунт заблокирован администратором");
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("lets an active player through acceptTerms", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockPlayerRepository.update.mockResolvedValue(player({ accepted_terms_at: "2024-01-01" }));

    await expect(acceptTerms("player-1")).resolves.toMatchObject({ id: "player-1" });
  });
});

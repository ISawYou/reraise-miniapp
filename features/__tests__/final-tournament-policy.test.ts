import { beforeEach, describe, expect, it, vi } from "vitest";

// "Финал месяца" (tournament.is_final) registration policy -- verifies the
// server-side fail-closed enforcement in registerPlayerForTournament /
// cancelPlayerRegistration, that normal (is_final=false) tournaments are
// completely unaffected, and that the separate admin manual-participant
// code path (addAdminTournamentParticipant et al.) never goes through this
// check at all. Mirrors the mock shape of
// tournament-admin-actions-auth.test.ts -- same module, same dependency set.
const mocks = vi.hoisted(() => ({
  assertServerActorRole: vi.fn(),
  assertPlayerActive: vi.fn(),
  tournamentFindById: vi.fn(),
  tournamentCreate: vi.fn(),
  registrationCreate: vi.fn(),
  registrationCreateSilent: vi.fn(),
  registrationFindLatest: vi.fn(),
  registrationFindActiveOrWaitlistOrThrow: vi.fn(),
  registrationFindRegisteredTournamentIds: vi.fn(),
  registrationUpdateStatusSilent: vi.fn(),
  registrationFindOldestWaitlisted: vi.fn(),
  playerCreate: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
}));

vi.mock("@/features/auth-server", () => ({
  assertPlayerActive: mocks.assertPlayerActive,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    create: mocks.playerCreate,
  },
  seasonRepository: {},
  tournamentRepository: {
    findById: mocks.tournamentFindById,
    create: mocks.tournamentCreate,
  },
  registrationRepository: {
    create: mocks.registrationCreate,
    createSilent: mocks.registrationCreateSilent,
    findLatestByPlayerAndTournament: mocks.registrationFindLatest,
    findActiveOrWaitlistByPlayerAndTournamentOrThrow: mocks.registrationFindActiveOrWaitlistOrThrow,
    findRegisteredTournamentIds: mocks.registrationFindRegisteredTournamentIds,
    updateStatusSilent: mocks.registrationUpdateStatusSilent,
    findOldestWaitlisted: mocks.registrationFindOldestWaitlisted,
  },
  tournamentLiveStateRepository: {},
  resultRepository: {},
}));

vi.mock("@/features/achievements", () => ({
  syncPlayersAchievementsIfEnabled: vi.fn(),
}));
vi.mock("@/features/club-activity", () => ({
  publishTournamentWinnerEvent: vi.fn(),
}));
vi.mock("@/features/seasons", () => ({
  resolveSeasonForTournamentDate: vi.fn().mockResolvedValue({ id: "season-1" }),
}));

const {
  registerPlayerForTournament,
  cancelPlayerRegistration,
  createTournament,
  addAdminTournamentParticipant,
  addExistingPlayerToTournament,
} = await import("@/features/tournaments");

function tournament(overrides: Partial<{ is_final: boolean; max_players: number; status: string }> = {}) {
  return {
    id: "t1",
    title: "T",
    max_players: 20,
    status: "open",
    is_final: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActorRole.mockResolvedValue({ id: "staff-1", role: "operator" });
  mocks.assertPlayerActive.mockResolvedValue({ id: "player-1", is_blocked: false });
  mocks.registrationFindLatest.mockResolvedValue([]);
  mocks.registrationFindRegisteredTournamentIds.mockResolvedValue([]);
  mocks.registrationCreate.mockResolvedValue({ id: "reg-1", status: "registered" });
  mocks.registrationCreateSilent.mockResolvedValue(undefined);
  mocks.registrationFindOldestWaitlisted.mockResolvedValue([]);
  mocks.registrationUpdateStatusSilent.mockResolvedValue(undefined);
  mocks.registrationFindActiveOrWaitlistOrThrow.mockResolvedValue({
    id: "reg-1",
    status: "registered",
  });
  mocks.playerCreate.mockResolvedValue({ id: "p-new" });
  mocks.tournamentCreate.mockResolvedValue(tournament());
});

describe("registerPlayerForTournament -- fail closed on is_final", () => {
  it("rejects self-registration for a final tournament, before creating any registration", async () => {
    mocks.tournamentFindById.mockResolvedValue(tournament({ is_final: true }));

    await expect(registerPlayerForTournament("player-1", "t1")).rejects.toThrow(
      "Регистрация на финальный турнир доступна только по приглашению.",
    );
    expect(mocks.registrationCreate).not.toHaveBeenCalled();
  });

  it("still allows normal self-registration for an is_final=false tournament", async () => {
    mocks.tournamentFindById.mockResolvedValue(tournament({ is_final: false }));

    const result = await registerPlayerForTournament("player-1", "t1");

    expect(result).toEqual({ id: "reg-1", status: "registered" });
    expect(mocks.registrationCreate).toHaveBeenCalledWith({
      player_id: "player-1",
      tournament_id: "t1",
      status: "registered",
    });
  });
});

describe("cancelPlayerRegistration -- fail closed on is_final", () => {
  it("rejects self-cancellation for a final tournament, before touching the registration", async () => {
    mocks.tournamentFindById.mockResolvedValue(tournament({ is_final: true }));

    await expect(cancelPlayerRegistration("player-1", "t1")).rejects.toThrow(
      "Состав финального турнира изменяет администратор.",
    );
    expect(mocks.registrationUpdateStatusSilent).not.toHaveBeenCalled();
  });

  it("still allows normal self-cancellation for an is_final=false tournament", async () => {
    mocks.tournamentFindById.mockResolvedValue(tournament({ is_final: false }));

    await cancelPlayerRegistration("player-1", "t1");

    expect(mocks.registrationUpdateStatusSilent).toHaveBeenCalledWith("reg-1", "cancelled");
  });
});

describe("createTournament -- persists is_final", () => {
  it("Final Month creation persists tournament_type=classic and is_final=true", async () => {
    await createTournament({
      title: "ФИНАЛ МЕСЯЦА",
      description: "d",
      location: "l",
      start_at: "2026-01-01T00:00:00.000Z",
      max_players: 20,
      tournament_type: "classic",
      is_final: true,
    });

    expect(mocks.tournamentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tournament_type: "classic", is_final: true }),
    );
  });

  it("normal creation persists is_final=false", async () => {
    await createTournament({
      title: "CLASSIC",
      description: "d",
      location: "l",
      start_at: "2026-01-01T00:00:00.000Z",
      max_players: 20,
      tournament_type: "classic",
    });

    expect(mocks.tournamentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tournament_type: "classic", is_final: false }),
    );
  });
});

describe("admin manual participant flow -- untouched by the final registration policy", () => {
  it("addAdminTournamentParticipant succeeds without ever consulting tournamentRepository.findById", async () => {
    await addAdminTournamentParticipant("t1", "Walk-in");

    expect(mocks.playerCreate).toHaveBeenCalled();
    expect(mocks.tournamentFindById).not.toHaveBeenCalled();
  });

  it("addExistingPlayerToTournament succeeds for a final tournament -- it reads the tournament for capacity only, and never checks is_final", async () => {
    mocks.tournamentFindById.mockResolvedValue(tournament({ is_final: true }));

    await addExistingPlayerToTournament("t1", "p2");

    expect(mocks.registrationCreateSilent).toHaveBeenCalledWith({
      player_id: "p2",
      tournament_id: "t1",
      status: "registered",
    });
  });
});

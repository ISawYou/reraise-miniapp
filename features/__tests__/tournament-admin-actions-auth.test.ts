import { beforeEach, describe, expect, it, vi } from "vitest";

// These five Server Actions are invoked directly from admin client
// components (app/admin/tournaments/page.tsx, .../[id]/edit/page.tsx),
// bypassing middleware.ts's /api/admin/:path* matcher entirely (a Server
// Action hits its own Next.js RPC endpoint, not that URL). This file only
// verifies the authorization boundary each one now has (see
// lib/admin-auth.ts's assertServerActorRole) -- not their pre-existing
// business logic, which is unchanged and covered elsewhere.
const mocks = vi.hoisted(() => ({
  assertServerActorRole: vi.fn(),
  tournamentUpdate: vi.fn(),
  tournamentDelete: vi.fn(),
  tournamentFindById: vi.fn(),
  playerCreate: vi.fn(),
  registrationCreateSilent: vi.fn(),
  registrationFindLatest: vi.fn(),
  registrationFindRegisteredTournamentIds: vi.fn(),
  registrationUpdateStatusSilent: vi.fn(),
  registrationFindStatusAndTournamentById: vi.fn(),
  registrationDelete: vi.fn(),
  registrationFindOldestWaitlisted: vi.fn(),
}));

// Wholesale mock -- NOT vi.importActual + spread. assertServerActorRole's
// call to resolveCurrentServerActor is an internal module binding, not a
// call through the exported object, so overriding just one export while
// keeping the real assertServerActorRole would still hit the real
// resolveCurrentServerActor (and therefore next/headers, which throws
// outside an actual request). This file only needs to verify each
// tournament function's authorization BOUNDARY -- that it calls
// assertServerActorRole with the right allowed-roles list and correctly
// propagates rejection/resolution -- not admin-auth's own internals,
// which are covered by middleware.test.ts's real integration.
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    create: mocks.playerCreate,
  },
  seasonRepository: {},
  tournamentRepository: {
    update: mocks.tournamentUpdate,
    delete: mocks.tournamentDelete,
    findById: mocks.tournamentFindById,
  },
  registrationRepository: {
    createSilent: mocks.registrationCreateSilent,
    findLatestByPlayerAndTournament: mocks.registrationFindLatest,
    findRegisteredTournamentIds: mocks.registrationFindRegisteredTournamentIds,
    updateStatusSilent: mocks.registrationUpdateStatusSilent,
    findStatusAndTournamentById: mocks.registrationFindStatusAndTournamentById,
    delete: mocks.registrationDelete,
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
// Season resolution is covered in detail by
// features/__tests__/tournament-season-assignment.test.ts -- this file only
// verifies the authorization boundary, so the resolver is stubbed to a
// fixed season rather than exercising real date/season-range logic.
vi.mock("@/features/seasons", () => ({
  resolveSeasonForTournamentDate: vi.fn().mockResolvedValue({ id: "season-1" }),
}));

const {
  updateTournament,
  deleteTournament,
  addAdminTournamentParticipant,
  addExistingPlayerToTournament,
  removeAdminTournamentParticipant,
} = await import("@/features/tournaments");

function actor(role: "player" | "operator" | "admin") {
  return { id: "actor-1", role };
}

function tournamentInput() {
  return {
    title: "T",
    description: "",
    location: "",
    start_at: "2026-01-01T00:00:00.000Z",
    max_players: 20,
    tournament_type: "classic" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tournamentUpdate.mockResolvedValue({ id: "t1" });
  mocks.tournamentDelete.mockResolvedValue(undefined);
  mocks.tournamentFindById.mockResolvedValue({ id: "t1", max_players: 20, status: "open" });
  mocks.playerCreate.mockResolvedValue({ id: "p-new" });
  mocks.registrationCreateSilent.mockResolvedValue(undefined);
  mocks.registrationFindLatest.mockResolvedValue([]);
  mocks.registrationFindRegisteredTournamentIds.mockResolvedValue([]);
  mocks.registrationUpdateStatusSilent.mockResolvedValue(undefined);
  mocks.registrationFindStatusAndTournamentById.mockResolvedValue({ status: "registered", tournament_id: "t1" });
  mocks.registrationDelete.mockResolvedValue(undefined);
  mocks.registrationFindOldestWaitlisted.mockResolvedValue([]);
});

function allow(role: "operator" | "admin") {
  mocks.assertServerActorRole.mockResolvedValue(actor(role));
}

function deny() {
  mocks.assertServerActorRole.mockRejectedValue(new Error("Forbidden"));
}

describe("updateTournament -- staff (operator or admin) allowed", () => {
  it("requests exactly ['admin','operator'] from the authorization guard", async () => {
    allow("admin");
    await updateTournament("t1", tournamentInput());
    expect(mocks.assertServerActorRole).toHaveBeenCalledWith(["admin", "operator"]);
  });

  it("rejects when the guard rejects (unauthenticated or plain player)", async () => {
    deny();
    await expect(updateTournament("t1", tournamentInput())).rejects.toThrow();
    expect(mocks.tournamentUpdate).not.toHaveBeenCalled();
  });

  it("allows an operator", async () => {
    allow("operator");
    await updateTournament("t1", tournamentInput());
    expect(mocks.tournamentUpdate).toHaveBeenCalled();
  });

  it("allows a Super Admin", async () => {
    allow("admin");
    await updateTournament("t1", tournamentInput());
    expect(mocks.tournamentUpdate).toHaveBeenCalled();
  });
});

describe("deleteTournament -- Super-Admin-only", () => {
  it("requests exactly ['admin'] from the authorization guard -- operator is never in the allowed list", async () => {
    allow("admin");
    await deleteTournament("t1");
    expect(mocks.assertServerActorRole).toHaveBeenCalledWith(["admin"]);
  });

  it("rejects when the guard rejects (plain player, or operator -- operator must NOT be able to delete a tournament)", async () => {
    deny();
    await expect(deleteTournament("t1")).rejects.toThrow();
    expect(mocks.tournamentDelete).not.toHaveBeenCalled();
  });

  it("allows a Super Admin", async () => {
    allow("admin");
    await deleteTournament("t1");
    expect(mocks.tournamentDelete).toHaveBeenCalledWith("t1");
  });
});

describe("addAdminTournamentParticipant / addExistingPlayerToTournament / removeAdminTournamentParticipant -- staff allowed, player denied", () => {
  it("addAdminTournamentParticipant rejects when the guard rejects", async () => {
    deny();
    await expect(addAdminTournamentParticipant("t1", "Walk-in")).rejects.toThrow();
    expect(mocks.playerCreate).not.toHaveBeenCalled();
  });

  it("addAdminTournamentParticipant allows an operator", async () => {
    allow("operator");
    await addAdminTournamentParticipant("t1", "Walk-in");
    expect(mocks.playerCreate).toHaveBeenCalled();
  });

  it("addExistingPlayerToTournament rejects when the guard rejects", async () => {
    deny();
    await expect(addExistingPlayerToTournament("t1", "p2")).rejects.toThrow();
    expect(mocks.registrationFindLatest).not.toHaveBeenCalled();
  });

  it("addExistingPlayerToTournament allows an operator", async () => {
    allow("operator");
    await addExistingPlayerToTournament("t1", "p2");
    expect(mocks.registrationCreateSilent).toHaveBeenCalled();
  });

  it("removeAdminTournamentParticipant rejects when the guard rejects", async () => {
    deny();
    await expect(removeAdminTournamentParticipant("reg-1")).rejects.toThrow();
    expect(mocks.registrationDelete).not.toHaveBeenCalled();
  });

  it("removeAdminTournamentParticipant allows an operator", async () => {
    allow("operator");
    await removeAdminTournamentParticipant("reg-1");
    expect(mocks.registrationDelete).toHaveBeenCalledWith("reg-1");
  });
});

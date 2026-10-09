import { beforeEach, describe, expect, it, vi } from "vitest";

// removeAdminTournamentParticipant: deletes the registration, then -- only
// if the removed row held a seat (registered/attended) -- hands the freed
// seat to the waitlist via the ONE canonical reconciler
// (features/tournament-waitlist-capacity.ts, covered against a stateful
// fake db in tournament-waitlist-capacity.test.ts / waitlist.test.ts).
//
// (Previously this file drove the legacy Supabase query-builder chain and
// failed at import time with "NEXT_PUBLIC_SUPABASE_URL is not set".)
const mocks = vi.hoisted(() => ({
  assertServerActorRole: vi.fn(),
  findStatusAndTournamentById: vi.fn(),
  registrationDelete: vi.fn(),
  findOldestWaitlisted: vi.fn(),
  updateStatusSilent: vi.fn(),
  reconcileTournamentWaitlistCapacity: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: mocks.assertServerActorRole }));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  seasonRepository: {},
  tournamentRepository: {},
  registrationRepository: {
    findStatusAndTournamentById: mocks.findStatusAndTournamentById,
    delete: mocks.registrationDelete,
    findOldestWaitlisted: mocks.findOldestWaitlisted,
    updateStatusSilent: mocks.updateStatusSilent,
  },
  tournamentLiveStateRepository: {},
  resultRepository: {},
}));

vi.mock("@/features/tournament-waitlist-capacity", () => ({
  admitPlayerToTournament: vi.fn(),
  reconcileTournamentWaitlistCapacity: mocks.reconcileTournamentWaitlistCapacity,
  unEliminateTournamentPlayerWithinCapacity: vi.fn(),
}));

vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const { removeAdminTournamentParticipant } = await import("@/features/tournaments");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActorRole.mockResolvedValue({ id: "staff-1", role: "operator" });
  mocks.registrationDelete.mockResolvedValue(undefined);
  mocks.reconcileTournamentWaitlistCapacity.mockResolvedValue({
    promotedRegistrationIds: ["waitlist-1"],
    promotedPlayerIds: ["player-2"],
  });
});

describe("removeAdminTournamentParticipant", () => {
  it.each(["registered", "attended"])(
    "removing a %s participant deletes the row, then reconciles the waitlist for that tournament",
    async (status) => {
      mocks.findStatusAndTournamentById.mockResolvedValue({ status, tournament_id: "tournament-1" });

      await removeAdminTournamentParticipant("reg-1");

      expect(mocks.registrationDelete).toHaveBeenCalledWith("reg-1");
      expect(mocks.reconcileTournamentWaitlistCapacity).toHaveBeenCalledWith("tournament-1");
      expect(mocks.registrationDelete.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.reconcileTournamentWaitlistCapacity.mock.invocationCallOrder[0]
      );
      // No ad hoc single promotion any more.
      expect(mocks.findOldestWaitlisted).not.toHaveBeenCalled();
      expect(mocks.updateStatusSilent).not.toHaveBeenCalled();
    }
  );

  it("removing a waitlisted participant frees no seat -- no reconciliation", async () => {
    mocks.findStatusAndTournamentById.mockResolvedValue({ status: "waitlist", tournament_id: "tournament-1" });

    await removeAdminTournamentParticipant("reg-waitlist-1");

    expect(mocks.registrationDelete).toHaveBeenCalledWith("reg-waitlist-1");
    expect(mocks.reconcileTournamentWaitlistCapacity).not.toHaveBeenCalled();
  });

  it("does not throw when nothing is promoted (empty waitlist)", async () => {
    mocks.findStatusAndTournamentById.mockResolvedValue({ status: "registered", tournament_id: "tournament-1" });
    mocks.reconcileTournamentWaitlistCapacity.mockResolvedValue({
      promotedRegistrationIds: [],
      promotedPlayerIds: [],
    });

    await expect(removeAdminTournamentParticipant("reg-1")).resolves.toBeUndefined();
  });
});

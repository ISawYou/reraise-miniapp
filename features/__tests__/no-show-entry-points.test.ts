import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  fake,
  isRestricted,
  registrationOf,
  resetFakeCapacityDb,
  restrict,
  seatedCount,
  seedRegistrations,
  statusOf,
} from "./helpers/fake-capacity-db";

// The no-show policy through the features/tournaments.ts entry points and
// the features/tournament-roster-actions.ts Server Actions -- same
// end-to-end technique as waitlist.test.ts: the REAL tournaments module and
// the REAL capacity module over the stateful fake `db`, with the
// repository-layer calls mocked to read/write that same in-memory state.
const mocks = vi.hoisted(() => ({
  assertPlayerActive: vi.fn(),
  assertServerActorRole: vi.fn(),
  resolveCurrentServerActor: vi.fn(),
  syncAdmittedPlayerToSheet: vi.fn(),
  syncOperationalRosterToSheet: vi.fn(),
  tournament: { id: "t1", max_players: 40, is_final: false, status: "open", kind: "free" },
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));
vi.mock("@/features/auth-server", () => ({ assertPlayerActive: mocks.assertPlayerActive }));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
  resolveCurrentServerActor: mocks.resolveCurrentServerActor,
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/features/seasons", () => ({ resolveSeasonForTournamentDate: vi.fn() }));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/features/tournament-sheet-sync", () => ({
  syncAdmittedPlayerToSheet: mocks.syncAdmittedPlayerToSheet,
  syncOperationalRosterToSheet: mocks.syncOperationalRosterToSheet,
}));

function toRow(row: { id: string; playerId: string; tournamentId: string; status: string; createdAt: Date }) {
  return {
    id: row.id,
    player_id: row.playerId,
    tournament_id: row.tournamentId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

vi.mock("@/lib/repositories", async () => {
  const { fake: f } = await import("./helpers/fake-capacity-db");
  const find = (playerId: string) => f.state.registrations.find((r) => r.playerId === playerId);
  return {
    playerRepository: {},
    seasonRepository: {},
    resultRepository: {},
    tournamentRepository: {
      findById: vi.fn(async () => ({ ...mocks.tournament, max_players: f.state.maxPlayers })),
    },
    registrationRepository: {
      findLatestByPlayerAndTournament: vi.fn(async (playerId: string) => {
        const row = find(playerId);
        return row ? [toRow(row)] : [];
      }),
      findActiveOrWaitlistByPlayerAndTournamentOrThrow: vi.fn(async (playerId: string) => {
        const row = find(playerId);
        if (!row || !["registered", "waitlist"].includes(row.status)) throw new Error("not found");
        return toRow(row);
      }),
      updateStatusSilent: vi.fn(async (id: string, status: string) => {
        const row = f.state.registrations.find((r) => r.id === id);
        if (row) row.status = status;
      }),
      findStatusAndTournamentById: vi.fn(async (id: string) => {
        const row = f.state.registrations.find((r) => r.id === id)!;
        return { status: row.status, tournament_id: row.tournamentId };
      }),
      delete: vi.fn(async (id: string) => {
        f.state.registrations = f.state.registrations.filter((r) => r.id !== id);
      }),
      findAdminParticipants: vi.fn(async () =>
        f.state.registrations
          .filter((r) => ["registered", "attended", "waitlist"].includes(r.status))
          .map((r) => ({
            id: r.id,
            status: r.status,
            player_id: r.playerId,
            players: { id: r.playerId, admin_display_name: null, display_name: r.playerId },
          }))
      ),
    },
    tournamentLiveStateRepository: {
      upsertAttendance: vi.fn(async (row: { player_id: string; arrived: boolean }) => {
        f.state.attendance.set(row.player_id, { arrived: row.arrived, arrivedAt: null });
        return { arrived: row.arrived, arrived_at: null };
      }),
    },
  };
});

vi.mock("@/features/tournament-no-show", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tournament-no-show")>()),
  // The real batched SQL is covered by the Postgres integration suite; the
  // fake db has no GROUP BY, so this test reads the fake state directly.
  getAdminNoShowPolicyState: vi.fn(async (_tournamentId: string, playerIds: string[]) => {
    const { fake: f } = await import("./helpers/fake-capacity-db");
    return new Map(
      playerIds.map((id) => [
        id,
        {
          no_show_count: f.state.registrations.filter((r) => r.playerId === id && r.noShowAt).length,
          online_registration_restricted: f.state.players.get(id)?.restrictedAt != null,
          no_show_at: f.state.registrations.find((r) => r.playerId === id)?.noShowAt?.toISOString() ?? null,
        },
      ])
    );
  }),
}));

const tournaments = await import("@/features/tournaments");
const actions = await import("@/features/tournament-roster-actions");
const { ADMISSION_NO_SEAT_MESSAGE } = await import("@/features/tournament-waitlist-capacity");

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  fake.state.startAt = new Date(Date.now() - 3600_000);
  mocks.tournament.is_final = false;
  mocks.assertPlayerActive.mockResolvedValue({ id: "player", is_blocked: false });
  mocks.assertServerActorRole.mockReset();
  mocks.assertServerActorRole.mockResolvedValue({ id: "staff", role: "operator" });
  mocks.resolveCurrentServerActor.mockReset();
  mocks.syncAdmittedPlayerToSheet.mockReset();
  mocks.syncAdmittedPlayerToSheet.mockResolvedValue({ arrivedWritten: true });
  mocks.syncOperationalRosterToSheet.mockReset();
  mocks.syncOperationalRosterToSheet.mockResolvedValue({
    synced: true,
    appended: 0,
    identityUpdated: 0,
    removed: 1,
    staleRowsPending: 0,
  });
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

function deny() {
  mocks.assertServerActorRole.mockRejectedValue(new Error("Недостаточно прав"));
}

describe("registerPlayerForTournament -- restricted self-registration", () => {
  it("normal (unrestricted) player behavior is unchanged: free seat => registered", async () => {
    const result = await tournaments.registerPlayerForTournament("normal", "t1");
    expect(result.status).toBe("registered");
    expect(result).not.toHaveProperty("online_registration_restricted");
  });

  it("restricted + free seat => a SUCCESSFUL waitlist registration (no throw), flagged for the UI", async () => {
    restrict("r");
    const result = await tournaments.registerPlayerForTournament("r", "t1");
    expect(result).toMatchObject({ status: "waitlist", online_registration_restricted: true });
  });

  it("restricted + full => waitlist", async () => {
    seedRegistrations("p", 40, "registered");
    restrict("r");
    const result = await tournaments.registerPlayerForTournament("r", "t1");
    expect(result.status).toBe("waitlist");
  });

  it("restricted + already waitlisted stays waitlisted", async () => {
    addRegistration("r", "waitlist");
    restrict("r");
    const result = await tournaments.registerPlayerForTournament("r", "t1");
    expect(result.status).toBe("waitlist");
  });

  it("an existing REGISTERED seat from before the restriction is kept", async () => {
    addRegistration("r", "registered");
    restrict("r");
    const result = await tournaments.registerPlayerForTournament("r", "t1");
    expect(result.status).toBe("registered");
  });

  it("cancellation remains available to a restricted player (registered or waitlisted)", async () => {
    addRegistration("r1", "registered");
    addRegistration("r2", "waitlist");
    restrict("r1");
    restrict("r2");

    await tournaments.cancelPlayerRegistration("r1", "t1");
    await tournaments.cancelPlayerRegistration("r2", "t1");

    expect(statusOf("r1")).toBe("cancelled");
    expect(statusOf("r2")).toBe("cancelled");
  });
});

describe("Delete ('Удалить') vs 'Не пришёл' -- different code paths, different side effects", () => {
  it("removeAdminTournamentParticipant never sets no_show_at or a restriction", async () => {
    seedRegistrations("p", 3, "registered");

    await tournaments.removeAdminTournamentParticipant("reg-p1");

    expect(registrationOf("p1")).toBeUndefined();
    expect(isRestricted("p1")).toBe(false);
    expect(fake.state.registrations.some((r) => r.noShowAt != null)).toBe(false);
    expect(fake.state.log).not.toContain("update:players");
  });

  it("markTournamentPlayerNoShow records the no-show and the restriction", async () => {
    seedRegistrations("p", 3, "registered");

    const result = await actions.markTournamentPlayerNoShow("t1", "reg-p1");

    expect(result).toEqual({ ok: true, promotedCount: 0 });
    expect(statusOf("p1")).toBe("waitlist");
    expect(registrationOf("p1")!.noShowAt).toBeInstanceOf(Date);
    expect(isRestricted("p1")).toBe(true);
  });
});

describe("Server Action authorization (operator/admin only)", () => {
  it("'Не пришёл' rejects an unauthorized caller and changes nothing", async () => {
    deny();
    seedRegistrations("p", 2, "registered");

    await expect(actions.markTournamentPlayerNoShow("t1", "reg-p1")).rejects.toThrow("Недостаточно прав");
    expect(statusOf("p1")).toBe("registered");
    expect(isRestricted("p1")).toBe(false);
  });

  it("'Допустить в игру' rejects an unauthorized caller and changes nothing", async () => {
    deny();
    addRegistration("w", "waitlist");
    restrict("w");

    await expect(actions.admitTournamentPlayerFromWaitlist("t1", "reg-w")).rejects.toThrow("Недостаточно прав");
    expect(statusOf("w")).toBe("waitlist");
    expect(isRestricted("w")).toBe(true);
    expect(fake.state.attendance.has("w")).toBe(false);
  });

  it("both actions use the existing staff guard with the same allowed roles", async () => {
    seedRegistrations("p", 2, "registered");
    await actions.markTournamentPlayerNoShow("t1", "reg-p1");
    await actions.admitTournamentPlayerFromWaitlist("t1", "reg-p1");
    expect(mocks.assertServerActorRole).toHaveBeenCalledTimes(2);
    for (const call of mocks.assertServerActorRole.mock.calls) {
      expect(call[0]).toEqual(["admin", "operator"]);
    }
  });

  it("getAdminTournamentParticipants (now carrying admin-only no-show data) is staff-only", async () => {
    deny();
    await expect(tournaments.getAdminTournamentParticipants("t1")).rejects.toThrow("Недостаточно прав");
  });
});

describe("admitTournamentPlayerFromWaitlist (Server Action)", () => {
  it("no free seat => { ok: false } with the exact message, nothing changes, no sheet write", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w", "waitlist");
    restrict("w");

    const result = await actions.admitTournamentPlayerFromWaitlist("t1", "reg-w");

    expect(result).toEqual({ ok: false, error: ADMISSION_NO_SEAT_MESSAGE });
    expect(statusOf("w")).toBe("waitlist");
    expect(isRestricted("w")).toBe(true);
    expect(mocks.syncAdmittedPlayerToSheet).not.toHaveBeenCalled();
  });

  it("success => admitted, then mirrored to the sheet for that player", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("w", "waitlist");

    const result = await actions.admitTournamentPlayerFromWaitlist("t1", "reg-w");

    expect(result).toEqual({ ok: true, promotedCount: 0 });
    expect(mocks.syncAdmittedPlayerToSheet).toHaveBeenCalledWith("t1", "w");
    expect(seatedCount()).toBe(40);
  });

  it("a sheet failure never undoes the admission -- surfaced as a warning", async () => {
    mocks.syncAdmittedPlayerToSheet.mockRejectedValue(new Error("Sheets down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    addRegistration("w", "waitlist");

    const result = await actions.admitTournamentPlayerFromWaitlist("t1", "reg-w");

    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("warning");
    expect(statusOf("w")).toBe("registered");
  });

  it("'Не пришёл' rejection is returned, not thrown (message reaches production UI)", async () => {
    fake.state.startAt = new Date(Date.now() + 3600_000);
    seedRegistrations("p", 2, "registered");

    const result = await actions.markTournamentPlayerNoShow("t1", "reg-p1");

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/ещё не начался/);
  });
});

describe("setTournamentPlayerAttendance -- the ONE canonical arrival path clears the restriction", () => {
  it("arrived=true on a registered seat clears the restriction", async () => {
    addRegistration("r", "registered");
    restrict("r");

    await tournaments.setTournamentPlayerAttendance("t1", "r", true);

    expect(isRestricted("r")).toBe(false);
  });

  it("arrived=false never creates (or restores) a restriction", async () => {
    addRegistration("n", "registered");
    addRegistration("r", "registered");
    restrict("r");

    await tournaments.setTournamentPlayerAttendance("t1", "n", false);
    await tournaments.setTournamentPlayerAttendance("t1", "r", false);

    expect(isRestricted("n")).toBe(false);
    expect(isRestricted("r")).toBe(true);
  });

  it("a waitlisted player's arrival never lifts the restriction (admission is required)", async () => {
    addRegistration("w", "waitlist");
    restrict("w");

    await tournaments.setTournamentPlayerAttendance("t1", "w", true);

    expect(isRestricted("w")).toBe(true);
    expect(statusOf("w")).toBe("waitlist");
  });

  it("clearing keeps no_show_at history intact", async () => {
    const row = addRegistration("r", "registered");
    row.noShowAt = new Date("2026-01-01T19:00:00Z");
    restrict("r");

    await tournaments.setTournamentPlayerAttendance("t1", "r", true);

    expect(registrationOf("r")!.noShowAt).toEqual(new Date("2026-01-01T19:00:00Z"));
  });
});

describe("getAdminTournamentParticipants", () => {
  it("exposes the derived count, restriction flag and this tournament's no_show_at", async () => {
    seedRegistrations("p", 2, "registered");
    await actions.markTournamentPlayerNoShow("t1", "reg-p1");

    const participants = await tournaments.getAdminTournamentParticipants("t1");
    const p1 = participants.find((p) => p.player_id === "p1")!;
    const p2 = participants.find((p) => p.player_id === "p2")!;

    expect(p1).toMatchObject({ status: "waitlist", no_show_count: 1, online_registration_restricted: true });
    expect(p1.no_show_at).not.toBeNull();
    expect(p2).toMatchObject({ status: "registered", no_show_count: 0, online_registration_restricted: false, no_show_at: null });
  });
});

describe("getMyOnlineRegistrationRestriction -- session-bound, never by playerId", () => {
  it("returns the current session player's own flag", async () => {
    restrict("me");
    mocks.resolveCurrentServerActor.mockResolvedValue({ id: "me", role: "player" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // isPlayerOnlineRegistrationRestricted is real and reads the fake db.
    const result = await tournaments.getMyOnlineRegistrationRestriction();
    expect(result).toEqual({ restricted: true });
  });

  it("another player's restriction never leaks into mine", async () => {
    restrict("someone-else");
    mocks.resolveCurrentServerActor.mockResolvedValue({ id: "me", role: "player" });
    await expect(tournaments.getMyOnlineRegistrationRestriction()).resolves.toEqual({ restricted: false });
  });

  it("no session => not restricted (nothing leaked)", async () => {
    mocks.resolveCurrentServerActor.mockResolvedValue(null);
    await expect(tournaments.getMyOnlineRegistrationRestriction()).resolves.toEqual({ restricted: false });
  });
});

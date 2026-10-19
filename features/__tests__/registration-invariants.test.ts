import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  eliminate,
  fake,
  registrationOf,
  resetFakeCapacityDb,
  seatedCount,
  statusOf,
} from "./helpers/fake-capacity-db";

// Registration invariants through the features/tournaments.ts entry points
// -- same end-to-end technique as no-show-entry-points.test.ts: the REAL
// tournaments module and the REAL capacity module over the stateful fake
// `db` (mutex-serialized transactions standing in for the tournament-row
// lock), repository calls mocked onto that same in-memory state. The real
// Postgres row-lock interleavings are covered by
// registration-invariants.postgres.integration.test.ts.
//   RULE 1 -- arrived_at IS NOT NULL => no self-cancellation, ever.
//   RULE 2 -- Late Registration snapshot exists => the field can't grow.
const mocks = vi.hoisted(() => ({
  assertPlayerActive: vi.fn(),
  assertServerActorRole: vi.fn(),
  playerCreate: vi.fn(),
  registrationCreateSilent: vi.fn(),
  tournament: { id: "t1", max_players: 40, is_final: false, status: "open", kind: "free" },
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));
vi.mock("@/features/auth-server", () => ({ assertPlayerActive: mocks.assertPlayerActive }));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.assertServerActorRole,
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/features/seasons", () => ({ resolveSeasonForTournamentDate: vi.fn() }));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
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
  return {
    playerRepository: { create: mocks.playerCreate },
    seasonRepository: {},
    resultRepository: {},
    tournamentRepository: {
      findById: vi.fn(async () => ({ ...mocks.tournament, max_players: f.state.maxPlayers })),
    },
    registrationRepository: {
      findLatestByPlayerAndTournament: vi.fn(async (playerId: string) => {
        const row = f.state.registrations.find((r) => r.playerId === playerId);
        return row ? [toRow(row)] : [];
      }),
      createSilent: mocks.registrationCreateSilent,
    },
    tournamentLiveStateRepository: {
      // Same arrived/arrived_at semantics as the real single-statement
      // upsert: arrived overwritten, arrived_at stamped once and kept.
      upsertAttendance: vi.fn(async (row: { player_id: string; arrived: boolean }) => {
        const existing = f.state.attendance.get(row.player_id);
        const arrivedAt = existing?.arrivedAt ?? (row.arrived ? new Date() : null);
        f.state.attendance.set(row.player_id, { arrived: row.arrived, arrivedAt });
        return { arrived: row.arrived, arrived_at: arrivedAt?.toISOString() ?? null };
      }),
    },
  };
});

const tournaments = await import("@/features/tournaments");
const capacity = await import("@/features/tournament-waitlist-capacity");

const ARRIVED_MESSAGE = "После отметки «Пришёл» отменить регистрацию нельзя";
const LATE_REG_MESSAGE = "Поздняя регистрация завершена — запись на турнир закрыта";

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  mocks.assertPlayerActive.mockResolvedValue({ id: "player", is_blocked: false });
  mocks.assertServerActorRole.mockResolvedValue({ id: "staff", role: "operator" });
  mocks.playerCreate.mockReset();
  mocks.registrationCreateSilent.mockReset();
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

function registrationsSnapshot() {
  return fake.state.registrations.map((row) => ({ ...row }));
}

describe("RULE 1 -- no self-cancellation after a recorded arrival", () => {
  it("1. registered + never arrived -> self-cancel works", async () => {
    addRegistration("p", "registered");

    await tournaments.cancelPlayerRegistration("p", "t1");

    expect(statusOf("p")).toBe("cancelled");
  });

  it("2 + 5. arrived_at != null -> rejected, registration row unchanged, decided under the lock", async () => {
    addRegistration("p", "registered");
    await tournaments.setTournamentPlayerAttendance("t1", "p", true);
    const before = registrationsSnapshot();
    fake.state.log = [];

    await expect(tournaments.cancelPlayerRegistration("p", "t1")).rejects.toThrow(ARRIVED_MESSAGE);

    expect(fake.state.registrations).toEqual(before);
    expect(fake.state.log.slice(0, 3)).toEqual(["tx:begin", "lock:tournaments", "select:tournament_attendance"]);
    expect(fake.state.log).not.toContain("update:registrations");
  });

  it("3. arrived, then busted out -> still rejected", async () => {
    addRegistration("p", "registered");
    await tournaments.setTournamentPlayerAttendance("t1", "p", true);
    eliminate("p");
    const before = registrationsSnapshot();

    await expect(tournaments.cancelPlayerRegistration("p", "t1")).rejects.toThrow(ARRIVED_MESSAGE);

    expect(fake.state.registrations).toEqual(before);
  });

  it("4. arrived later toggled to false (arrived_at kept) -> still rejected", async () => {
    addRegistration("p", "registered");
    await tournaments.setTournamentPlayerAttendance("t1", "p", true);
    await tournaments.setTournamentPlayerAttendance("t1", "p", false);
    expect(fake.state.attendance.get("p")).toMatchObject({ arrived: false });
    expect(fake.state.attendance.get("p")?.arrivedAt).not.toBeNull();
    const before = registrationsSnapshot();

    await expect(tournaments.cancelPlayerRegistration("p", "t1")).rejects.toThrow(ARRIVED_MESSAGE);

    expect(fake.state.registrations).toEqual(before);
  });

  it("the arrival write itself runs under the tournament-row lock", async () => {
    addRegistration("p", "registered");
    fake.state.log = [];

    await tournaments.setTournamentPlayerAttendance("t1", "p", true);

    expect(fake.state.log.slice(0, 2)).toEqual(["tx:begin", "lock:tournaments"]);
  });

  it("another player's arrival does not block this player's cancel", async () => {
    addRegistration("a", "registered");
    addRegistration("p", "registered");
    await tournaments.setTournamentPlayerAttendance("t1", "a", true);

    await tournaments.cancelPlayerRegistration("p", "t1");

    expect(statusOf("p")).toBe("cancelled");
    expect(statusOf("a")).toBe("registered");
  });
});

describe("RULE 2 -- no new entrant after Late Registration closes", () => {
  it("6. Late Reg open -> ordinary registration works as before", async () => {
    resetFakeCapacityDb({ maxPlayers: 1 });

    expect((await tournaments.registerPlayerForTournament("a", "t1")).status).toBe("registered");
    expect((await tournaments.registerPlayerForTournament("b", "t1")).status).toBe("waitlist");
  });

  it("7. closed + new player -> rejected, no registered and no waitlist row", async () => {
    fake.state.lateRegistrationClosed = true;

    await expect(tournaments.registerPlayerForTournament("n", "t1")).rejects.toThrow(LATE_REG_MESSAGE);

    expect(registrationOf("n")).toBeUndefined();
    expect(fake.state.registrations).toHaveLength(0);
  });

  it("7b. closed + full table -> a newcomer is NOT put on the waitlist either", async () => {
    resetFakeCapacityDb({ maxPlayers: 1 });
    addRegistration("a", "registered");
    fake.state.lateRegistrationClosed = true;

    await expect(capacity.admitPlayerToTournament("t1", "n")).rejects.toThrow(LATE_REG_MESSAGE);

    expect(registrationOf("n")).toBeUndefined();
  });

  it("8. closed + cancelled row -> not reactivated", async () => {
    addRegistration("c", "cancelled");
    fake.state.lateRegistrationClosed = true;

    await expect(tournaments.registerPlayerForTournament("c", "t1")).rejects.toThrow(LATE_REG_MESSAGE);

    expect(statusOf("c")).toBe("cancelled");
  });

  it("9. closed + admin add existing player -> rejected", async () => {
    addRegistration("c", "cancelled");
    fake.state.lateRegistrationClosed = true;

    await expect(tournaments.addExistingPlayerToTournament("t1", "x")).rejects.toThrow(LATE_REG_MESSAGE);
    await expect(tournaments.addExistingPlayerToTournament("t1", "c")).rejects.toThrow(LATE_REG_MESSAGE);

    expect(registrationOf("x")).toBeUndefined();
    expect(statusOf("c")).toBe("cancelled");
  });

  it("10. closed + admin add new nickname -> rejected, no orphan player, nothing written", async () => {
    fake.state.lateRegistrationClosed = true;

    await expect(tournaments.addAdminTournamentParticipant("t1", "Walk-in")).rejects.toThrow(
      LATE_REG_MESSAGE
    );

    expect(fake.state.players.size).toBe(0);
    expect(fake.state.registrations).toHaveLength(0);
    // The old lock-free repository path is never used.
    expect(mocks.playerCreate).not.toHaveBeenCalled();
    expect(mocks.registrationCreateSilent).not.toHaveBeenCalled();
    expect(fake.state.log).not.toContain("insert:players");
  });

  it("10b. open + admin add new nickname -> player + registered row in one locked transaction", async () => {
    await tournaments.addAdminTournamentParticipant("t1", "  Walk-in  ");

    expect(fake.state.log).toEqual(
      expect.arrayContaining(["tx:begin", "lock:tournaments", "insert:players", "insert:registrations"])
    );
    expect(fake.state.log.indexOf("lock:tournaments")).toBeLessThan(fake.state.log.indexOf("insert:players"));
    const [[playerId, player]] = Array.from(fake.state.players.entries());
    expect(player.displayName).toBe("Walk-in");
    expect(statusOf(playerId)).toBe("registered");
  });

  it("11. existing registered/attended/waitlist rows unchanged; pre-arrival cancel still allowed", async () => {
    resetFakeCapacityDb({ maxPlayers: 3 });
    addRegistration("r", "registered");
    addRegistration("a", "attended");
    addRegistration("r2", "registered");
    addRegistration("w", "waitlist");
    fake.state.lateRegistrationClosed = true;
    const before = registrationsSnapshot();

    expect((await tournaments.registerPlayerForTournament("r", "t1")).status).toBe("registered");
    expect((await tournaments.registerPlayerForTournament("w", "t1")).status).toBe("waitlist");
    await expect(tournaments.registerPlayerForTournament("n", "t1")).rejects.toThrow(LATE_REG_MESSAGE);
    expect(fake.state.registrations).toEqual(before);

    await tournaments.cancelPlayerRegistration("r2", "t1");
    expect(statusOf("r2")).toBe("cancelled");
    expect(statusOf("w")).toBe("waitlist");
  });

  it("12. existing waitlist still never auto-promotes and can't be staff-admitted after close", async () => {
    resetFakeCapacityDb({ maxPlayers: 2 });
    addRegistration("r1", "registered");
    addRegistration("r2", "registered");
    const waiting = addRegistration("w", "waitlist");
    fake.state.lateRegistrationClosed = true;
    eliminate("r1");

    expect((await capacity.reconcileTournamentWaitlistCapacity("t1")).promotedPlayerIds).toEqual([]);
    await expect(capacity.admitWaitlistedRegistrationWithinCapacity("t1", waiting.id)).rejects.toThrow(
      "Поздняя регистрация закрыта — допуск из листа ожидания невозможен"
    );

    expect(statusOf("w")).toBe("waitlist");
    expect(seatedCount()).toBe(1);
  });
});

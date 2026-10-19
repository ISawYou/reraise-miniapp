import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  eliminate,
  fake,
  resetFakeCapacityDb,
  seatedCount,
  seedRegistrations,
  statusOf,
} from "./helpers/fake-capacity-db";

// Waitlist / seat-capacity behavior of the features/tournaments.ts entry
// points (self-registration, self-cancellation, admin add/remove, the
// elimination toggle), driven end-to-end against the REAL
// features/tournament-waitlist-capacity.ts module and the stateful fake
// `db` in ./helpers/fake-capacity-db.ts. The repository-layer calls those
// entry points still make (pre-checks, cancellation/removal writes, the
// eliminated=true upsert) are mocked here to read/write the SAME in-memory
// state, so every step of a scenario sees the previous step's effects.
//
// (Previously this file drove the legacy Supabase query-builder chain and
// failed at import time with "NEXT_PUBLIC_SUPABASE_URL is not set".)
const mocks = vi.hoisted(() => ({
  assertPlayerActive: vi.fn(),
  assertServerActorRole: vi.fn(),
  tournament: { id: "t1", max_players: 40, is_final: false, status: "open", kind: "free" },
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));

vi.mock("@/features/auth-server", () => ({ assertPlayerActive: mocks.assertPlayerActive }));
vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: mocks.assertServerActorRole }));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/features/seasons", () => ({ resolveSeasonForTournamentDate: vi.fn() }));

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
      // Must never be used for capacity any more.
      findRegisteredTournamentIds: vi.fn(async () => {
        throw new Error("lifetime registration count must not be used for capacity");
      }),
      findOldestWaitlisted: vi.fn(async () => {
        throw new Error("ad hoc single promotion must not be used any more");
      }),
    },
    tournamentLiveStateRepository: {
      findEliminatedAtByTournamentAndPlayer: vi.fn(async () => null),
      upsertElimination: vi.fn(async (row: { player_id: string; eliminated: boolean }) => {
        f.state.eliminations.set(row.player_id, row.eliminated);
      }),
    },
  };
});

const {
  addExistingPlayerToTournament,
  cancelPlayerRegistration,
  registerPlayerForTournament,
  removeAdminTournamentParticipant,
  setTournamentPlayerElimination,
} = await import("@/features/tournaments");

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  mocks.tournament.is_final = false;
  mocks.assertPlayerActive.mockResolvedValue({ id: "player", is_blocked: false });
  mocks.assertServerActorRole.mockResolvedValue({ id: "staff", role: "operator" });
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

describe("registerPlayerForTournament", () => {
  it("max=40, registered=40, eliminated=0 => next registration goes to waitlist", async () => {
    seedRegistrations("p", 40, "registered");

    const result = await registerPlayerForTournament("newcomer", "t1");

    expect(result.status).toBe("waitlist");
  });

  it("registers when a seat is free -- an eliminated registration no longer counts against max_players", async () => {
    seedRegistrations("p", 40, "registered");
    eliminate("p1");

    const result = await registerPlayerForTournament("newcomer", "t1");

    expect(result.status).toBe("registered");
    expect(seatedCount()).toBe(40);
  });

  it("an already-waitlisted player re-checks capacity instead of getting the stale waitlist row back", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    // Elimination recorded without any reconciliation having run yet
    // (e.g. state from before this fix shipped).
    eliminate("p9");

    const result = await registerPlayerForTournament("w1", "t1");

    expect(result).toMatchObject({ id: "reg-w1", status: "registered" });
  });

  it("an already-waitlisted player who is not oldest stays waitlisted", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");
    eliminate("p9");

    const result = await registerPlayerForTournament("w2", "t1");

    expect(result.status).toBe("waitlist");
    expect(statusOf("w1")).toBe("registered");
  });

  it("is_final: still rejected before any capacity transaction", async () => {
    mocks.tournament.is_final = true;

    await expect(registerPlayerForTournament("newcomer", "t1")).rejects.toThrow(
      "Регистрация на финальный турнир доступна только по приглашению."
    );
    expect(fake.state.log).toEqual([]);
  });

  it("is_final: an admin-curated waitlist row is returned untouched, never self-promoted", async () => {
    mocks.tournament.is_final = true;
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p1");

    const result = await registerPlayerForTournament("w1", "t1");

    expect(result.status).toBe("waitlist");
    expect(fake.state.log).toEqual([]);
  });
});

describe("cancelPlayerRegistration", () => {
  it("a registered player cancelling promotes the oldest waitlisted player via the reconciler", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");

    await cancelPlayerRegistration("p5", "t1");

    expect(statusOf("p5")).toBe("cancelled");
    expect(statusOf("w1")).toBe("registered");
    expect(statusOf("w2")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("a waitlisted player cancelling promotes nobody (only the locked cancel itself, no reconciler run)", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");

    await cancelPlayerRegistration("w1", "t1");

    expect(statusOf("w1")).toBe("cancelled");
    expect(statusOf("w2")).toBe("waitlist");
    // Exactly one transaction: the arrival-aware cancel, lock first.
    expect(fake.state.log).toEqual([
      "tx:begin",
      "lock:tournaments",
      "select:tournament_attendance",
      "select:registrations",
      "update:registrations",
    ]);
  });

  it("does not promote after Late Registration closed", async () => {
    fake.state.lateRegistrationClosed = true;
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    await cancelPlayerRegistration("p5", "t1");

    expect(statusOf("w1")).toBe("waitlist");
  });
});

describe("admin add / remove", () => {
  it("addExistingPlayerToTournament uses the seat-aware decision (not a lifetime count)", async () => {
    seedRegistrations("p", 40, "registered");
    eliminate("p1");

    await addExistingPlayerToTournament("t1", "walk-in");
    await addExistingPlayerToTournament("t1", "walk-in-2");

    expect(statusOf("walk-in")).toBe("registered");
    expect(statusOf("walk-in-2")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("removeAdminTournamentParticipant of a seat-holder promotes via the reconciler", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    await removeAdminTournamentParticipant("reg-p3");

    expect(statusOf("p3")).toBeUndefined();
    expect(statusOf("w1")).toBe("registered");
  });
});

describe("setTournamentPlayerElimination -- the single elimination choke point", () => {
  it("eliminating a player promotes the oldest waitlisted player into the freed seat", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    await setTournamentPlayerElimination("t1", "p4", true);

    expect(statusOf("p4")).toBe("registered"); // status untouched by elimination
    expect(statusOf("w1")).toBe("registered");
    expect(seatedCount()).toBe(40);
  });

  it("a batch of eliminations (one call each, e.g. pull-sheet) promotes exactly one per freed seat", async () => {
    seedRegistrations("p", 40, "registered");
    for (let i = 1; i <= 5; i++) addRegistration(`w${i}`, "waitlist");

    await Promise.all([
      setTournamentPlayerElimination("t1", "p1", true),
      setTournamentPlayerElimination("t1", "p2", true),
      setTournamentPlayerElimination("t1", "p3", true),
    ]);

    expect(["w1", "w2", "w3"].map(statusOf)).toEqual(["registered", "registered", "registered"]);
    expect(["w4", "w5"].map(statusOf)).toEqual(["waitlist", "waitlist"]);
    expect(seatedCount()).toBe(40);
  });

  it("return to game is BLOCKED (Russian error, nothing changes) when it would exceed max_players", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    await setTournamentPlayerElimination("t1", "p4", true); // w1 takes the seat

    await expect(setTournamentPlayerElimination("t1", "p4", false)).rejects.toThrow(
      "Невозможно вернуть игрока в игру — турнир заполнен (нет свободных мест)"
    );
    expect(fake.state.eliminations.get("p4")).toBe(true);
    expect(statusOf("w1")).toBe("registered");
    expect(seatedCount()).toBe(40);
  });

  it("return to game succeeds when a seat is free", async () => {
    seedRegistrations("p", 40, "registered");
    await setTournamentPlayerElimination("t1", "p4", true); // no waitlist -> seat stays free

    await expect(setTournamentPlayerElimination("t1", "p4", false)).resolves.toEqual({
      eliminated: false,
      eliminated_at: null,
    });
    expect(fake.state.eliminations.get("p4")).toBe(false);
    expect(seatedCount()).toBe(40);
  });
});

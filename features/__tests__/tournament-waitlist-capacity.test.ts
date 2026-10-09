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

// Exercises the REAL capacity logic in features/tournament-waitlist-capacity.ts
// against the stateful fake `db` in ./helpers/fake-capacity-db.ts. See that
// file's header for what the fake does and does not prove -- in short: the
// fake runs transactions one at a time to stand in for the real
// `SELECT ... FOR UPDATE` tournament-row lock; that a real Postgres server
// serializes concurrent transactions on that lock is standard Postgres
// behavior (the same caveat features/__tests__/teams.test.ts states), not
// something this mocked suite can prove. What it DOES prove: every capacity
// transaction takes that lock as its very first statement, and every
// decision is computed from the state left by the previous one.
vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));

const {
  admitPlayerToTournament,
  assertTournamentSeatAvailableForReturn,
  computeSeatLoad,
  reconcileTournamentWaitlistCapacity,
  RETURN_TO_GAME_NO_SEAT_MESSAGE,
  TournamentCapacityUnavailableError,
  TournamentSeatUnavailableError,
  unEliminateTournamentPlayerWithinCapacity,
} = await import("@/features/tournament-waitlist-capacity");

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

describe("computeSeatLoad -- the one capacity formula", () => {
  it("counts registered + attended, never waitlist or cancelled", () => {
    const rows = [
      { playerId: "a", status: "registered" },
      { playerId: "b", status: "attended" },
      { playerId: "c", status: "waitlist" },
      { playerId: "d", status: "cancelled" },
    ];
    expect(computeSeatLoad(rows, new Set())).toBe(2);
  });

  it("an eliminated player whose status is still `registered` frees their seat (no status change required)", () => {
    const rows = [
      { playerId: "a", status: "registered" },
      { playerId: "b", status: "registered" },
    ];
    expect(computeSeatLoad(rows, new Set(["a"]))).toBe(1);
  });

  it("a registered player who has not arrived still reserves a seat -- arrived is not an input at all", () => {
    // The formula's only inputs are registration status and elimination;
    // tournament_attendance is never read by the capacity module.
    expect(computeSeatLoad([{ playerId: "not-arrived", status: "registered" }], new Set())).toBe(1);
  });
});

describe("reconcileTournamentWaitlistCapacity", () => {
  it("max=40, registered=40, eliminated=0 => promotes nobody", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result).toEqual({ promotedRegistrationIds: [], promotedPlayerIds: [] });
    expect(statusOf("w1")).toBe("waitlist");
  });

  it("max=40, registered=40, eliminated=1 => promotes the oldest waitlisted registration", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");
    eliminate("p7");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result).toEqual({ promotedRegistrationIds: ["reg-w1"], promotedPlayerIds: ["w1"] });
    expect(statusOf("w1")).toBe("registered");
    expect(statusOf("w2")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("10 eliminated => exactly the 10 FIFO-oldest waitlisted are promoted, in order", async () => {
    seedRegistrations("p", 40, "registered");
    // Insert out of created_at order to prove ordering is by created_at,
    // not by insertion/row order.
    for (let i = 12; i >= 1; i--) {
      addRegistration(`w${i}`, "waitlist", new Date(Date.parse("2026-02-01T00:00:00Z") + i * 1000));
    }
    for (let i = 1; i <= 10; i++) eliminate(`p${i}`);

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10"]);
    expect(statusOf("w11")).toBe("waitlist");
    expect(statusOf("w12")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("FIFO: with one free seat, the older of two waitlisted players is promoted, never the newer", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("newer", "waitlist", new Date("2026-03-01T12:00:00Z"));
    addRegistration("older", "waitlist", new Date("2026-03-01T10:00:00Z"));
    eliminate("p1");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["older"]);
    expect(statusOf("newer")).toBe("waitlist");
  });

  it("an eliminated player with status still `registered` frees the seat (end-to-end)", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p40");

    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("p40")).toBe("registered"); // untouched
    expect(statusOf("w1")).toBe("registered");
  });

  it("registered-but-not-arrived players still reserve seats (no promotion into their seats)", async () => {
    // 40 registered, none arrived (attendance is not modeled at all -- the
    // module never reads it), nobody eliminated.
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("w1")).toBe("waitlist");
  });

  it("does NOT promote once a Late Registration snapshot exists, even with free seats", async () => {
    fake.state.lateRegistrationClosed = true;
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    for (let i = 1; i <= 5; i++) eliminate(`p${i}`);

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual([]);
    expect(statusOf("w1")).toBe("waitlist");
    expect(fake.state.log).not.toContain("update:registrations");
  });

  it("is idempotent -- a second call with no state change promotes nothing", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1");
    const second = await reconcileTournamentWaitlistCapacity("t1");

    expect(second.promotedPlayerIds).toEqual([]);
    expect(statusOf("w2")).toBe("waitlist");
  });

  it("takes the tournament-row FOR UPDATE lock as the very first statement of its transaction", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1");

    expect(fake.state.log.slice(0, 2)).toEqual(["tx:begin", "lock:tournaments"]);
  });

  it("returns an empty result for a tournament that no longer exists", async () => {
    fake.state.tournamentExists = false;
    await expect(reconcileTournamentWaitlistCapacity("t1")).resolves.toEqual({
      promotedRegistrationIds: [],
      promotedPlayerIds: [],
    });
  });

  it("fails closed outside DATABASE_PROVIDER=postgres", async () => {
    process.env.DATABASE_PROVIDER = "supabase";
    await expect(reconcileTournamentWaitlistCapacity("t1")).rejects.toBeInstanceOf(
      TournamentCapacityUnavailableError
    );
  });
});

describe("admitPlayerToTournament -- a new entrant's seat decision", () => {
  it("max=40, registered=40, eliminated=0 => the next registration goes to waitlist", async () => {
    seedRegistrations("p", 40, "registered");

    const reg = await admitPlayerToTournament("t1", "newcomer");

    expect(reg).toMatchObject({ player_id: "newcomer", tournament_id: "t1", status: "waitlist" });
  });

  it("the first max_players entrants are registered, the rest waitlisted (FIFO preserved)", async () => {
    resetFakeCapacityDb({ maxPlayers: 2 });

    const a = await admitPlayerToTournament("t1", "a");
    const b = await admitPlayerToTournament("t1", "b");
    const c = await admitPlayerToTournament("t1", "c");

    expect([a.status, b.status, c.status]).toEqual(["registered", "registered", "waitlist"]);
  });

  it("an eliminated seat-holder's seat goes to the existing waitlist first -- a newcomer never jumps the queue", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p1");

    const reg = await admitPlayerToTournament("t1", "newcomer");

    expect(statusOf("w1")).toBe("registered");
    expect(reg.status).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("with a free seat and an empty waitlist, a newcomer is registered (not a lifetime cap)", async () => {
    seedRegistrations("p", 40, "registered");
    eliminate("p1");

    const reg = await admitPlayerToTournament("t1", "newcomer");

    expect(reg.status).toBe("registered");
    expect(seatedCount()).toBe(40);
  });

  it("an already-waitlisted player is re-evaluated: first in line + free seat => comes back registered", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p3");

    const reg = await admitPlayerToTournament("t1", "w1");

    expect(reg).toMatchObject({ id: "reg-w1", status: "registered" });
  });

  it("an already-waitlisted player who is NOT first in line stays waitlisted", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    addRegistration("w2", "waitlist");
    eliminate("p3");

    const reg = await admitPlayerToTournament("t1", "w2");

    expect(reg.status).toBe("waitlist");
    expect(statusOf("w1")).toBe("registered");
  });

  it("reactivates a cancelled row in place instead of inserting a duplicate", async () => {
    resetFakeCapacityDb({ maxPlayers: 5 });
    addRegistration("a", "cancelled");

    const reg = await admitPlayerToTournament("t1", "a");

    expect(reg).toMatchObject({ id: "reg-a", status: "registered" });
    expect(fake.state.registrations).toHaveLength(1);
  });

  it("returns an existing registered row unchanged (racing duplicate call)", async () => {
    addRegistration("a", "registered");

    const reg = await admitPlayerToTournament("t1", "a");

    expect(reg).toMatchObject({ id: "reg-a", status: "registered" });
    expect(fake.state.log).not.toContain("insert:registrations");
  });
});

describe("unEliminateTournamentPlayerWithinCapacity -- return to game", () => {
  it("is BLOCKED with a clear Russian error when it would make seatLoad 41/40, and changes nothing", async () => {
    seedRegistrations("p", 40, "registered");
    eliminate("p1");
    addRegistration("w1", "waitlist");
    // p1's seat was taken by w1 -> 40/40 seated without p1.
    await reconcileTournamentWaitlistCapacity("t1");
    expect(seatedCount()).toBe(40);

    await expect(unEliminateTournamentPlayerWithinCapacity("t1", "p1")).rejects.toThrow(
      RETURN_TO_GAME_NO_SEAT_MESSAGE
    );
    await expect(unEliminateTournamentPlayerWithinCapacity("t1", "p1")).rejects.toBeInstanceOf(
      TournamentSeatUnavailableError
    );
    expect(RETURN_TO_GAME_NO_SEAT_MESSAGE).toBe(
      "Невозможно вернуть игрока в игру — турнир заполнен (нет свободных мест)"
    );
    expect(fake.state.eliminations.get("p1")).toBe(true);
    expect(statusOf("w1")).toBe("registered");
    expect(seatedCount()).toBe(40);
  });

  it("succeeds when capacity allows it (39/40 without this player)", async () => {
    seedRegistrations("p", 40, "registered");
    eliminate("p1");

    await unEliminateTournamentPlayerWithinCapacity("t1", "p1");

    expect(fake.state.eliminations.get("p1")).toBe(false);
    expect(seatedCount()).toBe(40);
  });

  it("is a no-op capacity-wise for a player who is not currently eliminated (e.g. pull-sheet re-asserting false on a full table)", async () => {
    seedRegistrations("p", 40, "registered");

    await expect(unEliminateTournamentPlayerWithinCapacity("t1", "p5")).resolves.toBeUndefined();
    expect(seatedCount()).toBe(40);
  });

  it("still enforces capacity after Late Registration closed (physical seats)", async () => {
    resetFakeCapacityDb({ maxPlayers: 2, lateRegistrationClosed: true });
    addRegistration("a", "registered");
    addRegistration("b", "registered");
    addRegistration("c", "registered");
    eliminate("c");

    await expect(unEliminateTournamentPlayerWithinCapacity("t1", "c")).rejects.toBeInstanceOf(
      TournamentSeatUnavailableError
    );
  });

  it("the advisory pre-check uses the same rule (and never writes)", async () => {
    resetFakeCapacityDb({ maxPlayers: 1 });
    addRegistration("a", "registered");
    addRegistration("b", "registered");
    eliminate("b");

    await expect(assertTournamentSeatAvailableForReturn("t1", "b")).rejects.toBeInstanceOf(
      TournamentSeatUnavailableError
    );
    await expect(assertTournamentSeatAvailableForReturn("t1", "a")).resolves.toBeUndefined();
    expect(fake.state.log.some((entry) => entry.startsWith("insert:"))).toBe(false);
  });
});

describe("capacity decisions never read stale state", () => {
  it("two sequential decisions around the boundary: the second sees the first one's write", async () => {
    seedRegistrations("p", 39, "registered");

    const first = await admitPlayerToTournament("t1", "x");
    const second = await admitPlayerToTournament("t1", "y");

    expect(first.status).toBe("registered");
    expect(second.status).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("simultaneous entrants / elimination / return-to-game racing for seats never exceed max_players", async () => {
    // Real-concurrency safety rests on Postgres's FOR UPDATE lock; here the
    // fake serializes transactions the way that lock does, and this proves
    // every decision is taken under it from fresh state.
    seedRegistrations("p", 39, "registered");
    eliminate("p2");
    addRegistration("w1", "waitlist");
    // seated 38/40 -> 2 free seats; w1 is waiting.

    const outcomes = await Promise.allSettled([
      admitPlayerToTournament("t1", "x"),
      admitPlayerToTournament("t1", "y"),
      unEliminateTournamentPlayerWithinCapacity("t1", "p2"),
      reconcileTournamentWaitlistCapacity("t1"),
      admitPlayerToTournament("t1", "z"),
    ]);

    expect(seatedCount()).toBeLessThanOrEqual(40);
    expect(seatedCount()).toBe(40);
    // Each capacity transaction locked the tournament row first.
    const log = fake.state.log;
    log.forEach((entry, index) => {
      if (entry === "tx:begin") expect(log[index + 1]).toBe("lock:tournaments");
    });
    // At least one of the competing seat claims lost.
    const losers = outcomes.filter(
      (o) =>
        o.status === "rejected" ||
        (o.status === "fulfilled" && (o.value as { status?: string })?.status === "waitlist")
    );
    expect(losers.length).toBeGreaterThan(0);
  });
});

describe("lifetime entrants vs simultaneous seats", () => {
  it("50 lifetime admitted entrants while seatLoad never exceeds max_players=40", async () => {
    // 40 initial registrations + 10 waitlisted.
    for (let i = 1; i <= 50; i++) {
      await admitPlayerToTournament("t1", `p${i}`);
      expect(seatedCount()).toBeLessThanOrEqual(40);
    }
    expect(fake.state.registrations.filter((r) => r.status === "waitlist")).toHaveLength(10);

    // Elimination waves: each elimination frees one seat, the reconciler
    // (as setTournamentPlayerElimination would) fills it.
    for (let i = 1; i <= 10; i++) {
      eliminate(`p${i}`);
      await reconcileTournamentWaitlistCapacity("t1");
      expect(seatedCount()).toBeLessThanOrEqual(40);
    }

    const everAdmitted = fake.state.registrations.filter(
      (r) => r.status === "registered" || r.status === "attended"
    );
    expect(everAdmitted).toHaveLength(50);
    expect(seatedCount()).toBe(40);
    expect(fake.state.registrations.filter((r) => r.status === "waitlist")).toHaveLength(0);
  });
});

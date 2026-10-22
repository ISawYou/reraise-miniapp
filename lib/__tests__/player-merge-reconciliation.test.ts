import { describe, expect, it } from "vitest";
import {
  checkResultResolutions,
  planTournamentCollisions,
  reconcileAttendancePair,
  reconcileEliminationPair,
  reconcileLiveEntryPair,
  reconcileRebuyStatePair,
  reconcileRegistrationPair,
  type LiveEntrySnapshot,
  type OverlapRows,
  type RegistrationSnapshot,
  type ResultSnapshot,
} from "@/lib/player-merge-reconciliation";

// Pure merge engine v2 reconciliation rules (lib/player-merge-reconciliation.ts).
// The real-Postgres proof of the same rules lives in
// lib/__tests__/admin-account-merge.postgres.integration.test.ts.

const T = "target-player";
const S = "source-player";
const TOUR = "tournament-1";

const d = (iso: string) => new Date(iso);

function reg(overrides: Partial<RegistrationSnapshot> & { id: string; playerId: string }): RegistrationSnapshot {
  return {
    tournamentId: TOUR,
    status: "registered",
    createdAt: d("2026-09-01T10:00:00Z"),
    noShowAt: null,
    waitlistPromotionNotificationClaimedAt: null,
    ...overrides,
  };
}

function live(overrides: Partial<LiveEntrySnapshot> & { id: string; playerId: string; registrationId: string }): LiveEntrySnapshot {
  return {
    tournamentId: TOUR,
    arrived: false,
    rebuys: 0,
    addons: 0,
    knockouts: 0,
    bossKnockouts: 0,
    place: null,
    sheetRowNumber: null,
    createdAt: d("2026-09-13T15:00:00Z"),
    updatedAt: d("2026-09-13T15:00:00Z"),
    ...overrides,
  };
}

function result(overrides: Partial<ResultSnapshot> & { id: string; playerId: string; place: number }): ResultSnapshot {
  return {
    tournamentId: TOUR,
    ratingPoints: 10,
    reentries: 1,
    addons: 0,
    knockouts: 0,
    bossKnockouts: 0,
    mysteryBountyPoints: 0,
    ...overrides,
  };
}

function emptyRows(): OverlapRows {
  return { registrations: [], results: [], liveEntries: [], eliminations: [], attendance: [], rebuyStates: [] };
}

describe("reconcileRegistrationPair", () => {
  it("attended > registered > waitlist > cancelled; the winning row is the one kept", () => {
    const order = ["cancelled", "waitlist", "registered", "attended"];
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        const out = reconcileRegistrationPair(
          reg({ id: "rt", playerId: T, status: order[i] }),
          reg({ id: "rs", playerId: S, status: order[j] }),
          { participated: false }
        );
        expect(out.status).toBe(order[Math.max(i, j)]);
        expect(out.keep).toBe(j > i ? "source" : "target");
        expect(out.keepId).toBe(j > i ? "rs" : "rt");
        expect(out.deleteId).toBe(j > i ? "rt" : "rs");
      }
    }
  });

  it("keeps the EARLIER created_at and never loses a waitlist promotion claim", () => {
    const out = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, createdAt: d("2026-09-05T00:00:00Z"), status: "registered" }),
      reg({
        id: "rs",
        playerId: S,
        createdAt: d("2026-09-02T00:00:00Z"),
        status: "waitlist",
        waitlistPromotionNotificationClaimedAt: d("2026-09-03T00:00:00Z"),
      }),
      { participated: false }
    );
    expect(out.createdAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(out.waitlistPromotionNotificationClaimedAt?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("duplicate no-show + real participation on the other account -> NO false no-show", () => {
    const out = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, status: "waitlist", noShowAt: d("2026-09-13T17:00:00Z") }),
      reg({ id: "rs", playerId: S, status: "registered" }),
      { participated: true }
    );
    expect(out.status).toBe("registered");
    expect(out.noShowAt).toBeNull();
  });

  it("participation clears no_show_at even when the canonical row stays on the waitlist", () => {
    const out = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, status: "waitlist", noShowAt: d("2026-09-13T17:00:00Z") }),
      reg({ id: "rs", playerId: S, status: "cancelled" }),
      { participated: true }
    );
    expect(out.status).toBe("waitlist");
    expect(out.noShowAt).toBeNull();
  });

  it("a seat-holding canonical row never carries a no-show mark", () => {
    const out = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, status: "registered" }),
      reg({ id: "rs", playerId: S, status: "waitlist", noShowAt: d("2026-09-13T17:00:00Z") }),
      { participated: false }
    );
    expect(out.noShowAt).toBeNull();
  });

  it("a real no-show (nobody arrived, canonical row off-seat) is kept -- earliest mark, never manufactured", () => {
    const kept = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, status: "waitlist", noShowAt: d("2026-09-13T18:00:00Z") }),
      reg({ id: "rs", playerId: S, status: "cancelled", noShowAt: d("2026-09-13T17:00:00Z") }),
      { participated: false }
    );
    expect(kept.noShowAt?.toISOString()).toBe("2026-09-13T17:00:00.000Z");

    const none = reconcileRegistrationPair(
      reg({ id: "rt", playerId: T, status: "waitlist" }),
      reg({ id: "rs", playerId: S, status: "cancelled" }),
      { participated: false }
    );
    expect(none.noShowAt).toBeNull();
  });
});

describe("reconcileAttendancePair", () => {
  it("arrived = OR, arrived_at = earliest real arrival, updated_at = latest", () => {
    const out = reconcileAttendancePair(
      { playerId: T, tournamentId: TOUR, arrived: true, arrivedAt: d("2026-09-13T16:05:00Z"), updatedAt: d("2026-09-13T16:05:00Z") },
      { playerId: S, tournamentId: TOUR, arrived: false, arrivedAt: d("2026-09-13T15:55:00Z"), updatedAt: d("2026-09-13T20:00:00Z") }
    );
    expect(out).toEqual({
      arrived: true,
      arrivedAt: d("2026-09-13T15:55:00Z"),
      updatedAt: d("2026-09-13T20:00:00Z"),
    });
  });

  it("null arrived_at never wins over a real timestamp; both null stays null", () => {
    const base = { tournamentId: TOUR, updatedAt: d("2026-09-13T16:00:00Z") };
    expect(
      reconcileAttendancePair(
        { ...base, playerId: T, arrived: false, arrivedAt: null },
        { ...base, playerId: S, arrived: true, arrivedAt: d("2026-09-13T16:10:00Z") }
      ).arrivedAt
    ).toEqual(d("2026-09-13T16:10:00Z"));
    expect(
      reconcileAttendancePair(
        { ...base, playerId: T, arrived: false, arrivedAt: null },
        { ...base, playerId: S, arrived: false, arrivedAt: null }
      )
    ).toMatchObject({ arrived: false, arrivedAt: null });
  });
});

describe("reconcileRebuyStatePair", () => {
  it("max, NOT sum (Total Entries convention: two copies of one person's state)", () => {
    const out = reconcileRebuyStatePair(
      { playerId: T, tournamentId: TOUR, rebuys: 2, addons: 0, updatedAt: d("2026-09-13T18:00:00Z") },
      { playerId: S, tournamentId: TOUR, rebuys: 1, addons: 1, updatedAt: d("2026-09-13T19:00:00Z") }
    );
    expect(out).toEqual({ rebuys: 2, addons: 1, updatedAt: d("2026-09-13T19:00:00Z") });
  });
});

describe("reconcileEliminationPair", () => {
  it("the later updated_at wins as a whole (eliminated + its eliminated_at); tie keeps target", () => {
    const target = { playerId: T, tournamentId: TOUR, eliminated: true, eliminatedAt: d("2026-09-13T19:00:00Z"), updatedAt: d("2026-09-13T19:00:00Z") };
    const source = { playerId: S, tournamentId: TOUR, eliminated: false, eliminatedAt: null, updatedAt: d("2026-09-13T19:30:00Z") };
    expect(reconcileEliminationPair(target, source)).toEqual({
      keep: "source",
      eliminated: false,
      eliminatedAt: null,
      updatedAt: d("2026-09-13T19:30:00Z"),
    });
    expect(reconcileEliminationPair(target, { ...source, updatedAt: target.updatedAt }).keep).toBe("target");
  });
});

describe("reconcileLiveEntryPair", () => {
  const t = live({ id: "lt", playerId: T, registrationId: "rt", arrived: false, rebuys: 2, addons: 0, knockouts: 1, bossKnockouts: 0, place: null, sheetRowNumber: 9 });
  const s = live({ id: "ls", playerId: S, registrationId: "rs", arrived: true, rebuys: 1, addons: 1, knockouts: 3, bossKnockouts: 1, place: 4, sheetRowNumber: 12, updatedAt: d("2026-09-13T21:00:00Z") });

  it("OR / max (never sum) / non-null place / canonical registration; keeps the row on the canonical registration", () => {
    const out = reconcileLiveEntryPair(t, s, { canonicalRegistrationId: "rs" });
    expect(out).toMatchObject({
      ok: true,
      keep: "source",
      keepId: "ls",
      deleteId: "lt",
      values: {
        registrationId: "rs",
        arrived: true,
        rebuys: 2,
        addons: 1,
        knockouts: 3,
        bossKnockouts: 1,
        place: 4,
        sheetRowNumber: 12,
        updatedAt: d("2026-09-13T21:00:00Z"),
      },
    });
  });

  it("two different non-null places are a conflict -- never guessed", () => {
    const out = reconcileLiveEntryPair({ ...t, place: 2 }, s, { canonicalRegistrationId: "rt" });
    expect(out).toEqual({ ok: false, conflict: "place_conflict", targetPlace: 2, sourcePlace: 4 });
  });

  it("an explicit result choice settles the place conflict for that side", () => {
    const out = reconcileLiveEntryPair({ ...t, place: 2 }, s, { canonicalRegistrationId: "rt", placePreference: "target" });
    expect(out.ok && out.values.place).toBe(2);
    expect(out.ok && out.keepId).toBe("lt");
  });
});

describe("planTournamentCollisions", () => {
  it("TOXIN shape: target registration+result+elimination, both attendance/rebuy -> only attendance/rebuy collapse, no conflicts", () => {
    const rows = emptyRows();
    rows.registrations.push(reg({ id: "rt", playerId: T, status: "attended" }));
    rows.results.push(result({ id: "res-t", playerId: T, place: 7, ratingPoints: 2, reentries: 2 }));
    rows.eliminations.push({ playerId: T, tournamentId: TOUR, eliminated: true, eliminatedAt: d("2026-09-13T20:00:00Z"), updatedAt: d("2026-09-13T20:00:00Z") });
    rows.attendance.push(
      { playerId: T, tournamentId: TOUR, arrived: true, arrivedAt: d("2026-09-13T16:10:00Z"), updatedAt: d("2026-09-13T16:10:00Z") },
      { playerId: S, tournamentId: TOUR, arrived: false, arrivedAt: d("2026-09-13T15:50:00Z"), updatedAt: d("2026-09-13T16:00:00Z") }
    );
    rows.rebuyStates.push(
      { playerId: T, tournamentId: TOUR, rebuys: 2, addons: 0, updatedAt: d("2026-09-13T18:00:00Z") },
      { playerId: S, tournamentId: TOUR, rebuys: 1, addons: 0, updatedAt: d("2026-09-13T17:00:00Z") }
    );

    const plan = planTournamentCollisions({ targetId: T, sourceId: S, tournamentIds: [TOUR], rows });

    expect(plan.resultConflicts).toEqual([]);
    expect(plan.livePlaceConflicts).toEqual([]);
    expect(plan.tournaments[0].collapsedTables).toEqual(["tournament_attendance", "tournament_rebuy_state"]);
    expect(plan.tournaments[0].registration).toBeNull();
    expect(plan.tournaments[0].elimination).toBeNull();
    expect(plan.tournaments[0].attendance).toEqual({
      arrived: true,
      arrivedAt: d("2026-09-13T15:50:00Z"),
      updatedAt: d("2026-09-13T16:10:00Z"),
    });
    expect(plan.tournaments[0].rebuyState).toMatchObject({ rebuys: 2, addons: 0 });
  });

  it("two result rows -> resultConflict (never auto-resolved)", () => {
    const rows = emptyRows();
    rows.results.push(result({ id: "a", playerId: T, place: 3 }), result({ id: "b", playerId: S, place: 5 }));
    const plan = planTournamentCollisions({ targetId: T, sourceId: S, tournamentIds: [TOUR], rows });
    expect(plan.resultConflicts).toHaveLength(1);
    expect(plan.resultConflicts[0].target.id).toBe("a");
    expect(plan.resultConflicts[0].source.id).toBe("b");
  });

  it("a single live entry on the deleted duplicate registration is rewired to the canonical one", () => {
    const rows = emptyRows();
    rows.registrations.push(
      reg({ id: "rt", playerId: T, status: "registered" }),
      reg({ id: "rs", playerId: S, status: "waitlist" })
    );
    rows.liveEntries.push(live({ id: "ls", playerId: S, registrationId: "rs" }));
    const plan = planTournamentCollisions({ targetId: T, sourceId: S, tournamentIds: [TOUR], rows });
    expect(plan.tournaments[0].registration?.keepId).toBe("rt");
    expect(plan.tournaments[0].liveEntryRewire).toEqual({ liveEntryId: "ls", registrationId: "rt" });
  });

  it("live place conflict blocks unless the same tournament has a result conflict (settled by the admin's choice)", () => {
    const rows = emptyRows();
    rows.registrations.push(reg({ id: "rt", playerId: T }), reg({ id: "rs", playerId: S }));
    rows.liveEntries.push(
      live({ id: "lt", playerId: T, registrationId: "rt", place: 2 }),
      live({ id: "ls", playerId: S, registrationId: "rs", place: 6 })
    );
    expect(planTournamentCollisions({ targetId: T, sourceId: S, tournamentIds: [TOUR], rows }).livePlaceConflicts).toEqual([
      { tournamentId: TOUR, targetPlace: 2, sourcePlace: 6 },
    ]);

    rows.results.push(result({ id: "a", playerId: T, place: 2 }), result({ id: "b", playerId: S, place: 6 }));
    const unresolved = planTournamentCollisions({ targetId: T, sourceId: S, tournamentIds: [TOUR], rows });
    expect(unresolved.livePlaceConflicts).toEqual([]);
    expect(unresolved.tournaments[0].liveEntry).toBeNull();

    const resolved = planTournamentCollisions({
      targetId: T,
      sourceId: S,
      tournamentIds: [TOUR],
      rows,
      resultResolutions: { [TOUR]: "source" },
    });
    expect(resolved.tournaments[0].liveEntry?.values.place).toBe(6);
  });
});

describe("checkResultResolutions", () => {
  const conflicts = [
    { tournamentId: "t1", target: result({ id: "a", playerId: T, place: 1, tournamentId: "t1" }), source: result({ id: "b", playerId: S, place: 2, tournamentId: "t1" }) },
  ];

  it("exactly the conflicts -> ok", () => {
    expect(checkResultResolutions(conflicts, { t1: "target" })).toEqual({ ok: true });
    expect(checkResultResolutions([], {})).toEqual({ ok: true });
  });

  it("missing choice -> missing; extra/forged key or bad value -> stale", () => {
    expect(checkResultResolutions(conflicts, {})).toEqual({ ok: false, reason: "missing", tournamentIds: ["t1"] });
    expect(checkResultResolutions(conflicts, { t1: "target", t2: "source" })).toEqual({
      ok: false,
      reason: "stale",
      tournamentIds: ["t2"],
    });
    expect(checkResultResolutions([], { t1: "target" })).toMatchObject({ ok: false, reason: "stale" });
    expect(checkResultResolutions(conflicts, { t1: "both" as never })).toMatchObject({ ok: false, reason: "stale" });
    expect(checkResultResolutions(conflicts, Object.create({ t1: "target" }))).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });
});

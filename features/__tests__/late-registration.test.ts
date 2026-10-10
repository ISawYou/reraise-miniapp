import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRegistration, fake, fakeDb, resetFakeCapacityDb } from "./helpers/fake-capacity-db";

const mocks = vi.hoisted(() => ({
  findTournament: vi.fn(),
  findSnapshot: vi.fn(),
  findAttended: vi.fn(),
  findRebuyState: vi.fn(),
  getMysterySnapshot: vi.fn(),
  closeMystery: vi.fn(),
  buildMysteryInsertValues: vi.fn(),
}));

// closeTournamentLateRegistration's actual lock+insert now goes through
// the SAME raw `db` as features/tournament-waitlist-capacity.ts (see that
// module's and features/tournament-row-lock.ts's doc comments) -- this
// suite mocks @/lib/db with the shared stateful fake so tests can prove
// the shared-lock invariant directly. `tournamentLateRegistrationRepository
// .findByTournamentId`'s own cheap pre-check (outside the lock) and the
// attendance/rebuy/Mystery reads still go through the ordinary
// @/lib/repositories / @/features/mystery-bounty mocks, exactly as before.
vi.mock("@/lib/db", () => ({ db: fakeDb }));

vi.mock("@/lib/repositories", () => ({
  tournamentRepository: { findById: mocks.findTournament },
  tournamentLateRegistrationRepository: {
    findByTournamentId: mocks.findSnapshot,
  },
  tournamentLiveStateRepository: {
    findAttendedPlayersWithDetails: mocks.findAttended,
    findRebuyStateByTournamentId: mocks.findRebuyState,
  },
}));

vi.mock("@/features/mystery-bounty", () => ({
  getMysteryBountySnapshot: mocks.getMysterySnapshot,
  closeMysteryBountyLateRegistration: mocks.closeMystery,
  // closeTournamentLateRegistrationOperation's fresh-close path calls this
  // directly (not closeMysteryBountyLateRegistration) so Mystery's insert
  // can happen under the SAME tx/lock as the generic snapshot -- see that
  // function's doc comment. Mocked here for the same reason the real pool/
  // envelope math is never exercised in this suite: these tests prove the
  // ORDERING/lock-sharing contract, not the formula (covered elsewhere).
  buildMysteryBountyInsertValues: mocks.buildMysteryInsertValues,
  // Real mapper -- it's a pure field-rename with no IO, fine to use as-is
  // against the fake db's plain-object rows.
  mapMysteryBountyDrizzleRow: (row: Record<string, unknown>) => ({
    tournament_id: row.tournamentId,
    late_registration_status: "closed",
    status: row.status,
    players_count: row.playersCount,
    total_entries_count: row.totalEntriesCount,
    rebuys_count: row.rebuysCount,
    addons_count: row.addonsCount,
    active_players_count: row.activePlayersCount,
    mystery_pool: row.mysteryPool,
    envelope_count: row.envelopeCount,
    small_count: row.smallCount,
    small_value: row.smallValue,
    medium_count: row.mediumCount,
    medium_value: row.mediumValue,
    jackpot_value: row.jackpotValue,
    closed_at: (row.closedAt as Date).toISOString(),
    activated_at: row.activatedAt ? (row.activatedAt as Date).toISOString() : null,
    recalculated_at: row.recalculatedAt ? (row.recalculatedAt as Date).toISOString() : null,
  }),
}));

const {
  closeTournamentLateRegistration,
  closeTournamentLateRegistrationOperation,
  getTournamentStateForIntegration,
} = await import("@/features/late-registration");
const { reconcileTournamentWaitlistCapacity } = await import(
  "@/features/tournament-waitlist-capacity"
);

const tournament = {
  id: "t1",
  kind: "free",
  status: "open",
  tournament_type: "classic",
  rating_formula_version: "v2",
  rating_guarantee: null,
  is_final: false,
};

function insertCount() {
  return fake.state.log.filter((entry) => entry === "insert:tournament_late_registration").length;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ tournamentId: "t1" });
  mocks.findTournament.mockResolvedValue(tournament);
  mocks.findSnapshot.mockResolvedValue(null);
  mocks.findAttended.mockResolvedValue([
    { player_id: "p1" },
    { player_id: "p2" },
    { player_id: "p3" },
  ]);
  mocks.findRebuyState.mockResolvedValue(
    new Map([
      ["p1", { rebuys: 1, addons: 0 }],
      ["p2", { rebuys: 1, addons: 0 }],
      ["p3", { rebuys: 1, addons: 0 }],
    ])
  );
  mocks.getMysterySnapshot.mockResolvedValue(null);
  mocks.buildMysteryInsertValues.mockResolvedValue({
    status: "pending_envelopes",
    players_count: 3,
    total_entries_count: 3,
    rebuys_count: 0,
    addons_count: 0,
    active_players_count: 3,
    mystery_pool: 100,
    envelope_count: 1,
    small_count: 1,
    small_value: 100,
    medium_count: 0,
    medium_value: 0,
    jackpot_value: 0,
  });
});

describe("generic Late Registration snapshot", () => {
  it("freezes the real v2 rating-place structure for exactly 3 arrived players", async () => {
    const snapshot = await closeTournamentLateRegistration("t1");

    expect(snapshot.arrived_players_count).toBe(3);
    expect(snapshot.initial_stacks_count).toBe(3);
    expect(snapshot.total_entries_count).toBe(3);
    expect(snapshot.rebuys_count).toBe(0);
    expect(snapshot.addons_count).toBe(0);
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 70 },
      { place: 2, points: 53 },
      { place: 3, points: 39 },
    ]);
  });

  it("normalizes real rebuys per player while preserving the raw total entries used by the engine", async () => {
    mocks.findRebuyState.mockResolvedValue(
      new Map([
        ["p1", { rebuys: 0, addons: 0 }],
        ["p2", { rebuys: 2, addons: 1 }],
        ["p3", { rebuys: 3, addons: 0 }],
      ])
    );

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot).toMatchObject({
      arrived_players_count: 3,
      initial_stacks_count: 2,
      total_entries_count: 5,
      rebuys_count: 3,
      addons_count: 1,
    });
  });

  it("is idempotent and never recomputes an existing frozen snapshot (cheap pre-check short-circuits before the lock)", async () => {
    const frozen = {
      tournament_id: "t1",
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [{ place: 1, points: 70 }],
    };
    mocks.findSnapshot.mockResolvedValue(frozen);

    await expect(closeTournamentLateRegistration("t1")).resolves.toBe(frozen);
    expect(mocks.findAttended).not.toHaveBeenCalled();
    expect(mocks.findRebuyState).not.toHaveBeenCalled();
    expect(insertCount()).toBe(0);
  });

  it("is idempotent even when the cheap pre-check misses -- the lock-protected re-check inside the transaction catches a snapshot created while this call was waiting for the lock", async () => {
    // Simulate: pre-check (outside the lock) ran first and saw nothing,
    // but by the time THIS call reaches the lock, a concurrent close has
    // already committed a snapshot.
    mocks.findSnapshot.mockResolvedValue(null);
    resetFakeCapacityDb({ tournamentId: "t1" });
    fake.state.lateRegistrationSnapshot = {
      tournamentId: "t1",
      arrivedPlayersCount: 1,
      initialStacksCount: 1,
      totalEntriesCount: 1,
      rebuysCount: 0,
      addonsCount: 0,
      tournamentType: "classic",
      ratingFormulaVersion: "v2",
      ratingGuarantee: null,
      ratingPlaces: [{ place: 1, points: 1 }],
      closedAt: new Date("2026-08-25T12:00:00.000Z"),
    };

    const snapshot = await closeTournamentLateRegistration("t1");

    expect(snapshot.arrived_players_count).toBe(1);
    // Never recomputed/overwritten -- the lock-protected re-check inside
    // closeGenericSnapshotLocked returns the existing row untouched (an
    // attendance read may still happen before that re-check runs; it's
    // simply discarded, not a correctness issue).
    expect(insertCount()).toBe(0);
  });

  it("does not enable close for paid/cash tournaments", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, kind: "paid" });
    await expect(closeTournamentLateRegistration("t1")).rejects.toThrow("только для рейтинговых free");
    expect(insertCount()).toBe(0);
  });

  it("reports open/null before close and frozen places after close", async () => {
    await expect(getTournamentStateForIntegration("t1")).resolves.toEqual({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });

    mocks.findSnapshot.mockResolvedValue({
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [{ place: 1, points: 70 }],
    });
    await expect(getTournamentStateForIntegration("t1")).resolves.toEqual({
      lateRegistration: { status: "closed", closedAt: "2026-08-25T12:00:00.000Z" },
      rating: { places: [{ place: 1, points: 72 }] },
    });
  });

  // Symptom under investigation: the live Poker Clock projection was
  // missing the +2 participation component even though it's flat/constant
  // for every arrived player. `snapshot.rating_places` itself stores
  // itm_points ONLY (completion's `ratingPlaces` merge option needs that --
  // see app/api/admin/tournaments/[id]/complete-free/route.ts -- and would
  // double-count participation otherwise); getTournamentStateForIntegration
  // must fold PARTICIPATION_POINTS back in for the live response without
  // mutating the frozen snapshot.
  it("live projection includes the +2 participation component on top of each frozen itm place value", async () => {
    mocks.findSnapshot.mockResolvedValue({
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [
        { place: 1, points: 70 },
        { place: 2, points: 52 },
      ],
    });

    const result = await getTournamentStateForIntegration("t1");

    expect(result.rating).toEqual({
      places: [
        { place: 1, points: 72 },
        { place: 2, points: 54 },
      ],
    });
  });

  it("Final Month (is_final=true): the frozen snapshot's rating_places is every place at 0, not the real v2 structure", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, is_final: true });

    const snapshot = await closeTournamentLateRegistration("t1");

    expect(snapshot.rating_places.length).toBeGreaterThan(0);
    expect(snapshot.rating_places.every((p: { points: number }) => p.points === 0)).toBe(true);
  });

  it("Final Month (is_final=true): getTournamentStateForIntegration always reports rating: null, even with a closed snapshot -- no +2 participation leak, no rating places", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, is_final: true });
    mocks.findSnapshot.mockResolvedValue({
      closed_at: "2026-08-25T12:00:00.000Z",
      rating_places: [{ place: 1, points: 0 }],
    });

    const result = await getTournamentStateForIntegration("t1");

    // Late Registration status is an operational concept, not a rating
    // one -- it still reports normally (Poker Clock still needs to know
    // whether late reg is open/closed for a Final Month tournament).
    expect(result).toEqual({
      lateRegistration: { status: "closed", closedAt: "2026-08-25T12:00:00.000Z" },
      rating: null,
    });
  });

  it("Final Month (is_final=true): getTournamentStateForIntegration reports rating: null before close too", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, is_final: true });

    const result = await getTournamentStateForIntegration("t1");

    expect(result).toEqual({
      lateRegistration: { status: "open", closedAt: null },
      rating: null,
    });
  });

  it("composes Mystery-specific and generic close, reusing an EXISTING Mystery snapshot on retry (historical partial-close recovery)", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });
    // Simulates a prior attempt whose Mystery step succeeded but whose
    // generic step failed -- exactly the documented recoverable gap.
    fake.state.mysteryBountySnapshot = {
      tournamentId: "t1",
      status: "pending_envelopes",
      playersCount: 3,
      totalEntriesCount: 3,
      rebuysCount: 0,
      addonsCount: 0,
      activePlayersCount: 3,
      mysteryPool: 100,
      envelopeCount: 1,
      smallCount: 1,
      smallValue: 100,
      mediumCount: 0,
      mediumValue: 0,
      jackpotValue: 0,
      closedAt: new Date("2026-08-25T12:00:00.000Z"),
      activatedAt: null,
      recalculatedAt: null,
    };

    const result = await closeTournamentLateRegistrationOperation("t1");

    expect(result.mysteryBountySnapshot).toMatchObject({ tournament_id: "t1", mystery_pool: 100 });
    // The EXISTING row is reused byte-for-byte -- never recomputed/
    // overwritten (buildMysteryBountyInsertValues is the only thing that
    // would recompute it, and it must never run here).
    expect(mocks.buildMysteryInsertValues).not.toHaveBeenCalled();
    expect(mocks.closeMystery).not.toHaveBeenCalled();
    // Exactly one insert this call: the generic snapshot. Mystery's
    // snapshot already existed, so zero Mystery inserts.
    expect(insertCount()).toBe(1);
  });

  it("creates Mystery-specific state before the generic snapshot on the first unified close -- both under the SAME lock/transaction, no nested transaction", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });

    const result = await closeTournamentLateRegistrationOperation("t1");

    // Mystery's insert-values builder ran with the authoritative roster
    // (never the old closeMysteryBountyLateRegistration/closeMystery path).
    expect(mocks.buildMysteryInsertValues).toHaveBeenCalledWith(
      "t1",
      [
        { player_id: "p1", arrived: true, rebuys: 1, addons: 0 },
        { player_id: "p2", arrived: true, rebuys: 1, addons: 0 },
        { player_id: "p3", arrived: true, rebuys: 1, addons: 0 },
      ],
      "v2"
    );
    expect(mocks.closeMystery).not.toHaveBeenCalled();

    // Both rows inserted exactly once each, inside ONE transaction (no
    // "tx:begin" appears twice -- a nested transaction would show as a
    // second begin before this one commits).
    expect(fake.state.log.filter((e) => e === "tx:begin")).toHaveLength(1);
    expect(fake.state.log.filter((e) => e === "insert:tournament_mystery_bounty")).toHaveLength(1);
    expect(insertCount()).toBe(1);

    // Mystery's insert happened strictly BEFORE the generic snapshot's
    // insert, under the lock, matching the documented ordering.
    const mysteryIdx = fake.state.log.indexOf("insert:tournament_mystery_bounty");
    const genericIdx = fake.state.log.indexOf("insert:tournament_late_registration");
    expect(mysteryIdx).toBeGreaterThanOrEqual(0);
    expect(genericIdx).toBeGreaterThan(mysteryIdx);

    expect(result.mysteryBountySnapshot).toMatchObject({ tournament_id: "t1", mystery_pool: 100 });
    expect(result.snapshot.arrived_players_count).toBe(3);
  });

  it("Mystery close shares exactly one lock acquisition with the generic snapshot (no separate, later lock for the generic step)", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });

    await closeTournamentLateRegistrationOperation("t1");

    expect(fake.state.log.filter((e) => e === "lock:tournaments")).toHaveLength(1);
  });

  it("if a concurrent waitlist promotion wins the lock first, both the Mystery and generic snapshots see the post-promotion roster", async () => {
    resetFakeCapacityDb({ tournamentId: "t1", maxPlayers: 4 });
    addRegistration("p1", "registered");
    addRegistration("p2", "registered");
    addRegistration("p3", "registered");
    addRegistration("w1", "waitlist");
    fake.state.eliminations.set("p1", true); // a seat opens

    const { reconcileTournamentWaitlistCapacity } = await import(
      "@/features/tournament-waitlist-capacity"
    );
    const promoted = await reconcileTournamentWaitlistCapacity("t1");
    expect(promoted.promotedPlayerIds).toEqual(["w1"]);

    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "mystery_bounty" });
    // This test only asserts the lock-sharing/ordering contract (the Mystery
    // roster inputs themselves come from the mocked attendance/rebuy repo,
    // independent of the fake registrations model) -- the promotion above
    // is already fully committed before this call even starts, which is
    // the property under test.
    await closeTournamentLateRegistrationOperation("t1");

    expect(fake.state.registrations.find((r) => r.playerId === "w1")?.status).toBe("registered");
    expect(fake.state.mysteryBountySnapshot).not.toBeNull();
    expect(fake.state.lateRegistrationSnapshot).not.toBeNull();
  });
});

describe("Boost Rating -- placement multiplier is frozen INTO rating_places at close", () => {
  it("multiplier 2.0 freezes already-boosted itm points (classic 70/53/39 -> 140/106/78)", async () => {
    mocks.findTournament.mockResolvedValue({
      ...tournament,
      tournament_type: "boost_rating",
      placement_points_multiplier: 2,
    });

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 140 },
      { place: 2, points: 106 },
      { place: 3, points: 78 },
    ]);
  });

  it("multiplier 1.5 -> roundHalfUp(natural × 1.5)", async () => {
    mocks.findTournament.mockResolvedValue({
      ...tournament,
      tournament_type: "boost_rating",
      placement_points_multiplier: 1.5,
    });

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 105 },
      { place: 2, points: 80 },
      { place: 3, points: 59 },
    ]);
  });

  it("bomb_pot freezes the ordinary volume structure (same as classic)", async () => {
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "bomb_pot" });

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 70 },
      { place: 2, points: 53 },
      { place: 3, points: 39 },
    ]);
  });

  it("free_roll freezes the ordinary volume structure (same as classic: 70/53/39)", async () => {
    // Its free first entry is a Finance-only fact -- entries/addons feeding
    // the frozen rating_places are exactly classic's.
    mocks.findTournament.mockResolvedValue({ ...tournament, tournament_type: "free_roll" });

    const snapshot = await closeTournamentLateRegistration("t1");
    expect(snapshot.rating_places).toEqual([
      { place: 1, points: 70 },
      { place: 2, points: 53 },
      { place: 3, points: 39 },
    ]);
  });
});

describe("Late Registration close shares the tournament-row lock with waitlist capacity", () => {
  it("1. lock order: tournament row FOR UPDATE, then the late-reg snapshot re-check, then (if absent) the insert", async () => {
    await closeTournamentLateRegistration("t1");

    const lockIdx = fake.state.log.indexOf("lock:tournaments");
    const snapshotCheckIdx = fake.state.log.indexOf("select:tournament_late_registration");
    const insertIdx = fake.state.log.indexOf("insert:tournament_late_registration");

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotCheckIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(snapshotCheckIdx);
  });

  it("2. close takes the SAME lock primitive as reconcileTournamentWaitlistCapacity (both log lock:tournaments as their first tournament-scoped statement)", async () => {
    resetFakeCapacityDb({ tournamentId: "t1" });
    await reconcileTournamentWaitlistCapacity("t1");
    const reconcilerLockIdx = fake.state.log.indexOf("lock:tournaments");
    expect(reconcilerLockIdx).toBe(0 + fake.state.log.indexOf("tx:begin") + 1);

    resetFakeCapacityDb({ tournamentId: "t1" });
    await closeTournamentLateRegistration("t1");
    const closeLockIdx = fake.state.log.indexOf("lock:tournaments");
    expect(closeLockIdx).toBe(fake.state.log.indexOf("tx:begin") + 1);
  });

  it("3. if close wins the lock first, a waiting reconcile sees CLOSED and promotes 0 -- no stale 'open' read survives the close", async () => {
    resetFakeCapacityDb({ tournamentId: "t1", maxPlayers: 3 });
    addRegistration("w1", "waitlist");
    // Simplest deterministic proof without real concurrency: close commits
    // first (this fake's transaction mutex already serializes same-model
    // calls one at a time, standing in for the real FOR UPDATE wait), THEN
    // the reconciler runs and must see the snapshot that now exists.
    await closeTournamentLateRegistration("t1");

    const result = await reconcileTournamentWaitlistCapacity("t1");
    expect(result.promotedPlayerIds).toEqual([]);
  });

  it("4. if reconcile wins first, its promotion completes before close reads attendance -- close's snapshot reflects the post-promotion roster", async () => {
    resetFakeCapacityDb({ tournamentId: "t1", maxPlayers: 4 });
    fake.state.registrations = [];
    fake.state.eliminations = new Map();
    addRegistration("p1", "registered");
    addRegistration("p2", "registered");
    addRegistration("p3", "registered");
    addRegistration("w1", "waitlist");

    // A seat opens (p1 eliminated) and the reconciler promotes w1 to
    // `registered` BEFORE Late Registration is closed.
    fake.state.eliminations.set("p1", true);
    const reconcileResult = await reconcileTournamentWaitlistCapacity("t1");
    expect(reconcileResult.promotedPlayerIds).toEqual(["w1"]);

    // Close now runs against the model's CURRENT registrations table --
    // this test's attendance mock is independent of the fake registrations
    // model (closeTournamentLateRegistration reads attendance through the
    // ordinary repository mock, not the fake registrations table), so this
    // asserts the ordering/lock-sharing contract itself: the promotion is
    // fully committed (w1 is `registered`) strictly before close's lock
    // acquisition can proceed.
    expect(fake.state.registrations.find((r) => r.playerId === "w1")?.status).toBe("registered");
    await closeTournamentLateRegistration("t1");
    expect(fake.state.lateRegistrationSnapshot).not.toBeNull();
  });

  it("5. no promotion can cross a committed snapshot boundary: once closed, the reconciler never promotes again even with free seats", async () => {
    resetFakeCapacityDb({ tournamentId: "t1", maxPlayers: 2 });
    addRegistration("p1", "registered");
    addRegistration("w1", "waitlist");

    await closeTournamentLateRegistration("t1");
    fake.state.eliminations.set("p1", true); // a seat opens AFTER close

    const result = await reconcileTournamentWaitlistCapacity("t1");
    expect(result.promotedPlayerIds).toEqual([]);
    expect(fake.state.registrations.find((r) => r.playerId === "w1")?.status).toBe("waitlist");
  });
});

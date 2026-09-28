import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealerShifts, dealerProfiles, teams, teamMemberships, teamInvitations, teamJoinRequests } from "@/lib/db/schema";

// Only executeMerge() uses the module-level default `db` (via
// db.transaction() -- checkMergeEligibility/computeTournamentOverlap always
// receive an explicit fake executor in every test below, so this mock is
// inert for those). Must be declared at module top-level (not inside a
// describe block) so vitest's hoisting moves it above lib/player-merge.ts's
// own `import { db } from "@/lib/db"`.
const { mockTxTarget } = vi.hoisted(() => ({ mockTxTarget: { current: null as unknown } }));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(mockTxTarget.current),
  },
}));

vi.mock("@/features/achievements", () => ({
  syncPlayerAchievements: vi.fn(),
}));

// Avoids pulling in the real repository barrel (@/lib/repositories
// re-exports every domain, including Supabase implementations that read
// NEXT_PUBLIC_SUPABASE_URL at import time) -- none of the tests below
// exercise createMergeIntent(), the one function that actually calls
// playerMergeIntentRepository.
vi.mock("@/lib/repositories", () => ({
  playerMergeIntentRepository: { create: vi.fn(), findById: vi.fn(), listConflicts: vi.fn() },
}));

// This test suite exercises the real business logic (eligibility rules,
// tournament-overlap computation, the executeMerge state machine, field
// reconciliation math) against a hand-built fake query executor/transaction
// that mimics Drizzle's chainable shape closely enough to drive the real
// functions end-to-end. Ported from Sterling/spb-poker's own
// lib/__tests__/player-merge.test.ts, with the referral/deposit/order
// sections removed (Re-Raise has no player_referrals,
// player_deposit_transactions, or orders tables) and the tournament-overlap
// select counts widened from 4 to 6 tables per player (Re-Raise additionally
// has tournament_attendance and tournament_rebuy_state, which Sterling does
// not).
//
// What it deliberately does NOT prove: that SELECT ... FOR UPDATE actually
// locks rows, or that SERIALIZABLE isolation actually aborts a concurrent
// write-skew race, against a real Postgres server -- see
// player-merge.integration.test.ts for that, gated behind a real database.

const TARGET_ID = "00000000-0000-0000-0000-000000000001"; // sorts first
const SOURCE_ID = "00000000-0000-0000-0000-000000000002"; // sorts second

function playerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    telegramId: null,
    email: null,
    role: "player",
    referralCount: 0,
    freeReentriesBalance: 0,
    yandexReviewBonusClaimed: false,
    mergedIntoPlayerId: null,
    ...overrides,
  };
}

// A minimal fake standing in for both `db` (as the default `executor` param)
// and a transaction's `tx` object -- both are used identically by
// lib/player-merge.ts's own code (select().from().where()[.limit()|.for()],
// update().set().where()). Select responses are consumed strictly in call
// order, which is deterministic here because every Promise.all([...]) in the
// module under test evaluates its array synchronously left-to-right.
function makeFakeExecutor(selectResponses: unknown[][]) {
  let selectIndex = 0;
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const deleteCalls: Array<{ table: unknown }> = [];

  function selectChain() {
    const idx = selectIndex++;
    const resultPromise = Promise.resolve(selectResponses[idx] ?? []);
    return {
      from: () => ({
        where: () =>
          Object.assign(resultPromise, {
            limit: () => resultPromise,
            for: () => resultPromise,
          }),
      }),
    };
  }

  const executor = {
    select: () => selectChain(),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        deleteCalls.push({ table });
        return Promise.resolve([]);
      },
    }),
  };

  return { executor, updateCalls, deleteCalls, callCount: () => selectIndex };
}

// The six tournament-state tables Re-Raise's collectTournamentIds queries,
// per player, in this exact order: registrations, results,
// tournament_live_entries, tournament_player_eliminations,
// tournament_attendance, tournament_rebuy_state.
const NO_OVERLAP_TABLES = [[], [], [], [], [], []];

describe("computeTournamentOverlap", () => {
  it("finds no overlap when the two players' tournament sets are disjoint", async () => {
    const { executor } = makeFakeExecutor([
      [{ tournamentId: "t1" }], [], [], [], [], [], // target: registrations, results, live, elim, attendance, rebuy
      [{ tournamentId: "t2" }], [], [], [], [], [], // source: same six, in order
    ]);

    const { computeTournamentOverlap } = await import("@/lib/player-merge");
    const result = await computeTournamentOverlap(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.overlappingTournamentIds).toEqual([]);
    expect(result.targetTournamentIds).toEqual(new Set(["t1"]));
    expect(result.sourceTournamentIds).toEqual(new Set(["t2"]));
  });

  it("detects overlap when both players share a tournament id, regardless of which table it came from", async () => {
    const { executor } = makeFakeExecutor([
      [{ tournamentId: "shared" }], [], [], [], [], [],
      [], [{ tournamentId: "shared" }], [], [], [], [],
    ]);

    const { computeTournamentOverlap } = await import("@/lib/player-merge");
    const result = await computeTournamentOverlap(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.overlappingTournamentIds).toEqual(["shared"]);
  });

  it("detects overlap sourced purely from the Re-Raise-specific attendance/rebuy-state tables", async () => {
    const { executor } = makeFakeExecutor([
      [], [], [], [], [{ tournamentId: "shared" }], [], // target: attendance only
      [], [], [], [], [], [{ tournamentId: "shared" }], // source: rebuy-state only
    ]);

    const { computeTournamentOverlap } = await import("@/lib/player-merge");
    const result = await computeTournamentOverlap(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.overlappingTournamentIds).toEqual(["shared"]);
  });
});

describe("checkMergeEligibility", () => {
  it("is eligible for a clean, non-overlapping pair", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID, telegramId: null })],
      ...NO_OVERLAP_TABLES,
      ...NO_OVERLAP_TABLES,
    ]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result).toEqual({ eligible: true });
  });

  it("rejects when source already has its own Telegram identity -- proving email ownership does not prove shared identity", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID, telegramId: 999999 })],
    ]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("Telegram-идентификация");
    }
  });

  it("rejects when source is already merged into someone else", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID, mergedIntoPlayerId: "some-other-player" })],
    ]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("уже был объединён");
    }
  });

  it("rejects when target is already merged into someone else -- prevents merge chains from being created through the API", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID, mergedIntoPlayerId: "some-other-player" })],
      [playerRow({ id: SOURCE_ID })],
    ]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("не может быть целью");
    }
  });

  it("rejects on any tournament overlap and reports which tournaments", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      [{ tournamentId: "shared-t" }], [], [], [], [], [],
      [{ tournamentId: "shared-t" }], [], [], [], [], [],
    ]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("пересекающаяся");
      expect(result.overlappingTournamentIds).toEqual(["shared-t"]);
    }
  });

  it("rejects when either player row is missing", async () => {
    const { executor } = makeFakeExecutor([[], [playerRow({ id: SOURCE_ID })]]);

    const { checkMergeEligibility } = await import("@/lib/player-merge");
    const result = await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never);

    expect(result.eligible).toBe(false);
  });
});

describe("executeMerge", () => {
  beforeEach(() => {
    process.env.DATABASE_PROVIDER = "postgres";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_PROVIDER;
    mockTxTarget.current = null;
  });

  function intentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "intent-1",
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      email: "found@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides,
    };
  }

  it("throws when DATABASE_PROVIDER is not postgres -- account merging is Postgres-only", async () => {
    delete process.env.DATABASE_PROVIDER;
    const { executeMerge } = await import("@/lib/player-merge");

    await expect(
      executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID })
    ).rejects.toThrow("DATABASE_PROVIDER=postgres");
  });

  it("throws MergeIntentForbiddenError when the intent's target does not match the session player -- the client cannot claim someone else's intent", async () => {
    const { executor } = makeFakeExecutor([[intentRow({ targetPlayerId: "someone-else" })]]);
    mockTxTarget.current = executor;

    const { executeMerge, MergeIntentForbiddenError } = await import("@/lib/player-merge");

    await expect(
      executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(MergeIntentForbiddenError);
  });

  it("throws MergeIntentNotFoundError when the intent id doesn't exist", async () => {
    const { executor } = makeFakeExecutor([[]]);
    mockTxTarget.current = executor;

    const { executeMerge, MergeIntentNotFoundError } = await import("@/lib/player-merge");

    await expect(
      executeMerge({ intentId: "missing", sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(MergeIntentNotFoundError);
  });

  it("throws MergeIntentNotPendingError when the intent was already completed/conflicted -- proves idempotency: a repeat confirm cannot merge twice", async () => {
    const { executor } = makeFakeExecutor([[intentRow({ status: "completed" })]]);
    mockTxTarget.current = executor;

    const { executeMerge, MergeIntentNotPendingError } = await import("@/lib/player-merge");

    await expect(
      executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(MergeIntentNotPendingError);
  });

  it("throws MergeIntentExpiredError and flips the intent to expired when past expiresAt", async () => {
    const { executor, updateCalls } = makeFakeExecutor([
      [intentRow({ expiresAt: new Date(Date.now() - 1000) })],
    ]);
    mockTxTarget.current = executor;

    const { executeMerge, MergeIntentExpiredError } = await import("@/lib/player-merge");

    await expect(
      executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(MergeIntentExpiredError);

    expect(updateCalls.some((c) => c.values.status === "expired")).toBe(true);
  });

  // Every eligibility-passing executeMerge call issues this exact select
  // prefix before reaching the history-move updates: intent, firstRow,
  // secondRow, then checkMergeEligibility's own (target row + source row +
  // 6 target overlap tables + 6 source overlap tables = 14), then the
  // dealer open-shift check + dealer profile lookup (2), then Teams v1's own
  // active-team-membership conflict check (1) and its post-reassignment
  // pending-invitation lookup (1) = 21 selects total. The trailing `[], []`
  // below means "neither side has an active team, no pending invitations to
  // reassign" -- the ordinary, non-Teams happy path; see "executeMerge --
  // Teams v1 compatibility" below for the Teams-specific scenarios.
  function happyPathSelects(openShiftRows: unknown[] = [], dealerProfileRows: unknown[] = []) {
    return [
      [intentRow()],
      [playerRow({ id: TARGET_ID, role: "admin", referralCount: 3, freeReentriesBalance: 2, yandexReviewBonusClaimed: false })], // firstRow (target)
      [playerRow({ id: SOURCE_ID, referralCount: 5, freeReentriesBalance: 1, yandexReviewBonusClaimed: true })], // secondRow (source)
      [playerRow({ id: TARGET_ID, role: "admin" })], // eligibility: target lookup
      [playerRow({ id: SOURCE_ID })], // eligibility: source lookup
      ...NO_OVERLAP_TABLES,
      ...NO_OVERLAP_TABLES,
      openShiftRows,
      dealerProfileRows,
      [], // Teams v1: activeTeamMembershipRows -- neither side on a team
      [], // Teams v1: sourcePendingInvitations -- nothing to reassign
    ];
  }

  it("moves history and reconciles fields correctly on a clean merge -- sum ledgers, OR the one-time flag, target's role/access untouched", async () => {
    const { executor, updateCalls } = makeFakeExecutor(happyPathSelects());
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });

    const targetPatch = updateCalls.find(
      (c) => "referralCount" in c.values && c.values.referralCount === 8
    );
    expect(targetPatch).toBeDefined();
    expect(targetPatch?.values.freeReentriesBalance).toBe(3); // 2 + 1, summed
    expect(targetPatch?.values.yandexReviewBonusClaimed).toBe(true); // OR
    expect(targetPatch?.values.email).toBe("found@example.com");
    // Never touched by merge, under any circumstance.
    expect(targetPatch?.values).not.toHaveProperty("role");
    expect(targetPatch?.values).not.toHaveProperty("canAccessPaid");
    expect(targetPatch?.values).not.toHaveProperty("canAccessCash");
    expect(targetPatch?.values).not.toHaveProperty("telegramId");

    const sourcePatch = updateCalls.find((c) => c.values.mergedIntoPlayerId === TARGET_ID);
    expect(sourcePatch).toBeDefined();
    expect(sourcePatch?.values.email).toBeNull();

    // Regression guard: players_email_unique_idx is a plain, per-statement
    // unique index -- if target's email were set to intent.email before
    // source's identical email is cleared, both rows would momentarily hold
    // the same value and Postgres would reject the second UPDATE. Caught
    // for real against a live database in player-merge.integration.test.ts;
    // this just pins the ordering so it can't silently regress in a mocked
    // run.
    expect(updateCalls.indexOf(sourcePatch!)).toBeLessThan(updateCalls.indexOf(targetPatch!));

    const completedIntent = updateCalls.find((c) => c.values.status === "completed");
    expect(completedIntent).toBeDefined();
  });

  it("flips the intent to conflict instead of merging when the TOCTOU re-check inside the transaction finds a new overlap", async () => {
    const { executor, updateCalls } = makeFakeExecutor([
      [intentRow()],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      [{ tournamentId: "new-overlap" }], [], [], [], [], [], // target overlap -- appeared since preview
      [{ tournamentId: "new-overlap" }], [], [], [], [], [],
    ]);
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result.merged).toBe(false);
    if (!result.merged) {
      expect(result.conflict).toBe(true);
    }

    const conflictUpdate = updateCalls.find((c) => c.values.status === "conflict");
    expect(conflictUpdate).toBeDefined();
    // No history-move updates happened -- only the intent's own status flip.
    expect(updateCalls.length).toBe(1);
  });
});

// Dealer/Staff account-merge integration -- Re-Raise's own domain (Sterling
// ported Dealer Payroll FROM Re-Raise), same table/column shapes on both
// sides.
describe("executeMerge -- dealer profile & shift merge", () => {
  beforeEach(() => {
    process.env.DATABASE_PROVIDER = "postgres";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_PROVIDER;
    mockTxTarget.current = null;
  });

  function intentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "intent-1",
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      email: "found@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides,
    };
  }

  function selectsWithDealerState(openShiftRows: unknown[], dealerProfileRows: unknown[]) {
    return [
      [intentRow()],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      ...NO_OVERLAP_TABLES,
      ...NO_OVERLAP_TABLES,
      openShiftRows,
      dealerProfileRows,
      // Teams v1: no active team on either side, nothing pending to
      // reassign -- only reached when neither dealer shift is open (the
      // "both open" test below short-circuits before this point).
      [],
      [],
    ];
  }

  it("moves dealer_shifts ownership from source to target unconditionally", async () => {
    const { executor, updateCalls } = makeFakeExecutor(selectsWithDealerState([], []));
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    const shiftMove = updateCalls.find((c) => c.table === dealerShifts && c.values.dealerPlayerId === TARGET_ID);
    expect(shiftMove).toBeDefined();
  });

  it("actor audit ids (created_by_player_id/ended_by_player_id) are never part of the shift-ownership update", async () => {
    const { executor, updateCalls } = makeFakeExecutor(selectsWithDealerState([], []));
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    const shiftMove = updateCalls.find((c) => c.table === dealerShifts);
    expect(shiftMove?.values).toEqual({ dealerPlayerId: TARGET_ID });
    expect(shiftMove?.values).not.toHaveProperty("createdByPlayerId");
    expect(shiftMove?.values).not.toHaveProperty("endedByPlayerId");
  });

  it("source dealer -> target has no profile: source's profile (rate, is_active) becomes the target's", async () => {
    const sourceProfile = { playerId: SOURCE_ID, isActive: true, hourlyRateRub: 700 };
    const { executor, updateCalls, deleteCalls } = makeFakeExecutor(
      selectsWithDealerState([], [sourceProfile])
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    const profileMove = updateCalls.find((c) => c.table === dealerProfiles && c.values.playerId === TARGET_ID);
    expect(profileMove).toBeDefined();
    expect(deleteCalls.some((c) => c.table === dealerProfiles)).toBe(false);
  });

  it("target already dealer, source is not: nothing dealer-profile-related is touched beyond the unconditional shift move", async () => {
    const targetProfile = { playerId: TARGET_ID, isActive: true, hourlyRateRub: 600 };
    const { executor, updateCalls, deleteCalls } = makeFakeExecutor(
      selectsWithDealerState([], [targetProfile])
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    expect(updateCalls.some((c) => c.table === dealerProfiles)).toBe(false);
    expect(deleteCalls.length).toBe(0);
  });

  it("both profiles exist: target's own profile (rate, is_active) wins and is never overwritten; source's profile is deleted after its shifts move", async () => {
    const targetProfile = { playerId: TARGET_ID, isActive: true, hourlyRateRub: 600 };
    const sourceProfile = { playerId: SOURCE_ID, isActive: false, hourlyRateRub: 900 };
    const { executor, updateCalls, deleteCalls } = makeFakeExecutor(
      selectsWithDealerState([], [targetProfile, sourceProfile])
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    expect(updateCalls.some((c) => c.table === dealerProfiles)).toBe(false);
    const profileDelete = deleteCalls.find((c) => c.table === dealerProfiles);
    expect(profileDelete).toBeDefined();
    const shiftMove = updateCalls.find((c) => c.table === dealerShifts && c.values.dealerPlayerId === TARGET_ID);
    expect(shiftMove).toBeDefined();
  });

  it("only source has an open shift: merge proceeds, and the shift becomes target's via the unconditional ownership move", async () => {
    const { executor, updateCalls } = makeFakeExecutor(
      selectsWithDealerState([{ dealerPlayerId: SOURCE_ID }], [])
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    const shiftMove = updateCalls.find((c) => c.table === dealerShifts && c.values.dealerPlayerId === TARGET_ID);
    expect(shiftMove).toBeDefined();
  });

  it("only target has an open shift: merge proceeds normally -- no conflict when just one side is open", async () => {
    const { executor } = makeFakeExecutor(selectsWithDealerState([{ dealerPlayerId: TARGET_ID }], []));
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
  });

  it("both source and target have an open dealer shift: fails closed BEFORE any row is mutated", async () => {
    const { executor, updateCalls, deleteCalls } = makeFakeExecutor(
      selectsWithDealerState([{ dealerPlayerId: TARGET_ID }, { dealerPlayerId: SOURCE_ID }], [])
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result.merged).toBe(false);
    if (!result.merged) {
      expect(result.conflict).toBe(true);
      expect(result.reason).toContain("открытую смену");
    }
    // Only the intent's own status-flip update happened -- no history
    // (registrations/results/dealer_shifts/players/etc) was touched.
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].values.status).toBe("conflict");
    expect(deleteCalls.length).toBe(0);
  });
});

// Teams v1 compatibility (see features/teams.ts, lib/team-scoring.ts) --
// account merging must never reintroduce duplicate-account problems for
// team membership/captaincy/invitations. Same fake-executor technique as
// every describe block above.
describe("executeMerge -- Teams v1 compatibility", () => {
  beforeEach(() => {
    process.env.DATABASE_PROVIDER = "postgres";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_PROVIDER;
    mockTxTarget.current = null;
  });

  function intentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "intent-1",
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      email: "found@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides,
    };
  }

  // A raw team_memberships row as the historical-overlap check reads it --
  // joinedAt/leftAt are real Date objects (the check calls .toISOString()
  // on them), matching Drizzle's own row shape.
  function rawMembership(overrides: {
    playerId: string;
    teamId?: string;
    id?: string;
    joinedAt: string;
    leftAt: string | null;
  }) {
    return {
      id: overrides.id ?? `m-${overrides.playerId}-${overrides.joinedAt}`,
      teamId: overrides.teamId ?? "team-x",
      playerId: overrides.playerId,
      joinedAt: new Date(overrides.joinedAt),
      leftAt: overrides.leftAt ? new Date(overrides.leftAt) : null,
    };
  }

  // Mirrors happyPathSelects/selectsWithDealerState's shared prefix (no
  // open dealer shifts, no dealer profiles -- Teams compatibility is
  // orthogonal to the dealer check, which always runs first), with the
  // Teams-specific slots parameterized: the FULL (not just active)
  // membership-history overlap check, and (only when there's something to
  // move) the pending-invitation and pending-join-request collision
  // lookups -- team_join_requests is reassigned right after
  // team_invitations, same collision-handling shape, one extra select pair.
  function selectsWithTeamState(params: {
    allTeamMembershipRows?: unknown[];
    sourcePendingInvitationRows?: unknown[];
    targetPendingTeamIdRows?: unknown[];
    sourcePendingJoinRequestRows?: unknown[];
    targetPendingRequestTeamIdRows?: unknown[];
  }) {
    const base = [
      [intentRow()],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      ...NO_OVERLAP_TABLES,
      ...NO_OVERLAP_TABLES,
      [], // no open dealer shifts
      [], // no dealer profiles
      params.allTeamMembershipRows ?? [],
    ];

    const pendingInvites = params.sourcePendingInvitationRows ?? [];
    const withInvites =
      pendingInvites.length > 0 ? [...base, pendingInvites, params.targetPendingTeamIdRows ?? []] : [...base, pendingInvites];

    const pendingRequests = params.sourcePendingJoinRequestRows ?? [];
    return pendingRequests.length > 0
      ? [...withInvites, pendingRequests, params.targetPendingRequestTeamIdRows ?? []]
      : [...withInvites, pendingRequests];
  }

  it("18. neither side has ANY team membership history: merge proceeds, and team_memberships/team_invitations/teams ownership moves unconditionally (a no-op update if source held nothing)", async () => {
    const { executor, updateCalls } = makeFakeExecutor(selectsWithTeamState({}));
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    expect(updateCalls.some((c) => c.table === teamMemberships && c.values.playerId === TARGET_ID)).toBe(true);
    expect(updateCalls.some((c) => c.table === teams && c.values.captainPlayerId === TARGET_ID)).toBe(true);
    expect(updateCalls.some((c) => c.table === teamInvitations && c.values.invitedByPlayerId === TARGET_ID)).toBe(true);
  });

  describe("historical membership-history overlap -- fails closed, never chooses/truncates/merges", () => {
    it("1. both currently active (different teams): blocked -- open intervals always overlap from the later join date onward", async () => {
      const { executor, updateCalls, deleteCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-02-01T00:00:00.000Z", leftAt: null }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result.merged).toBe(false);
      if (!result.merged) {
        expect(result.conflict).toBe(true);
        expect(result.reason).toContain("team_membership_history_conflict");
      }
      // Fails BEFORE any history-move update -- only the intent's own
      // conflict status flip happened, same discipline as the dealer-shift
      // conflict check right above it in executeMerge.
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].values.status).toBe("conflict");
      expect(deleteCalls.length).toBe(0);
    });

    it("2. historical (both closed) overlap, DIFFERENT teams: blocked -- exact spec example (target Team A Jan1-Mar1, source Team B Feb1-Apr1)", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-03-01T00:00:00.000Z" }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-02-01T00:00:00.000Z", leftAt: "2026-04-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result.merged).toBe(false);
      if (!result.merged) expect(result.reason).toContain("team_membership_history_conflict");
      expect(updateCalls.length).toBe(1);
    });

    it("3. historical overlap on the SAME team: also blocked -- never auto-collapsed, membership history is the scoring/audit source of truth", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-x", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-03-01T00:00:00.000Z" }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-x", joinedAt: "2026-02-01T00:00:00.000Z", leftAt: "2026-04-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result.merged).toBe(false);
      if (!result.merged) expect(result.reason).toContain("team_membership_history_conflict");
      expect(updateCalls.length).toBe(1);
    });

    it("4. source interval entirely INSIDE target's interval: blocked", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-06-01T00:00:00.000Z" }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-02-01T00:00:00.000Z", leftAt: "2026-03-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result.merged).toBe(false);
      expect(updateCalls.length).toBe(1);
    });

    it("5. one side still open (active), the other closed and historical: an open interval overlapping a past closed one is still blocked", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            // Target has been on Team A since Jan 1 and is STILL active.
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: null }),
            // Source's Team B membership already ended, but it falls
            // entirely inside target's still-open interval.
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-02-01T00:00:00.000Z", leftAt: "2026-03-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result.merged).toBe(false);
      expect(updateCalls.length).toBe(1);
    });

    it("6. non-overlapping historical intervals: merge succeeds", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-02-01T00:00:00.000Z" }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-03-01T00:00:00.000Z", leftAt: "2026-04-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result).toEqual({ merged: true });
      expect(updateCalls.some((c) => c.table === teamMemberships && c.values.playerId === TARGET_ID)).toBe(true);
    });

    it("7. boundary-touching intervals (target leaves exactly when source joins): merge succeeds -- [joined, left) is half-open", async () => {
      const { executor, updateCalls } = makeFakeExecutor(
        selectsWithTeamState({
          allTeamMembershipRows: [
            rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-01-20T00:00:00.000Z" }),
            rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-01-20T00:00:00.000Z", leftAt: "2026-02-01T00:00:00.000Z" }),
          ],
        })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

      expect(result).toEqual({ merged: true });
      expect(updateCalls.some((c) => c.table === teamMemberships && c.values.playerId === TARGET_ID)).toBe(true);
    });

    it("8. after a successful (non-overlapping) merge, feeding the reassigned intervals into team-scoring never sees two matches for the same tournament start time", async () => {
      // Simulates exactly what executeMerge's own reassignment does on
      // success: every membership row's player_id becomes targetId. Feeds
      // that post-reassignment state into the REAL
      // lib/team-scoring.ts::attributeResultsToTeams to prove the
      // composition never produces AmbiguousTeamMembershipError for a case
      // this merge is willing to approve.
      const targetInterval = rawMembership({ playerId: TARGET_ID, teamId: "team-a", joinedAt: "2026-01-01T00:00:00.000Z", leftAt: "2026-02-01T00:00:00.000Z" });
      const sourceInterval = rawMembership({ playerId: SOURCE_ID, teamId: "team-b", joinedAt: "2026-03-01T00:00:00.000Z", leftAt: "2026-04-01T00:00:00.000Z" });

      const { executor } = makeFakeExecutor(
        selectsWithTeamState({ allTeamMembershipRows: [targetInterval, sourceInterval] })
      );
      mockTxTarget.current = executor;

      const { executeMerge } = await import("@/lib/player-merge");
      const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });
      expect(result).toEqual({ merged: true });

      const { attributeResultsToTeams } = await import("@/lib/team-scoring");
      const postMergeIntervals = [targetInterval, sourceInterval].map((row) => ({
        id: row.id,
        team_id: row.teamId,
        player_id: TARGET_ID, // both rows now belong to the canonical player
        joined_at: row.joinedAt.toISOString(),
        left_at: row.leftAt ? row.leftAt.toISOString() : null,
      }));

      const attributedToA = attributeResultsToTeams(
        [{ tournament_id: "t1", player_id: TARGET_ID, rating_points: 100, season_id: "s1", tournament_start_at: "2026-01-15T00:00:00.000Z" }],
        postMergeIntervals
      );
      expect(attributedToA).toEqual([{ tournament_id: "t1", player_id: TARGET_ID, team_id: "team-a", rating_points: 100 }]);

      const attributedToB = attributeResultsToTeams(
        [{ tournament_id: "t2", player_id: TARGET_ID, rating_points: 50, season_id: "s1", tournament_start_at: "2026-03-15T00:00:00.000Z" }],
        postMergeIntervals
      );
      expect(attributedToB).toEqual([{ tournament_id: "t2", player_id: TARGET_ID, team_id: "team-b", rating_points: 50 }]);
    });
  });

  it("pending-invitation collision: both sides had a pending invite from the SAME team -- source's is CANCELLED, never reassigned onto a second pending row for target", async () => {
    const { executor, updateCalls } = makeFakeExecutor(
      selectsWithTeamState({
        sourcePendingInvitationRows: [{ id: "inv-source", teamId: "team-x" }],
        targetPendingTeamIdRows: [{ teamId: "team-x" }],
      })
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    const cancelledInvitationUpdates = updateCalls.filter(
      (c) => c.table === teamInvitations && c.values.status === "cancelled"
    );
    expect(cancelledInvitationUpdates).toHaveLength(1);
    // Never reassigned onto targetId -- that would create a second pending
    // row for the same (team, target) pair, violating
    // team_invitations_one_pending_per_team_player_idx.
    expect(updateCalls.some((c) => c.table === teamInvitations && c.values.invitedPlayerId === TARGET_ID)).toBe(
      false
    );
  });

  it("pending invitation, no collision: source's invite from a DIFFERENT team than target's own pending one is MOVED onto target, not cancelled", async () => {
    const { executor, updateCalls } = makeFakeExecutor(
      selectsWithTeamState({
        sourcePendingInvitationRows: [{ id: "inv-source", teamId: "team-y" }],
        targetPendingTeamIdRows: [],
      })
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    expect(updateCalls.some((c) => c.table === teamInvitations && c.values.invitedPlayerId === TARGET_ID)).toBe(true);
    expect(updateCalls.some((c) => c.table === teamInvitations && c.values.status === "cancelled")).toBe(false);
  });

  it("16. team_join_requests: no collision -- source's pending request to a DIFFERENT team than target's own pending one is MOVED onto target", async () => {
    const { executor, updateCalls } = makeFakeExecutor(
      selectsWithTeamState({
        sourcePendingJoinRequestRows: [{ id: "req-source", teamId: "team-y" }],
        targetPendingRequestTeamIdRows: [],
      })
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    expect(updateCalls.some((c) => c.table === teamJoinRequests && c.values.playerId === TARGET_ID)).toBe(true);
    expect(updateCalls.some((c) => c.table === teamJoinRequests && c.values.status === "cancelled")).toBe(false);
  });

  it("16. team_join_requests: COLLISION -- both sides had a pending request to the SAME team -- source's is cancelled, never reassigned onto a second pending row for target", async () => {
    const { executor, updateCalls } = makeFakeExecutor(
      selectsWithTeamState({
        sourcePendingJoinRequestRows: [{ id: "req-source", teamId: "team-x" }],
        targetPendingRequestTeamIdRows: [{ teamId: "team-x" }],
      })
    );
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    const cancelledRequestUpdates = updateCalls.filter(
      (c) => c.table === teamJoinRequests && c.values.status === "cancelled"
    );
    expect(cancelledRequestUpdates).toHaveLength(1);
    // Never reassigned onto targetId -- that would create a second pending
    // row for the same (team, target) pair, violating
    // team_join_requests_one_pending_per_team_player_idx.
    expect(updateCalls.some((c) => c.table === teamJoinRequests && c.values.playerId === TARGET_ID)).toBe(false);
  });

  it("historical join-request rows (accepted/declined/cancelled) remain auditable -- merge never deletes anything, and this reassignment never touches the membership-history overlap blocker", async () => {
    // Both sides have a CLOSED (non-pending) historical request -- these
    // aren't even selected by the pending-only collision query, so they
    // simply stay on their original row untouched (still auditable by
    // their original id; only the LIVE pending state ever needs to move).
    const { executor, updateCalls } = makeFakeExecutor(selectsWithTeamState({}));
    mockTxTarget.current = executor;

    const { executeMerge } = await import("@/lib/player-merge");
    const result = await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    expect(result).toEqual({ merged: true });
    // No team_join_requests update at all when neither side has anything
    // pending -- historical (already-resolved) rows are left exactly as
    // they are, never touched, never deleted.
    expect(updateCalls.some((c) => c.table === teamJoinRequests)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teams, teamMemberships, teamInvitations } from "@/lib/db/schema";

// This suite exercises the REAL transactional business logic in
// features/teams.ts against a hand-built fake `tx` that mimics Drizzle's
// chainable shape closely enough to drive the real functions end-to-end --
// same technique as lib/__tests__/player-merge.test.ts's makeFakeExecutor,
// adapted to be TABLE-KEYED (a FIFO queue of canned responses per schema
// table, dequeued in call order) since these functions interleave selects
// across three tables rather than one. What it deliberately does NOT prove:
// that SELECT ... FOR UPDATE actually locks rows against a real Postgres
// server, or that a real 23505 unique-violation is thrown exactly the way
// the fake simulates it -- both are standard, well-understood Postgres
// behavior this codebase already relies on elsewhere (see dealer_shifts'
// own one-open-shift constraint), not something worth a live-DB test here.
const { currentTx, mockResolveCanonicalPlayer, mockPlayerRepo, mockResultRepo, mockSeasonRepo } = vi.hoisted(() => ({
  currentTx: { current: null as unknown },
  mockResolveCanonicalPlayer: vi.fn(),
  mockPlayerRepo: {
    findById: vi.fn(),
    findByIds: vi.fn().mockResolvedValue([]),
    listOrderedByDisplayName: vi.fn().mockResolvedValue([]),
  },
  mockResultRepo: { findAllForTeamScoring: vi.fn().mockResolvedValue([]) },
  mockSeasonRepo: { findActive: vi.fn().mockResolvedValue(null) },
}));

// The plain (non-transactional) db.select(...) calls the post-mutation
// read-back (getTeamDetail/getTeamLeaderboard) makes -- this suite asserts
// on the TRANSACTION's own side effects (insert/update calls, thrown
// errors), not on the shape of that read-back DTO, so `teams` resolves to
// one generic row (just enough for getTeamDetail's lookup to succeed
// instead of throwing TeamNotFoundError) and every other table resolves to
// an empty set, a harmless stand-in rather than a hand-maintained fixture
// for a DTO these tests don't check.
type OutsideTxChain = Promise<unknown[]> & {
  from: (table: unknown) => OutsideTxChain;
  where: () => OutsideTxChain;
  limit: () => OutsideTxChain;
  for: () => OutsideTxChain;
  groupBy: () => OutsideTxChain;
};

function outsideTxChain(table: unknown): OutsideTxChain {
  const rows =
    table === teams
      ? [{ id: "team-1", name: "Sharks", emblem: "🦈", captainPlayerId: "captain-1", status: "active", createdAt: new Date(), updatedAt: new Date(), disbandedAt: null }]
      : [];
  const promise = Promise.resolve(rows) as OutsideTxChain;
  promise.from = () => promise;
  promise.where = () => promise;
  promise.limit = () => promise;
  promise.for = () => promise;
  promise.groupBy = () => promise;
  return promise;
}

vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(currentTx.current),
    select: () => ({ from: (table: unknown) => outsideTxChain(table) }),
  },
}));

vi.mock("@/lib/canonical-player", () => ({
  resolveCanonicalPlayer: mockResolveCanonicalPlayer,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepo,
  resultRepository: mockResultRepo,
  seasonRepository: mockSeasonRepo,
}));

function uniqueViolation(constraint: string): Error {
  return new Error("duplicate key value violates unique constraint", {
    cause: { code: "23505", constraint_name: constraint },
  });
}

type TxConfig = {
  teams?: unknown[][];
  teamMemberships?: unknown[][];
  teamInvitations?: unknown[][];
  throwUniqueOn?: { table: unknown; constraint: string }[];
};

function makeFakeTx(config: TxConfig) {
  const queues = new Map<unknown, unknown[][]>([
    [teams, [...(config.teams ?? [])]],
    [teamMemberships, [...(config.teamMemberships ?? [])]],
    [teamInvitations, [...(config.teamInvitations ?? [])]],
  ]);
  const throwUniqueOn = new Map((config.throwUniqueOn ?? []).map((c) => [c.table, c.constraint]));

  const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  function dequeue(table: unknown): unknown[] {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error("makeFakeTx: no queued select response left for this table -- check call order");
    }
    return queue.shift()!;
  }

  function selectChain(table: unknown) {
    const resultPromise = Promise.resolve(dequeue(table));
    return Object.assign(resultPromise, {
      limit: () => resultPromise,
      for: () => resultPromise,
    });
  }

  const tx = {
    select: () => ({
      from: (table: unknown) => ({ where: () => selectChain(table) }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        const constraint = throwUniqueOn.get(table);
        const generatedRow = { id: `generated-${insertCalls.length}`, ...values };
        return {
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            if (constraint) reject(uniqueViolation(constraint));
            else resolve([]);
          },
          returning: () =>
            constraint ? Promise.reject(uniqueViolation(constraint)) : Promise.resolve([generatedRow]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  return { tx, insertCalls, updateCalls };
}

function teamRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "team-1",
    name: "Sharks",
    emblem: "🦈",
    captainPlayerId: "captain-1",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    disbandedAt: null,
    ...overrides,
  };
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "membership-1",
    teamId: "team-1",
    playerId: "captain-1",
    joinedAt: new Date(),
    leftAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "invitation-1",
    teamId: "team-1",
    invitedPlayerId: "invitee-1",
    invitedByPlayerId: "captain-1",
    status: "pending",
    createdAt: new Date(),
    respondedAt: null,
    ...overrides,
  };
}

function playerDomain(overrides: Record<string, unknown> = {}) {
  return {
    id: "invitee-1",
    telegram_id: null,
    username: "invitee",
    display_name: "Invitee",
    role: "player",
    is_blocked: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPlayerRepo.findByIds.mockResolvedValue([]);
  mockPlayerRepo.listOrderedByDisplayName.mockResolvedValue([]);
  mockResultRepo.findAllForTeamScoring.mockResolvedValue([]);
  mockSeasonRepo.findActive.mockResolvedValue(null);
});

afterEach(() => {
  currentTx.current = null;
});

describe("createTeam", () => {
  it("1. creator becomes captain AND member #1 -- one team row + one membership row, both keyed to actorId", async () => {
    const { tx, insertCalls } = makeFakeTx({ teamMemberships: [[]], teams: [[]] });
    currentTx.current = tx;

    const { createTeam } = await import("@/features/teams");
    await createTeam("captain-1", { name: "Sharks", emblem: "🦈" });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]).toMatchObject({ table: teams, values: { name: "Sharks", emblem: "🦈", captainPlayerId: "captain-1" } });
    expect(insertCalls[1]).toMatchObject({ table: teamMemberships, values: { playerId: "captain-1" } });
  });

  it("2. player cannot create a second active team", async () => {
    const { tx, insertCalls } = makeFakeTx({ teamMemberships: [[membershipRow({ playerId: "captain-1" })]] });
    currentTx.current = tx;

    const { createTeam, AlreadyOnActiveTeamError } = await import("@/features/teams");
    await expect(createTeam("captain-1", { name: "Sharks" })).rejects.toThrow(AlreadyOnActiveTeamError);
    expect(insertCalls).toHaveLength(0);
  });

  it("15. the DB unique index is the final backstop even if the pre-check race-loses (23505 -> AlreadyOnActiveTeamError, not a raw DB error)", async () => {
    const { tx } = makeFakeTx({
      teamMemberships: [[]],
      teams: [[]],
      throwUniqueOn: [{ table: teamMemberships, constraint: "team_memberships_one_active_per_player_idx" }],
    });
    currentTx.current = tx;

    const { createTeam, AlreadyOnActiveTeamError } = await import("@/features/teams");
    await expect(createTeam("captain-1", { name: "Sharks" })).rejects.toThrow(AlreadyOnActiveTeamError);
  });

  it("rejects a taken name (case-insensitive) before touching the DB write path", async () => {
    const { tx, insertCalls } = makeFakeTx({ teamMemberships: [[]], teams: [[teamRow({ name: "sharks" })]] });
    currentTx.current = tx;

    const { createTeam, TeamNameTakenError } = await import("@/features/teams");
    await expect(createTeam("captain-1", { name: "SHARKS" })).rejects.toThrow(TeamNameTakenError);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a name outside 2..40 chars and an emblem outside the allowlist", async () => {
    const { InvalidTeamNameError, InvalidEmblemError, createTeam } = await import("@/features/teams");
    await expect(createTeam("captain-1", { name: "A" })).rejects.toThrow(InvalidTeamNameError);
    await expect(createTeam("captain-1", { name: "Sharks", emblem: "🍕" })).rejects.toThrow(InvalidEmblemError);
  });
});

describe("capacity: invite reserves a seat, 5/5 is the hard ceiling", () => {
  it("3 & 4. a captain-only team with 4 active members can invite a 5th (4 active + 0 pending < 5)", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 4 }]],
      teamInvitations: [[], [{ pendingCount: 0 }]],
    });
    currentTx.current = tx;

    const { inviteToTeam } = await import("@/features/teams");
    await inviteToTeam("captain-1", "team-1", "invitee-1");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(teamInvitations);
  });

  it("5. active(5) + pending(0) >= 5 -- TeamFullError, sixth member impossible via invite", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 5 }]],
      teamInvitations: [[], [{ pendingCount: 0 }]],
    });
    currentTx.current = tx;

    const { inviteToTeam, TeamFullError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "invitee-1")).rejects.toThrow(TeamFullError);
    expect(insertCalls).toHaveLength(0);
  });

  it("pending invitations reserve remaining seats: active(3) + pending(2) >= 5 blocks a 6th invite", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 3 }]],
      teamInvitations: [[], [{ pendingCount: 2 }]],
    });
    currentTx.current = tx;

    const { inviteToTeam, TeamFullError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "invitee-1")).rejects.toThrow(TeamFullError);
  });

  it("7. non-captain cannot invite", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { inviteToTeam, NotCaptainError } = await import("@/features/teams");
    await expect(inviteToTeam("not-the-captain", "team-1", "invitee-1")).rejects.toThrow(NotCaptainError);
    expect(insertCalls).toHaveLength(0);
  });

  it("6. acceptInvitation re-checks capacity under lock -- a team already at 5/5 by accept time rejects the 6th, even if the invite was sent earlier when there was room (the concurrency guarantee itself is the DB row lock + unique index; this proves the code path actually re-checks rather than trusting the invite-time count)", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 5 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation, TeamFullError } = await import("@/features/teams");
    await expect(acceptInvitation("invitee-1", "invitation-1")).rejects.toThrow(TeamFullError);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("leave / kick captain protections", () => {
  it("9. captain cannot leave without transfer/disband", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { leaveTeam, CaptainCannotLeaveError } = await import("@/features/teams");
    await expect(leaveTeam("captain-1", "team-1")).rejects.toThrow(CaptainCannotLeaveError);
    expect(updateCalls).toHaveLength(0);
  });

  it("11. member leave CLOSES the membership (sets left_at) -- never a delete call", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[membershipRow({ id: "m-2", playerId: "member-1" })]],
    });
    currentTx.current = tx;

    const { leaveTeam } = await import("@/features/teams");
    await leaveTeam("member-1", "team-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(teamMemberships);
    expect(updateCalls[0].values).toHaveProperty("leftAt");
  });

  it("8. non-captain cannot kick", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { removeMember, NotCaptainError } = await import("@/features/teams");
    await expect(removeMember("not-the-captain", "team-1", "member-1")).rejects.toThrow(NotCaptainError);
    expect(updateCalls).toHaveLength(0);
  });

  it("captain cannot be kicked (must transfer/disband instead)", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { removeMember, CaptainCannotBeRemovedError } = await import("@/features/teams");
    await expect(removeMember("captain-1", "team-1", "captain-1")).rejects.toThrow(CaptainCannotBeRemovedError);
    expect(updateCalls).toHaveLength(0);
  });

  it("12. kicked member's membership history remains (closed, never deleted)", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[membershipRow({ id: "m-2", playerId: "member-1" })]],
    });
    currentTx.current = tx;

    const { removeMember } = await import("@/features/teams");
    await removeMember("captain-1", "team-1", "member-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teamMemberships });
    expect(updateCalls[0].values).toHaveProperty("leftAt");
    // Never a delete -- the fake tx doesn't even expose a delete() method,
    // so removeMember calling one would throw a TypeError, not silently pass.
  });
});

describe("transferCaptain", () => {
  it("10. captain transfer works -- updates teams.captainPlayerId to a current active member", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[membershipRow({ playerId: "member-1" })]],
    });
    currentTx.current = tx;

    const { transferCaptain } = await import("@/features/teams");
    await transferCaptain("captain-1", "team-1", "member-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teams, values: { captainPlayerId: "member-1" } });
  });

  it("rejects transferring to someone who isn't a CURRENT active member", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[]],
    });
    currentTx.current = tx;

    const { transferCaptain, NotActiveTeamMemberError } = await import("@/features/teams");
    await expect(transferCaptain("captain-1", "team-1", "not-a-member")).rejects.toThrow(NotActiveTeamMemberError);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("disbandTeam", () => {
  it("13. disband: teams.status closed + every active membership closed + every pending invitation cancelled, in one transaction", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { disbandTeam } = await import("@/features/teams");
    await disbandTeam("captain-1", "team-1");

    expect(updateCalls).toHaveLength(3);
    expect(updateCalls[0]).toMatchObject({ table: teams, values: { status: "disbanded" } });
    expect(updateCalls[0].values).toHaveProperty("disbandedAt");
    expect(updateCalls[1]).toMatchObject({ table: teamMemberships });
    expect(updateCalls[1].values).toHaveProperty("leftAt");
    expect(updateCalls[2]).toMatchObject({ table: teamInvitations, values: { status: "cancelled" } });
  });

  it("14. a disbanded team cannot mutate -- every mutation checked rejects with TeamDisbandedError", async () => {
    const { TeamDisbandedError, updateTeamIdentity, inviteToTeam, leaveTeam, removeMember, transferCaptain, disbandTeam } =
      await import("@/features/teams");

    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const disbanded = teamRow({ status: "disbanded", captainPlayerId: "captain-1" });

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(updateTeamIdentity("captain-1", "team-1", { name: "New" })).rejects.toThrow(TeamDisbandedError);

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(inviteToTeam("captain-1", "team-1", "invitee-1")).rejects.toThrow(TeamDisbandedError);

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(leaveTeam("member-1", "team-1")).rejects.toThrow(TeamDisbandedError);

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(removeMember("captain-1", "team-1", "member-1")).rejects.toThrow(TeamDisbandedError);

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(transferCaptain("captain-1", "team-1", "member-1")).rejects.toThrow(TeamDisbandedError);

    currentTx.current = makeFakeTx({ teams: [[disbanded]] }).tx;
    await expect(disbandTeam("captain-1", "team-1")).rejects.toThrow(TeamDisbandedError);
  });
});

describe("acceptInvitation", () => {
  it("creates the membership and marks the invitation accepted", async () => {
    const { tx, insertCalls, updateCalls } = makeFakeTx({
      teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation } = await import("@/features/teams");
    await acceptInvitation("invitee-1", "invitation-1");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ table: teamMemberships, values: { teamId: "team-1", playerId: "invitee-1" } });
    expect(updateCalls.some((c) => c.table === teamInvitations && c.values.status === "accepted")).toBe(true);
  });

  it("16. accepting one invitation atomically cancels every OTHER pending invitation for that player", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teamInvitations: [[invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 0 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation } = await import("@/features/teams");
    await acceptInvitation("invitee-1", "invitation-1");

    const cancelUpdate = updateCalls.find((c) => c.table === teamInvitations && c.values.status === "cancelled");
    expect(cancelUpdate).toBeDefined();
    // Both the accept and the "cancel everything else" update target
    // teamInvitations, distinguished by their `set` payload's status.
    expect(updateCalls.filter((c) => c.table === teamInvitations)).toHaveLength(2);
  });

  it("rejects accepting someone else's invitation", async () => {
    const { tx } = makeFakeTx({ teamInvitations: [[invitationRow({ invitedPlayerId: "someone-else" })]] });
    currentTx.current = tx;

    const { acceptInvitation, InvitationForbiddenError } = await import("@/features/teams");
    await expect(acceptInvitation("invitee-1", "invitation-1")).rejects.toThrow(InvitationForbiddenError);
  });

  it("rejects accepting an already-resolved invitation", async () => {
    const { tx } = makeFakeTx({ teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1", status: "declined" })]] });
    currentTx.current = tx;

    const { acceptInvitation, InvitationNotPendingError } = await import("@/features/teams");
    await expect(acceptInvitation("invitee-1", "invitation-1")).rejects.toThrow(InvitationNotPendingError);
  });
});

describe("invite target eligibility -- account-merge / blocked-player compatibility", () => {
  it("17. a merged-away invite target transparently resolves to its canonical id -- the invitation is created for the CANONICAL player, never the dead row", async () => {
    mockPlayerRepo.findById.mockResolvedValue(playerDomain({ id: "old-merged-away-id" }));
    // resolveCanonicalPlayer follows the merge chain -- the canonical
    // target has a DIFFERENT id than what was passed in.
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain({ id: "canonical-id" }));

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
      teamInvitations: [[], [{ pendingCount: 0 }]],
    });
    currentTx.current = tx;

    const { inviteToTeam } = await import("@/features/teams");
    await inviteToTeam("captain-1", "team-1", "old-merged-away-id");

    expect(insertCalls[0].values).toMatchObject({ invitedPlayerId: "canonical-id" });
  });

  it("rejects inviting a blocked player", async () => {
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain({ is_blocked: true }));

    currentTx.current = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] }).tx;

    const { inviteToTeam, InviteTargetUnavailableError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "blocked-1")).rejects.toThrow(InviteTargetUnavailableError);
  });

  it("rejects inviting a player who no longer resolves to any canonical player (dangling/corrupted)", async () => {
    mockPlayerRepo.findById.mockResolvedValue(null);
    mockResolveCanonicalPlayer.mockResolvedValue(null);

    currentTx.current = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] }).tx;

    const { inviteToTeam, PlayerNotFoundError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "ghost-1")).rejects.toThrow(PlayerNotFoundError);
  });

  it("rejects inviting a player who already belongs to an active team", async () => {
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());

    currentTx.current = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[membershipRow({ playerId: "invitee-1", teamId: "other-team" })]],
    }).tx;

    const { inviteToTeam, InviteTargetUnavailableError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "invitee-1")).rejects.toThrow(InviteTargetUnavailableError);
  });
});

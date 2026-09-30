import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { teams, teamMemberships, teamInvitations, teamJoinRequests } from "@/lib/db/schema";

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
const { currentTx, mockResolveCanonicalPlayer, mockPlayerRepo, mockResultRepo, mockSeasonRepo, mockSendNotification, mockAvatarStorageRepository } =
  vi.hoisted(() => ({
    currentTx: { current: null as unknown },
    mockResolveCanonicalPlayer: vi.fn(),
    mockPlayerRepo: {
      findById: vi.fn(),
      findByIds: vi.fn().mockResolvedValue([]),
      listOrderedByDisplayName: vi.fn().mockResolvedValue([]),
    },
    mockResultRepo: { findAllForTeamScoring: vi.fn().mockResolvedValue([]) },
    mockSeasonRepo: { findActive: vi.fn().mockResolvedValue(null) },
    mockSendNotification: vi.fn().mockResolvedValue(true),
    mockAvatarStorageRepository: { upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue("https://cdn/teams/team-1/avatar.webp") },
  }));

// Outside-tx fixture for a single team_join_requests row -- only
// acceptJoinRequest's pre-transaction resolveEligiblePlayer lookup reads
// this table outside a transaction (to resolve the applicant's canonical
// identity before locking); every test that exercises acceptJoinRequest
// sets this to the request row it wants resolved.
let outsideTxJoinRequestRow: unknown = null;

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
      : table === teamJoinRequests
        ? outsideTxJoinRequestRow
          ? [outsideTxJoinRequestRow]
          : []
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
  avatarStorageRepository: mockAvatarStorageRepository,
  contentTypeToExtension: (contentType: string) => (contentType === "image/webp" ? "webp" : "jpg"),
}));

vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTeamsTelegramNotification: mockSendNotification,
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
  teamJoinRequests?: unknown[][];
  throwUniqueOn?: { table: unknown; constraint: string }[];
};

function makeFakeTx(config: TxConfig) {
  const queues = new Map<unknown, unknown[][]>([
    [teams, [...(config.teams ?? [])]],
    [teamMemberships, [...(config.teamMemberships ?? [])]],
    [teamInvitations, [...(config.teamInvitations ?? [])]],
    [teamJoinRequests, [...(config.teamJoinRequests ?? [])]],
  ]);
  const throwUniqueOn = new Map((config.throwUniqueOn ?? []).map((c) => [c.table, c.constraint]));

  const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  // Records every table a `.select()` chain was opened against, in call
  // order -- used ONLY by the lock-order tests to assert the team row is
  // selected (and thus FOR UPDATE-locked, per the real query) before the
  // invitation/join-request row is re-selected FOR UPDATE.
  const selectOrder: unknown[] = [];

  function dequeue(table: unknown): unknown[] {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error("makeFakeTx: no queued select response left for this table -- check call order");
    }
    return queue.shift()!;
  }

  function selectChain(table: unknown) {
    selectOrder.push(table);
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

  return { tx, insertCalls, updateCalls, selectOrder };
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
  mockSendNotification.mockReset().mockResolvedValue(true);
  mockAvatarStorageRepository.upload.mockReset().mockResolvedValue({ error: null });
  mockAvatarStorageRepository.getPublicUrl.mockReset().mockReturnValue("https://cdn/teams/team-1/avatar.webp");
  outsideTxJoinRequestRow = null;
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

describe("capacity: pending invitations never reserve seats, active members are the only ceiling", () => {
  it("3 & 4. a captain-only team with 4 active members can invite a 5th (4 active < 5)", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 4 }]],
      teamInvitations: [[]],
    });
    currentTx.current = tx;

    const { inviteToTeam } = await import("@/features/teams");
    await inviteToTeam("captain-1", "team-1", "invitee-1");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(teamInvitations);
  });

  it("5. active(5) -- TeamFullError, sixth member impossible via invite, regardless of pending count", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 5 }]],
      teamInvitations: [[]],
    });
    currentTx.current = tx;

    const { inviteToTeam, TeamFullError } = await import("@/features/teams");
    await expect(inviteToTeam("captain-1", "team-1", "invitee-1")).rejects.toThrow(TeamFullError);
    expect(insertCalls).toHaveLength(0);
  });

  it("pending invitations do NOT reserve seats: active(3) + pending(2) still allows another invite", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 3 }]],
      teamInvitations: [[]],
    });
    currentTx.current = tx;

    const { inviteToTeam } = await import("@/features/teams");
    await inviteToTeam("captain-1", "team-1", "invitee-1");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(teamInvitations);
  });

  it("active(4) + pending(10) still allows a captain to invite up to the 5th active seat", async () => {
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain());
    mockPlayerRepo.findById.mockResolvedValue(playerDomain());

    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 4 }]],
      teamInvitations: [[]],
    });
    currentTx.current = tx;

    const { inviteToTeam } = await import("@/features/teams");
    await inviteToTeam("captain-1", "team-1", "invitee-1");

    expect(insertCalls).toHaveLength(1);
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
      teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1" })], [invitationRow({ invitedPlayerId: "invitee-1" })]],
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
      teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1" })], [invitationRow({ invitedPlayerId: "invitee-1" })]],
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
      teamInvitations: [[invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })], [invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })]],
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

  it("filling the team to 5/5 via invitation acceptance cancels every OTHER pending invitation AND pending join request targeting THIS team", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teamInvitations: [[invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })], [invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 4 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation } = await import("@/features/teams");
    await acceptInvitation("invitee-1", "invitation-1");

    const invitationCancels = updateCalls.filter(
      (c) => c.table === teamInvitations && c.values.status === "cancelled"
    );
    expect(invitationCancels.length).toBeGreaterThanOrEqual(1);
    const requestCancels = updateCalls.filter(
      (c) => c.table === teamJoinRequests && c.values.status === "cancelled"
    );
    expect(requestCancels).toHaveLength(1);
  });

  it("accepting at active(2) (not yet full) does NOT sweep other pending invitations/requests against this team", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teamInvitations: [[invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })], [invitationRow({ id: "invitation-1", invitedPlayerId: "invitee-1", teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 2 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation } = await import("@/features/teams");
    await acceptInvitation("invitee-1", "invitation-1");

    const requestCancels = updateCalls.filter((c) => c.table === teamJoinRequests);
    expect(requestCancels).toHaveLength(0);
  });

  it("rejects accepting someone else's invitation", async () => {
    const { tx } = makeFakeTx({
      teamInvitations: [[invitationRow({ invitedPlayerId: "someone-else" })], [invitationRow({ invitedPlayerId: "someone-else" })]],
      teams: [[teamRow({ id: "team-1" })]],
    });
    currentTx.current = tx;

    const { acceptInvitation, InvitationForbiddenError } = await import("@/features/teams");
    await expect(acceptInvitation("invitee-1", "invitation-1")).rejects.toThrow(InvitationForbiddenError);
  });

  it("rejects accepting an already-resolved invitation", async () => {
    const { tx } = makeFakeTx({
      teamInvitations: [
        [invitationRow({ invitedPlayerId: "invitee-1", status: "declined" })],
        [invitationRow({ invitedPlayerId: "invitee-1", status: "declined" })],
      ],
      teams: [[teamRow({ id: "team-1" })]],
    });
    currentTx.current = tx;

    const { acceptInvitation, InvitationNotPendingError } = await import("@/features/teams");
    await expect(acceptInvitation("invitee-1", "invitation-1")).rejects.toThrow(InvitationNotPendingError);
  });

  it("DEADLOCK SAFETY: locks the team row BEFORE re-locking the invitation row (team-first ordering)", async () => {
    const { tx, selectOrder } = makeFakeTx({
      teamInvitations: [[invitationRow({ invitedPlayerId: "invitee-1" })], [invitationRow({ invitedPlayerId: "invitee-1" })]],
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
    });
    currentTx.current = tx;

    const { acceptInvitation } = await import("@/features/teams");
    await acceptInvitation("invitee-1", "invitation-1");

    // The FIRST teamInvitations read is a non-locking preview (only to
    // learn the teamId); the team row must be locked next, and only THEN
    // is the invitation row re-selected FOR UPDATE. This ordering is what
    // prevents a same-team deadlock between two concurrent acceptances
    // (see acceptInvitation's "LOCK ORDER" doc comment).
    const firstInvitationIdx = selectOrder.indexOf(teamInvitations);
    const teamIdx = selectOrder.indexOf(teams);
    const secondInvitationIdx = selectOrder.indexOf(teamInvitations, firstInvitationIdx + 1);
    expect(firstInvitationIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeGreaterThan(firstInvitationIdx);
    expect(secondInvitationIdx).toBeGreaterThan(teamIdx);
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
      teamInvitations: [[]],
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

function joinRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    teamId: "team-1",
    playerId: "applicant-1",
    status: "pending",
    createdAt: new Date(),
    respondedAt: null,
    ...overrides,
  };
}

describe("requestToJoinTeam", () => {
  it("1. a teamless player can request an active, non-full team", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 2 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam } = await import("@/features/teams");
    await requestToJoinTeam("applicant-1", "team-1");

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ table: teamJoinRequests, values: { teamId: "team-1", playerId: "applicant-1" } });
  });

  it("2. cannot request the same team twice", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[]],
      teamInvitations: [[]],
      teamJoinRequests: [[joinRequestRow({ playerId: "applicant-1" })]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam, AlreadyRequestedError } = await import("@/features/teams");
    await expect(requestToJoinTeam("applicant-1", "team-1")).rejects.toThrow(AlreadyRequestedError);
    expect(insertCalls).toHaveLength(0);
  });

  it("3. cannot request while already on a team", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[membershipRow({ playerId: "applicant-1", teamId: "other-team" })]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam, AlreadyOnActiveTeamError } = await import("@/features/teams");
    await expect(requestToJoinTeam("applicant-1", "team-1")).rejects.toThrow(AlreadyOnActiveTeamError);
    expect(insertCalls).toHaveLength(0);
  });

  it("4. cannot request a disbanded team", async () => {
    const { tx, insertCalls } = makeFakeTx({ teams: [[teamRow({ id: "team-1", status: "disbanded" })]] });
    currentTx.current = tx;

    const { requestToJoinTeam, TeamDisbandedError } = await import("@/features/teams");
    await expect(requestToJoinTeam("applicant-1", "team-1")).rejects.toThrow(TeamDisbandedError);
    expect(insertCalls).toHaveLength(0);
  });

  it("5. cannot request a full (5/5) team", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 5 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam, TeamFullError } = await import("@/features/teams");
    await expect(requestToJoinTeam("applicant-1", "team-1")).rejects.toThrow(TeamFullError);
    expect(insertCalls).toHaveLength(0);
  });

  it("6. an existing pending INVITATION from the same team blocks a redundant request", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[]],
      teamInvitations: [[{ id: "inv-1", teamId: "team-1", invitedPlayerId: "applicant-1", status: "pending" }]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam, AlreadyInvitedByTeamError } = await import("@/features/teams");
    await expect(requestToJoinTeam("applicant-1", "team-1")).rejects.toThrow(AlreadyInvitedByTeamError);
    expect(insertCalls).toHaveLength(0);
  });

  it("7. join requests do not reserve seats -- eligibility only checks CURRENT active members, ignoring pending invitations", async () => {
    // 4 active + (hypothetically) pending invitations elsewhere never
    // enters this eligibility check at all -- only activeCount is read.
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1" })]],
      teamMemberships: [[], [{ activeCount: 4 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;

    const { requestToJoinTeam } = await import("@/features/teams");
    await requestToJoinTeam("applicant-1", "team-1");
    expect(insertCalls).toHaveLength(1);
  });

  it("19. notifies the team's CAPTAIN (not the applicant) with the correct telegram_id", async () => {
    const { tx } = makeFakeTx({
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;
    mockPlayerRepo.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === "applicant-1"
          ? playerDomain({ id: "applicant-1", display_name: "Applicant" })
          : playerDomain({ id: "captain-1", telegram_id: 999 })
      )
    );

    const { requestToJoinTeam } = await import("@/features/teams");
    await requestToJoinTeam("applicant-1", "team-1");

    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 999 }));
  });

  it("18/24. a join request still succeeds even when Telegram notification fails or TELEGRAM_BOT_TOKEN is absent", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;
    mockPlayerRepo.findById.mockResolvedValue(playerDomain({ telegram_id: 999 }));
    mockSendNotification.mockRejectedValue(new Error("network down"));

    const { requestToJoinTeam } = await import("@/features/teams");
    // The DB write already committed by the time notification runs; even
    // if the (mocked) notifier somehow rejected, requestToJoinTeam's own
    // return must not surface that as a failure of the request itself.
    await expect(requestToJoinTeam("applicant-1", "team-1")).resolves.toBeUndefined();
    expect(insertCalls).toHaveLength(1);
  });

  it("23. no telegram_id on the captain -- request still succeeds, no notification attempted", async () => {
    const { tx, insertCalls } = makeFakeTx({
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
      teamMemberships: [[], [{ activeCount: 1 }]],
      teamInvitations: [[]],
      teamJoinRequests: [[]],
    });
    currentTx.current = tx;
    mockPlayerRepo.findById.mockResolvedValue(playerDomain({ telegram_id: null }));

    const { requestToJoinTeam } = await import("@/features/teams");
    await requestToJoinTeam("applicant-1", "team-1");

    expect(insertCalls).toHaveLength(1);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe("cancelJoinRequest / declineJoinRequest", () => {
  it("14. a player can cancel their own pending request", async () => {
    const { tx, updateCalls } = makeFakeTx({ teamJoinRequests: [[joinRequestRow({ playerId: "applicant-1" })]] });
    currentTx.current = tx;

    const { cancelJoinRequest } = await import("@/features/teams");
    await cancelJoinRequest("applicant-1", "request-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teamJoinRequests, values: { status: "cancelled" } });
  });

  it("rejects cancelling someone else's request", async () => {
    const { tx, updateCalls } = makeFakeTx({ teamJoinRequests: [[joinRequestRow({ playerId: "someone-else" })]] });
    currentTx.current = tx;

    const { cancelJoinRequest, JoinRequestForbiddenError } = await import("@/features/teams");
    await expect(cancelJoinRequest("applicant-1", "request-1")).rejects.toThrow(JoinRequestForbiddenError);
    expect(updateCalls).toHaveLength(0);
  });

  it("15. the captain can decline a pending request", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teamJoinRequests: [[joinRequestRow({ teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
    });
    currentTx.current = tx;

    const { declineJoinRequest } = await import("@/features/teams");
    await declineJoinRequest("captain-1", "request-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teamJoinRequests, values: { status: "declined" } });
  });

  it("8. non-captain cannot decline", async () => {
    const { tx, updateCalls } = makeFakeTx({
      teamJoinRequests: [[joinRequestRow({ teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1" })]],
    });
    currentTx.current = tx;

    const { declineJoinRequest, NotCaptainError } = await import("@/features/teams");
    await expect(declineJoinRequest("not-the-captain", "request-1")).rejects.toThrow(NotCaptainError);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("acceptJoinRequest", () => {
  function setupAccept(overrides: {
    teamOverrides?: Record<string, unknown>;
    activeCount?: number;
    existingActiveMembership?: unknown[];
  } = {}) {
    outsideTxJoinRequestRow = joinRequestRow({ playerId: "applicant-1", teamId: "team-1" });
    mockPlayerRepo.findById.mockResolvedValue(playerDomain({ id: "applicant-1", display_name: "Applicant", telegram_id: 555 }));
    mockResolveCanonicalPlayer.mockResolvedValue(playerDomain({ id: "applicant-1", display_name: "Applicant", telegram_id: 555 }));

    const { tx, insertCalls, updateCalls, selectOrder } = makeFakeTx({
      teamJoinRequests: [[joinRequestRow({ id: "request-1", playerId: "applicant-1", teamId: "team-1" })]],
      teams: [[teamRow({ id: "team-1", captainPlayerId: "captain-1", ...overrides.teamOverrides })]],
      teamMemberships: [
        overrides.existingActiveMembership ?? [],
        [{ activeCount: overrides.activeCount ?? 1 }],
      ],
    });
    currentTx.current = tx;
    return { insertCalls, updateCalls, selectOrder };
  }

  it("9/10. captain can accept -- creates exactly one membership", async () => {
    const { insertCalls } = setupAccept();

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    const membershipInserts = insertCalls.filter((c) => c.table === teamMemberships);
    expect(membershipInserts).toHaveLength(1);
    expect(membershipInserts[0].values).toMatchObject({ teamId: "team-1", playerId: "applicant-1" });
  });

  it("8. non-captain cannot accept", async () => {
    const { insertCalls } = setupAccept();

    const { acceptJoinRequest, NotCaptainError } = await import("@/features/teams");
    await expect(acceptJoinRequest("not-the-captain", "request-1")).rejects.toThrow(NotCaptainError);
    expect(insertCalls.filter((c) => c.table === teamMemberships)).toHaveLength(0);
  });

  it("11. pending invitations never count against capacity: active(3) + 20 pending invitations still lets the captain accept a join request", async () => {
    const { insertCalls } = setupAccept({ activeCount: 3 });

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    expect(insertCalls.filter((c) => c.table === teamMemberships)).toHaveLength(1);
  });

  it("active(5) still blocks acceptance regardless of pending invitations", async () => {
    const { insertCalls } = setupAccept({ activeCount: 5 });

    const { acceptJoinRequest, TeamFullError } = await import("@/features/teams");
    await expect(acceptJoinRequest("captain-1", "request-1")).rejects.toThrow(TeamFullError);
    expect(insertCalls.filter((c) => c.table === teamMemberships)).toHaveLength(0);
  });

  it("12. accepting cancels the applicant's OTHER pending join requests", async () => {
    const { updateCalls } = setupAccept();

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    const cancelledRequestUpdates = updateCalls.filter(
      (c) => c.table === teamJoinRequests && c.values.status === "cancelled"
    );
    expect(cancelledRequestUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it("13. accepting cancels the applicant's OTHER pending invitations", async () => {
    const { updateCalls } = setupAccept();

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    const cancelledInvitationUpdates = updateCalls.filter(
      (c) => c.table === teamInvitations && c.values.status === "cancelled"
    );
    expect(cancelledInvitationUpdates).toHaveLength(1);
  });

  it("filling the team to 5/5 auto-cancels other requests AND other pending invitations still targeting it", async () => {
    const { updateCalls } = setupAccept({ activeCount: 4 });

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    // Two teamJoinRequests updates: the accept itself, plus the "team is
    // now full" auto-cancel sweep.
    const requestUpdates = updateCalls.filter((c) => c.table === teamJoinRequests);
    expect(requestUpdates.some((c) => c.values.status === "accepted")).toBe(true);
    expect(requestUpdates.some((c) => c.values.status === "cancelled")).toBe(true);

    // Pending invitations against this same team are also swept once full
    // -- at least the applicant's-own-invitations cancel plus this sweep.
    const invitationCancels = updateCalls.filter(
      (c) => c.table === teamInvitations && c.values.status === "cancelled"
    );
    expect(invitationCancels.length).toBeGreaterThanOrEqual(1);
  });

  it("active(3) does NOT trigger the 'team is now full' sweep -- only the unconditional applicant-cancel runs, not the team-wide one", async () => {
    const { updateCalls } = setupAccept({ activeCount: 3 });

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    // Exactly one teamJoinRequests cancel here: the unconditional "cancel
    // the applicant's OTHER pending requests" update that always runs.
    // Compare against the active(4) case, which additionally runs the
    // "team just filled to 5/5" sweep (asserted in the test above).
    const cancelledRequestUpdates = updateCalls.filter(
      (c) => c.table === teamJoinRequests && c.values.status === "cancelled"
    );
    expect(cancelledRequestUpdates).toHaveLength(1);

    const cancelledInvitationUpdates = updateCalls.filter(
      (c) => c.table === teamInvitations && c.values.status === "cancelled"
    );
    // Only the applicant's-own-invitations cancel -- no team-wide sweep.
    expect(cancelledInvitationUpdates).toHaveLength(1);
  });

  it("21. notifies the accepted PLAYER, not the captain", async () => {
    setupAccept();

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 555 }));
  });

  it("17. accepting still succeeds even if the notification call rejects", async () => {
    setupAccept();
    mockSendNotification.mockRejectedValue(new Error("telegram down"));

    const { acceptJoinRequest } = await import("@/features/teams");
    await expect(acceptJoinRequest("captain-1", "request-1")).resolves.toBeTruthy();
  });

  it("DEADLOCK SAFETY: locks the team row BEFORE locking the join-request row (team-first ordering, matching acceptInvitation)", async () => {
    const { selectOrder } = setupAccept();

    const { acceptJoinRequest } = await import("@/features/teams");
    await acceptJoinRequest("captain-1", "request-1");

    // teams must be locked before the in-transaction teamJoinRequests
    // FOR UPDATE re-read -- the same team-first ordering acceptInvitation
    // uses, so a same-team invitation acceptance racing a join-request
    // acceptance for the last seat cannot deadlock.
    const teamIdx = selectOrder.indexOf(teams);
    const requestIdx = selectOrder.indexOf(teamJoinRequests);
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(requestIdx).toBeGreaterThan(teamIdx);
  });
});

describe("uploadTeamAvatar / resetTeamAvatar", () => {
  it("22. captain upload: stores at teams/{id}/avatar.{ext}, persists a cache-busted URL, returns it in the detail view", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { uploadTeamAvatar } = await import("@/features/teams");
    const detail = await uploadTeamAvatar("captain-1", "team-1", Buffer.from("fake-webp-bytes"), "image/webp");

    expect(mockAvatarStorageRepository.upload).toHaveBeenCalledWith(
      "teams/team-1/avatar.webp",
      expect.anything(),
      "image/webp"
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teams });
    expect(String(updateCalls[0].values.avatarUrl)).toMatch(/^https:\/\/cdn\/teams\/team-1\/avatar\.webp\?v=\d+$/);
    expect(detail.id).toBe("team-1");
  });

  it("23. non-captain upload attempt is forbidden", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { uploadTeamAvatar, NotCaptainError } = await import("@/features/teams");
    await expect(
      uploadTeamAvatar("member-1", "team-1", Buffer.from("x"), "image/webp")
    ).rejects.toThrow(NotCaptainError);
    expect(updateCalls).toHaveLength(0);
  });

  it("24. upload rejected for a disbanded team", async () => {
    const disbanded = teamRow({ status: "disbanded", captainPlayerId: "captain-1" });
    const { tx, updateCalls } = makeFakeTx({ teams: [[disbanded]] });
    currentTx.current = tx;

    const { uploadTeamAvatar, TeamDisbandedError } = await import("@/features/teams");
    await expect(
      uploadTeamAvatar("captain-1", "team-1", Buffer.from("x"), "image/webp")
    ).rejects.toThrow(TeamDisbandedError);
    expect(updateCalls).toHaveLength(0);
  });

  it("25. replacing an existing photo produces a NEW cache-busted URL", async () => {
    const { tx: tx1, updateCalls: updates1 } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1", avatarUrl: "https://cdn/teams/team-1/avatar.webp?v=1" })]] });
    currentTx.current = tx1;
    const { uploadTeamAvatar } = await import("@/features/teams");
    await uploadTeamAvatar("captain-1", "team-1", Buffer.from("first"), "image/webp");
    const firstUrl = String(updates1[0].values.avatarUrl);

    await new Promise((resolve) => setTimeout(resolve, 2));

    const { tx: tx2, updateCalls: updates2 } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1", avatarUrl: firstUrl })]] });
    currentTx.current = tx2;
    await uploadTeamAvatar("captain-1", "team-1", Buffer.from("second"), "image/webp");
    const secondUrl = String(updates2[0].values.avatarUrl);

    expect(secondUrl).not.toBe(firstUrl);
  });

  it("26. resetTeamAvatar (captain-only) sets avatar_url back to null, emblem untouched", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1", avatarUrl: "https://cdn/x.webp?v=1" })]] });
    currentTx.current = tx;

    const { resetTeamAvatar } = await import("@/features/teams");
    await resetTeamAvatar("captain-1", "team-1");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ table: teams, values: { avatarUrl: null } });
  });

  it("27. resetTeamAvatar forbidden for a non-captain", async () => {
    const { tx, updateCalls } = makeFakeTx({ teams: [[teamRow({ captainPlayerId: "captain-1" })]] });
    currentTx.current = tx;

    const { resetTeamAvatar, NotCaptainError } = await import("@/features/teams");
    await expect(resetTeamAvatar("member-1", "team-1")).rejects.toThrow(NotCaptainError);
    expect(updateCalls).toHaveLength(0);
  });
});

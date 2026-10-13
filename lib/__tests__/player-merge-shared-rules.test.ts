import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { players } from "@/lib/db/schema";

// Shared merge rules introduced with the Super-Admin Merge Center that also
// apply to the self-service flow: the no-show restriction reconciliation
// and the blocked-source moderation guard. Same fake-executor technique as
// player-merge.test.ts (which stays untouched and must keep passing as-is).

const { mockTxTarget } = vi.hoisted(() => ({ mockTxTarget: { current: null as unknown } }));

vi.mock("@/lib/db", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(mockTxTarget.current) },
}));
vi.mock("@/features/achievements", () => ({ syncPlayerAchievements: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  playerMergeIntentRepository: { create: vi.fn(), findById: vi.fn(), listConflicts: vi.fn() },
}));

const TARGET_ID = "00000000-0000-0000-0000-000000000001";
const SOURCE_ID = "00000000-0000-0000-0000-000000000002";
const NO_OVERLAP_TABLES = [[], [], [], [], [], []];

function playerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    telegramId: null,
    email: null,
    role: "player",
    isBlocked: false,
    referralCount: 0,
    freeReentriesBalance: 0,
    yandexReviewBonusClaimed: false,
    onlineRegistrationRestrictedAt: null,
    mergedIntoPlayerId: null,
    ...overrides,
  };
}

function makeFakeExecutor(selectResponses: unknown[][]) {
  let selectIndex = 0;
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const executor = {
    select: () => {
      const result = Promise.resolve(selectResponses[selectIndex++] ?? []);
      return {
        from: () => ({
          where: () => Object.assign(result, { limit: () => result, for: () => result }),
        }),
      };
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
  return { executor, updateCalls };
}

describe("mergeOnlineRegistrationRestriction", () => {
  const older = new Date("2026-08-01T00:00:00Z");
  const newer = new Date("2026-09-01T00:00:00Z");

  it("neither -> null; exactly one -> that one; both -> the more recent", async () => {
    const { mergeOnlineRegistrationRestriction } = await import("@/lib/player-merge");
    expect(mergeOnlineRegistrationRestriction(null, null)).toBeNull();
    expect(mergeOnlineRegistrationRestriction(undefined, undefined)).toBeNull();
    expect(mergeOnlineRegistrationRestriction(null, older)).toBe(older);
    expect(mergeOnlineRegistrationRestriction(older, null)).toBe(older);
    expect(mergeOnlineRegistrationRestriction(older, newer)).toBe(newer);
    expect(mergeOnlineRegistrationRestriction(newer, older)).toBe(newer);
  });
});

describe("checkMergeEligibility -- blocked-source moderation guard (self-service)", () => {
  it("blocked source into an unblocked target -> ineligible with the shared reason, before any overlap query", async () => {
    const { executor } = makeFakeExecutor([
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID, isBlocked: true })],
    ]);
    const { checkMergeEligibility, SOURCE_BLOCKED_REASON } = await import("@/lib/player-merge");

    expect(await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never)).toEqual({
      eligible: false,
      reason: SOURCE_BLOCKED_REASON,
    });
  });

  it("blocked target (source clean) and both-blocked stay eligible -- target keeps its own block", async () => {
    const { checkMergeEligibility } = await import("@/lib/player-merge");

    for (const [targetBlocked, sourceBlocked] of [
      [true, false],
      [true, true],
    ]) {
      const { executor } = makeFakeExecutor([
        [playerRow({ id: TARGET_ID, isBlocked: targetBlocked })],
        [playerRow({ id: SOURCE_ID, isBlocked: sourceBlocked })],
        ...NO_OVERLAP_TABLES,
        ...NO_OVERLAP_TABLES,
      ]);
      expect(await checkMergeEligibility(TARGET_ID, SOURCE_ID, executor as never)).toEqual({ eligible: true });
    }
  });
});

describe("executeMerge (self-service) -- no-show restriction survives", () => {
  beforeEach(() => {
    process.env.DATABASE_PROVIDER = "postgres";
  });
  afterEach(() => {
    delete process.env.DATABASE_PROVIDER;
    mockTxTarget.current = null;
  });

  function selects(targetRestrictedAt: Date | null, sourceRestrictedAt: Date | null) {
    return [
      [
        {
          id: "intent-1",
          targetPlayerId: TARGET_ID,
          sourcePlayerId: SOURCE_ID,
          email: "found@example.com",
          status: "pending",
          expiresAt: new Date(Date.now() + 600_000),
        },
      ],
      [playerRow({ id: TARGET_ID, onlineRegistrationRestrictedAt: targetRestrictedAt })],
      [playerRow({ id: SOURCE_ID, onlineRegistrationRestrictedAt: sourceRestrictedAt })],
      [playerRow({ id: TARGET_ID })],
      [playerRow({ id: SOURCE_ID })],
      ...NO_OVERLAP_TABLES,
      ...NO_OVERLAP_TABLES,
      [],
      [],
      [],
      [],
    ];
  }

  it("restricted source -> target patch carries the restriction", async () => {
    const restrictedAt = new Date("2026-09-10T00:00:00Z");
    const { executor, updateCalls } = makeFakeExecutor(selects(null, restrictedAt));
    mockTxTarget.current = executor;
    const { executeMerge } = await import("@/lib/player-merge");

    expect(await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID })).toEqual({ merged: true });

    const targetPatch = updateCalls.find((c) => c.table === players && "referralCount" in c.values);
    expect(targetPatch?.values.onlineRegistrationRestrictedAt).toBe(restrictedAt);
  });

  it("neither restricted -> the target patch is exactly what it always was (no restriction key written)", async () => {
    const { executor, updateCalls } = makeFakeExecutor(selects(null, null));
    mockTxTarget.current = executor;
    const { executeMerge } = await import("@/lib/player-merge");

    await executeMerge({ intentId: "intent-1", sessionPlayerId: TARGET_ID });

    const targetPatch = updateCalls.find((c) => c.table === players && "referralCount" in c.values);
    expect(Object.keys(targetPatch?.values ?? {}).sort()).toEqual(
      ["email", "freeReentriesBalance", "referralCount", "yandexReviewBonusClaimed"].sort()
    );
  });
});

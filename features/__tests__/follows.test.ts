import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

// Domain rules of features/follows.ts over a mocked data boundary. DB-level
// invariants (unique pair, CHECK, cascade, ordering) are proven against real
// Postgres in lib/repositories/follow/__tests__/follow-postgres.integration.test.ts.

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  countFollowers: vi.fn(),
  countFollowing: vi.fn(),
  listFollowers: vi.fn(),
  listFollowing: vi.fn(),
  listFollowingIds: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById },
  followRepository: {
    create: mocks.create,
    delete: mocks.delete,
    exists: mocks.exists,
    countFollowers: mocks.countFollowers,
    countFollowing: mocks.countFollowing,
    listFollowers: mocks.listFollowers,
    listFollowing: mocks.listFollowing,
    listFollowingIds: mocks.listFollowingIds,
  },
}));

const features = await import("@/features/follows");
const {
  followPlayer,
  unfollowPlayer,
  getFollowSummary,
  listFollowers,
  listFollowing,
  listFollowingIds,
  normalizeListQuery,
  parseIntegerQueryParam,
  InvalidFollowPlayerIdError,
  SelfFollowError,
  FollowTargetNotFoundError,
  FollowTargetMergedError,
  FollowFailedError,
  UnfollowFailedError,
  FollowSummaryFailedError,
  FollowListFailedError,
} = features;

const VIEWER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

const viewer = player(VIEWER_ID);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.findById.mockResolvedValue(player(TARGET_ID));
  mocks.create.mockResolvedValue(undefined);
  mocks.delete.mockResolvedValue(undefined);
  mocks.exists.mockResolvedValue(false);
  mocks.countFollowers.mockResolvedValue(0);
  mocks.countFollowing.mockResolvedValue(0);
  mocks.listFollowers.mockResolvedValue([]);
  mocks.listFollowing.mockResolvedValue([]);
  mocks.listFollowingIds.mockResolvedValue([]);
});

function expectNoRepositoryCalls() {
  for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
}

describe("followPlayer", () => {
  it("rejects a malformed target id before touching any repository", async () => {
    for (const bad of ["not-a-uuid", "", "1234", `${TARGET_ID}x`, "'; DROP TABLE follows;--"]) {
      await expect(followPlayer(viewer, bad)).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    }
    expectNoRepositoryCalls();
  });

  it("rejects following yourself and never touches the repositories", async () => {
    await expect(followPlayer(viewer, VIEWER_ID)).rejects.toBeInstanceOf(SelfFollowError);
    await expect(followPlayer(viewer, VIEWER_ID)).rejects.toThrow("Нельзя подписаться на самого себя");
    expectNoRepositoryCalls();
  });

  it("an upper-case spelling of your own id is still a self-follow", async () => {
    await expect(followPlayer(viewer, VIEWER_ID.toUpperCase())).rejects.toBeInstanceOf(SelfFollowError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("404-class error when the target does not exist, and nothing is written", async () => {
    mocks.findById.mockResolvedValue(null);

    await expect(followPlayer(viewer, TARGET_ID)).rejects.toBeInstanceOf(FollowTargetNotFoundError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a merged-away target with the merge message and writes nothing", async () => {
    mocks.findById.mockResolvedValue(player(TARGET_ID, { merged_into_player_id: "someone-else" }));

    await expect(followPlayer(viewer, TARGET_ID)).rejects.toBeInstanceOf(FollowTargetMergedError);
    await expect(followPlayer(viewer, TARGET_ID)).rejects.toThrow("Аккаунт был объединён. Обновите страницу.");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("a BLOCKED target is followable", async () => {
    mocks.findById.mockResolvedValue(player(TARGET_ID, { is_blocked: true }));

    await expect(followPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: true });
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it.each([
    ["operator", { role: "operator" as const }],
    ["admin", { role: "admin" as const }],
    ["manual/offline player (no telegram, no email)", { telegram_id: null, email: null }],
  ])("a %s target is followable", async (_label, overrides) => {
    mocks.findById.mockResolvedValue(player(TARGET_ID, overrides));

    await expect(followPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: true });
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("the follower id is the viewer's, the followed id is the (normalized) target", async () => {
    await followPlayer(viewer, TARGET_ID.toUpperCase());

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
  });

  it("repeat follow succeeds every time (idempotent, no conflict error)", async () => {
    await expect(followPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: true });
    await expect(followPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("returns fresh canonical counts of the TARGET, read after the write", async () => {
    const order: string[] = [];
    mocks.create.mockImplementation(async () => {
      order.push("create");
    });
    mocks.countFollowers.mockImplementation(async (id: string) => {
      order.push(`followers:${id}`);
      return 7;
    });
    mocks.countFollowing.mockImplementation(async (id: string) => {
      order.push(`following:${id}`);
      return 3;
    });

    const result = await followPlayer(viewer, TARGET_ID);

    expect(result).toEqual({ following: true, followers: 7, following_count: 3 });
    expect(order[0]).toBe("create");
    expect(order).toContain(`followers:${TARGET_ID}`);
    expect(order).toContain(`following:${TARGET_ID}`);
    expect(order).not.toContain(`followers:${VIEWER_ID}`);
  });

  it("wraps repository failures in a generic error without leaking the DB text", async () => {
    mocks.create.mockRejectedValue(new Error('insert or update on table "follows" violates foreign key'));

    const error = await followPlayer(viewer, TARGET_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FollowFailedError);
    expect((error as Error).message).toBe("Не удалось подписаться. Попробуйте ещё раз.");
    expect(console.error).toHaveBeenCalled();
  });

  it("a failing target lookup is also wrapped (raw DB text never escapes)", async () => {
    mocks.findById.mockRejectedValue(new Error("Failed to fetch player: invalid input syntax for type uuid"));

    const error = await followPlayer(viewer, TARGET_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FollowFailedError);
    expect((error as Error).message).not.toMatch(/invalid input/i);
  });
});

describe("unfollowPlayer", () => {
  it("rejects a malformed target id before touching any repository", async () => {
    await expect(unfollowPlayer(viewer, "nope")).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    expectNoRepositoryCalls();
  });

  it("deletes the edge viewer -> target and returns the target's fresh counts", async () => {
    mocks.countFollowers.mockResolvedValue(4);
    mocks.countFollowing.mockResolvedValue(9);

    const result = await unfollowPlayer(viewer, TARGET_ID);

    expect(mocks.delete).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
    expect(mocks.countFollowers).toHaveBeenCalledWith(TARGET_ID);
    expect(mocks.countFollowing).toHaveBeenCalledWith(TARGET_ID);
    expect(result).toEqual({ following: false, followers: 4, following_count: 9 });
  });

  it("does not require the target to exist (Sterling parity)", async () => {
    mocks.findById.mockResolvedValue(null);

    await expect(unfollowPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: false });
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("repeat unfollow of a missing edge succeeds", async () => {
    await expect(unfollowPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: false });
    await expect(unfollowPlayer(viewer, TARGET_ID)).resolves.toMatchObject({ following: false });
  });

  it("wraps repository failures in a generic error", async () => {
    mocks.delete.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const error = await unfollowPlayer(viewer, TARGET_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnfollowFailedError);
    expect((error as Error).message).toBe("Не удалось отписаться. Попробуйте ещё раз.");
  });
});

describe("getFollowSummary", () => {
  it("rejects a malformed id before touching any repository", async () => {
    await expect(getFollowSummary("nope", viewer)).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    expectNoRepositoryCalls();
  });

  it("anonymous viewer: public counts, isFollowing is false and exists() is never called", async () => {
    mocks.countFollowers.mockResolvedValue(5);
    mocks.countFollowing.mockResolvedValue(2);

    const summary = await getFollowSummary(TARGET_ID, null);

    expect(summary).toEqual({ followers: 5, following: 2, isFollowing: false });
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("own profile: isFollowing is false and exists() is never called", async () => {
    const summary = await getFollowSummary(VIEWER_ID, viewer);

    expect(summary.isFollowing).toBe(false);
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it("authenticated viewer on another player's profile asks the repository about the exact edge", async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.countFollowers.mockResolvedValue(1);

    const summary = await getFollowSummary(TARGET_ID, viewer);

    expect(mocks.exists).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID);
    expect(summary).toEqual({ followers: 1, following: 0, isFollowing: true });
  });

  it("a counts failure nulls only that count", async () => {
    mocks.countFollowers.mockRejectedValue(new Error("boom"));
    mocks.countFollowing.mockResolvedValue(6);
    mocks.exists.mockResolvedValue(true);

    expect(await getFollowSummary(TARGET_ID, viewer)).toEqual({ followers: null, following: 6, isFollowing: true });

    mocks.countFollowers.mockResolvedValue(8);
    mocks.countFollowing.mockRejectedValue(new Error("boom"));

    expect(await getFollowSummary(TARGET_ID, viewer)).toEqual({ followers: 8, following: null, isFollowing: true });
  });

  it("an exists failure gives isFollowing null (never a pretend false) and keeps the counts", async () => {
    mocks.countFollowers.mockResolvedValue(3);
    mocks.countFollowing.mockResolvedValue(4);
    mocks.exists.mockRejectedValue(new Error("boom"));

    expect(await getFollowSummary(TARGET_ID, viewer)).toEqual({ followers: 3, following: 4, isFollowing: null });
  });

  it("both counts failing while exists succeeded still returns the part that works", async () => {
    mocks.countFollowers.mockRejectedValue(new Error("boom"));
    mocks.countFollowing.mockRejectedValue(new Error("boom"));
    mocks.exists.mockResolvedValue(true);

    expect(await getFollowSummary(TARGET_ID, viewer)).toEqual({ followers: null, following: null, isFollowing: true });
  });

  it("throws the generic summary error only when EVERY attempted operation failed", async () => {
    mocks.countFollowers.mockRejectedValue(new Error("db down"));
    mocks.countFollowing.mockRejectedValue(new Error("db down"));
    mocks.exists.mockRejectedValue(new Error("db down"));

    const error = await getFollowSummary(TARGET_ID, viewer).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FollowSummaryFailedError);
    expect((error as Error).message).not.toMatch(/db down/);
    expect(console.error).toHaveBeenCalled();
  });

  it("anonymous with both counts failing is a total failure (exists was never attempted)", async () => {
    mocks.countFollowers.mockRejectedValue(new Error("db down"));
    mocks.countFollowing.mockRejectedValue(new Error("db down"));

    await expect(getFollowSummary(TARGET_ID, null)).rejects.toBeInstanceOf(FollowSummaryFailedError);
  });
});

describe("lists", () => {
  const item = {
    id: TARGET_ID,
    display_name: "Alex",
    telegram_avatar_url: "https://example.com/a.png",
    custom_avatar_url: null,
  };

  it("listFollowers passes through repository pagination and returns total", async () => {
    mocks.listFollowers.mockResolvedValue([item]);
    mocks.countFollowers.mockResolvedValue(41);

    const page = await listFollowers(TARGET_ID, { limit: 10, offset: 20 });

    expect(mocks.listFollowers).toHaveBeenCalledWith(TARGET_ID, 10, 20);
    expect(page).toEqual({ items: [item], total: 41 });
  });

  it("listFollowing passes through repository pagination and returns total", async () => {
    mocks.listFollowing.mockResolvedValue([item]);
    mocks.countFollowing.mockResolvedValue(12);

    const page = await listFollowing(TARGET_ID, { limit: 5, offset: 0 });

    expect(mocks.listFollowing).toHaveBeenCalledWith(TARGET_ID, 5, 0);
    expect(page).toEqual({ items: [item], total: 12 });
  });

  it("an unknown but valid player id yields an empty page, not an error", async () => {
    expect(await listFollowers(TARGET_ID)).toEqual({ items: [], total: 0 });
    expect(await listFollowing(TARGET_ID)).toEqual({ items: [], total: 0 });
  });

  it("defaults to limit 50 / offset 0", async () => {
    await listFollowers(TARGET_ID);

    expect(mocks.listFollowers).toHaveBeenCalledWith(TARGET_ID, 50, 0);
  });

  it("never exposes anything beyond the four public fields, even if the repository over-selects", async () => {
    mocks.listFollowers.mockResolvedValue([
      { ...item, username: "secret_handle", email: "secret@example.com", telegram_id: 42 },
    ]);

    const page = await listFollowers(TARGET_ID);

    expect(Object.keys(page.items[0]).sort()).toEqual([
      "custom_avatar_url",
      "display_name",
      "id",
      "telegram_avatar_url",
    ]);
    expect(JSON.stringify(page)).not.toContain("secret");
  });

  it("rejects a malformed id before touching any repository", async () => {
    await expect(listFollowers("nope")).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    await expect(listFollowing("nope")).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    expectNoRepositoryCalls();
  });

  it("wraps repository failures in the generic list error", async () => {
    mocks.listFollowers.mockRejectedValue(new Error("relation follows does not exist"));
    mocks.countFollowing.mockRejectedValue(new Error("relation follows does not exist"));

    const first = await listFollowers(TARGET_ID).catch((e: unknown) => e);
    const second = await listFollowing(TARGET_ID).catch((e: unknown) => e);

    expect(first).toBeInstanceOf(FollowListFailedError);
    expect(second).toBeInstanceOf(FollowListFailedError);
    expect((first as Error).message).not.toMatch(/relation/);
  });
});

describe("listFollowingIds", () => {
  it("passes every id through, with no page cap", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    mocks.listFollowingIds.mockResolvedValue(ids);

    const result = await listFollowingIds(TARGET_ID);

    expect(mocks.listFollowingIds).toHaveBeenCalledWith(TARGET_ID);
    expect(result).toHaveLength(300);
  });

  it("an unknown but valid id yields []", async () => {
    expect(await listFollowingIds(TARGET_ID)).toEqual([]);
  });

  it("rejects a malformed id before touching the repository", async () => {
    await expect(listFollowingIds("nope")).rejects.toBeInstanceOf(InvalidFollowPlayerIdError);
    expectNoRepositoryCalls();
  });

  it("wraps repository failures in the generic list error", async () => {
    mocks.listFollowingIds.mockRejectedValue(new Error("boom"));

    await expect(listFollowingIds(TARGET_ID)).rejects.toBeInstanceOf(FollowListFailedError);
  });
});

describe("pagination parsing", () => {
  it("normalizeListQuery defaults, clamps and ignores junk", () => {
    expect(normalizeListQuery()).toEqual({ limit: 50, offset: 0 });
    expect(normalizeListQuery({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(normalizeListQuery({ limit: 1 })).toEqual({ limit: 1, offset: 0 });
    expect(normalizeListQuery({ limit: 100 })).toEqual({ limit: 100, offset: 0 });
    expect(normalizeListQuery({ limit: 101 })).toEqual({ limit: 100, offset: 0 });
    expect(normalizeListQuery({ limit: 10_000, offset: 30 })).toEqual({ limit: 100, offset: 30 });
    expect(normalizeListQuery({ limit: Number.NaN, offset: Number.NaN })).toEqual({ limit: 50, offset: 0 });
    expect(normalizeListQuery({ limit: 2.5, offset: 1.5 })).toEqual({ limit: 50, offset: 0 });
    expect(normalizeListQuery({ limit: Number.POSITIVE_INFINITY })).toEqual({ limit: 50, offset: 0 });
    expect(normalizeListQuery({ offset: -5 })).toEqual({ limit: 50, offset: 0 });
    expect(normalizeListQuery({ limit: null, offset: null })).toEqual({ limit: 50, offset: 0 });
  });

  it("parseIntegerQueryParam accepts only plain non-negative integer strings", () => {
    expect(parseIntegerQueryParam("25")).toBe(25);
    expect(parseIntegerQueryParam("0")).toBe(0);
    for (const bad of [null, undefined, "", "abc", "-3", "2.5", "1e3", " 5", "5 ", "0x10", "1234567890123456"]) {
      expect(parseIntegerQueryParam(bad)).toBeUndefined();
    }
  });
});

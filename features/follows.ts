import "server-only";

import { followRepository, playerRepository } from "@/lib/repositories";
import type { FollowPlayerSummary } from "@/lib/repositories";
import { isUuid } from "@/lib/uuid";
import type { Player } from "@/types/domain";

// Player following -- domain rules on top of followRepository. Plain
// server-side module (NOT a Server Action file): transport is the route
// handlers under app/api/players/[id]/. The acting viewer is always a
// parameter resolved server-side by lib/follows-auth.ts -- no function here
// ever takes a follower id from a client.
//
// Unknown/DB failures never leak: each public function catches, logs the real
// error server-side and throws one of the fixed-message errors below.

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

export class InvalidFollowPlayerIdError extends Error {
  constructor(message = "Некорректный идентификатор игрока") {
    super(message);
    this.name = "InvalidFollowPlayerIdError";
  }
}

export class SelfFollowError extends Error {
  constructor(message = "Нельзя подписаться на самого себя") {
    super(message);
    this.name = "SelfFollowError";
  }
}

export class FollowTargetNotFoundError extends Error {
  constructor(message = "Игрок не найден") {
    super(message);
    this.name = "FollowTargetNotFoundError";
  }
}

// A merged-away player row is a dead identity (see lib/player-merge.ts); it
// must not receive new edges. Same wording as assertPlayerActive.
export class FollowTargetMergedError extends Error {
  constructor(message = "Аккаунт был объединён. Обновите страницу.") {
    super(message);
    this.name = "FollowTargetMergedError";
  }
}

export class FollowFailedError extends Error {
  constructor(message = "Не удалось подписаться. Попробуйте ещё раз.") {
    super(message);
    this.name = "FollowFailedError";
  }
}

export class UnfollowFailedError extends Error {
  constructor(message = "Не удалось отписаться. Попробуйте ещё раз.") {
    super(message);
    this.name = "UnfollowFailedError";
  }
}

export class FollowSummaryFailedError extends Error {
  constructor(message = "Не удалось загрузить данные подписок. Попробуйте ещё раз.") {
    super(message);
    this.name = "FollowSummaryFailedError";
  }
}

export class FollowListFailedError extends Error {
  constructor(message = "Не удалось загрузить список. Попробуйте ещё раз.") {
    super(message);
    this.name = "FollowListFailedError";
  }
}

export type FollowSummary = {
  followers: number | null;
  following: number | null;
  // null = "could not be determined" (distinct from false); never guessed.
  isFollowing: boolean | null;
};

export type FollowMutationResult = {
  following: boolean;
  // Fresh canonical counts of the TARGET player, read after the write.
  followers: number;
  following_count: number;
};

export type FollowListPage = {
  items: FollowPlayerSummary[];
  total: number;
};

export type FollowListQuery = {
  limit?: number | null;
  offset?: number | null;
};

function logServerError(context: string, error: unknown): void {
  console.error(`[features/follows] ${context} failed:`, error);
}

// Validates (before any query) and lower-cases, so the viewer.id === target
// comparison below can't be dodged by an upper-case spelling of the same uuid.
function parsePlayerId(value: unknown): string {
  if (!isUuid(value)) {
    throw new InvalidFollowPlayerIdError();
  }
  return value.toLowerCase();
}

function isDomainError(error: unknown): boolean {
  return (
    error instanceof InvalidFollowPlayerIdError ||
    error instanceof SelfFollowError ||
    error instanceof FollowTargetNotFoundError ||
    error instanceof FollowTargetMergedError
  );
}

// Pure + exported for the routes: limit defaults to 50 and is clamped to
// 1..100; offset defaults to 0 and is never negative. Missing/NaN/non-integer
// input falls back to the default instead of erroring.
export function normalizeListQuery(query: FollowListQuery = {}): { limit: number; offset: number } {
  const rawLimit = query.limit;
  const rawOffset = query.offset;

  const limit =
    typeof rawLimit === "number" && Number.isSafeInteger(rawLimit)
      ? Math.min(MAX_LIST_LIMIT, Math.max(1, rawLimit))
      : DEFAULT_LIST_LIMIT;
  const offset =
    typeof rawOffset === "number" && Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  return { limit, offset };
}

// Strict query-string parsing: only plain non-negative integer strings count;
// anything else ("abc", "-3", "2.5", "") is "malformed" => undefined => default.
export function parseIntegerQueryParam(value: string | null | undefined): number | undefined {
  if (value == null || !/^\d{1,15}$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

// Public counts + (optionally) the viewer's own relationship. Each part
// degrades independently; the whole call only fails when every operation that
// was actually attempted failed.
export async function getFollowSummary(playerId: string, viewer: Player | null): Promise<FollowSummary> {
  const id = parsePlayerId(playerId);

  // Anonymous viewers and the owner of the profile never follow themselves:
  // a definite false, no query.
  const needsExistsCheck = viewer !== null && viewer.id.toLowerCase() !== id;

  const [followersResult, followingResult, existsResult] = await Promise.allSettled([
    followRepository.countFollowers(id),
    followRepository.countFollowing(id),
    needsExistsCheck ? followRepository.exists(viewer.id, id) : Promise.resolve(false),
  ]);

  if (followersResult.status === "rejected") logServerError("countFollowers", followersResult.reason);
  if (followingResult.status === "rejected") logServerError("countFollowing", followingResult.reason);
  if (existsResult.status === "rejected") logServerError("exists", existsResult.reason);

  const attempted = needsExistsCheck ? 3 : 2;
  const failed =
    Number(followersResult.status === "rejected") +
    Number(followingResult.status === "rejected") +
    Number(needsExistsCheck && existsResult.status === "rejected");

  if (failed === attempted) {
    throw new FollowSummaryFailedError();
  }

  return {
    followers: followersResult.status === "fulfilled" ? followersResult.value : null,
    following: followingResult.status === "fulfilled" ? followingResult.value : null,
    isFollowing: existsResult.status === "fulfilled" ? existsResult.value : null,
  };
}

export async function followPlayer(viewer: Player, targetPlayerId: string): Promise<FollowMutationResult> {
  const targetId = parsePlayerId(targetPlayerId);

  if (viewer.id.toLowerCase() === targetId) {
    throw new SelfFollowError();
  }

  try {
    const target = await playerRepository.findById(targetId);
    if (!target) {
      throw new FollowTargetNotFoundError();
    }
    if (target.merged_into_player_id != null) {
      throw new FollowTargetMergedError();
    }
    // Blocked, staff and manual/offline targets are all deliberately allowed.

    // Idempotent in the repository (ON CONFLICT DO NOTHING): re-following an
    // existing edge is a success, never a conflict.
    await followRepository.create(viewer.id, targetId);

    const [followers, followingCount] = await Promise.all([
      followRepository.countFollowers(targetId),
      followRepository.countFollowing(targetId),
    ]);
    return { following: true, followers, following_count: followingCount };
  } catch (error) {
    if (isDomainError(error)) throw error;
    // A failed recount after a successful write also lands here; the client
    // may safely retry (the write is idempotent).
    logServerError("followPlayer", error);
    throw new FollowFailedError();
  }
}

export async function unfollowPlayer(viewer: Player, targetPlayerId: string): Promise<FollowMutationResult> {
  const targetId = parsePlayerId(targetPlayerId);

  try {
    // No target-existence / self check (Sterling parity): deleting a missing
    // edge is a successful no-op.
    await followRepository.delete(viewer.id, targetId);

    const [followers, followingCount] = await Promise.all([
      followRepository.countFollowers(targetId),
      followRepository.countFollowing(targetId),
    ]);
    return { following: false, followers, following_count: followingCount };
  } catch (error) {
    logServerError("unfollowPlayer", error);
    throw new UnfollowFailedError();
  }
}

export async function listFollowers(playerId: string, query: FollowListQuery = {}): Promise<FollowListPage> {
  const id = parsePlayerId(playerId);
  const { limit, offset } = normalizeListQuery(query);

  try {
    const [items, total] = await Promise.all([
      followRepository.listFollowers(id, limit, offset),
      followRepository.countFollowers(id),
    ]);
    return { items: items.map(toPublicSummary), total };
  } catch (error) {
    logServerError("listFollowers", error);
    throw new FollowListFailedError();
  }
}

export async function listFollowing(playerId: string, query: FollowListQuery = {}): Promise<FollowListPage> {
  const id = parsePlayerId(playerId);
  const { limit, offset } = normalizeListQuery(query);

  try {
    const [items, total] = await Promise.all([
      followRepository.listFollowing(id, limit, offset),
      followRepository.countFollowing(id),
    ]);
    return { items: items.map(toPublicSummary), total };
  } catch (error) {
    logServerError("listFollowing", error);
    throw new FollowListFailedError();
  }
}

// Every followed id, no page cap -- the season leaderboard filter must never
// silently lose follows beyond a UI page size.
export async function listFollowingIds(playerId: string): Promise<string[]> {
  const id = parsePlayerId(playerId);

  try {
    return await followRepository.listFollowingIds(id);
  } catch (error) {
    logServerError("listFollowingIds", error);
    throw new FollowListFailedError();
  }
}

// Defense in depth for the privacy decision (no username / email / telegram
// id in follow lists): copy exactly the four public fields, so a future
// repository change that over-selects can't leak through the API.
function toPublicSummary(item: FollowPlayerSummary): FollowPlayerSummary {
  return {
    id: item.id,
    display_name: item.display_name,
    telegram_avatar_url: item.telegram_avatar_url,
    custom_avatar_url: item.custom_avatar_url,
  };
}

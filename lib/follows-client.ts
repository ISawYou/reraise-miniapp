import { fetchAdminJson, fetchJsonWithRetry, getAdminHeaders } from "@/lib/client-request";

// Browser-side transport for player following. Every HTTP detail (URLs,
// Telegram initData header, response validation) lives here so
// app/players/[id]/page.tsx only deals with typed results. Deliberately does
// NOT import features/follows.ts (server-only) -- the types below mirror the
// route contracts in app/api/players/[id]/.
//
// Nothing here names a follower: the server derives the acting player from
// the Telegram initData header / session cookie. The player id in the URL is
// always the TARGET (the profile being viewed).

export type FollowSummary = {
  followers: number | null;
  following: number | null;
  // null = the server could not determine the viewer's relationship; the UI
  // must not guess either way.
  isFollowing: boolean | null;
};

export type FollowMutationResult = {
  following: boolean;
  // Fresh canonical counts of the TARGET player, read by the server after the
  // write -- the UI replaces its state with these, never does +1 / -1.
  followers: number;
  following_count: number;
};

// One row of a followers / following list -- exactly the four public fields
// the API returns (no username, email, role or Telegram id).
export type FollowListItem = {
  id: string;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

export type FollowListPage = {
  items: FollowListItem[];
  total: number;
};

export const FOLLOW_LIST_PAGE_SIZE = 50;

const INVALID_RESPONSE_MESSAGE = "Не удалось выполнить запрос";

function followUrl(playerId: string): string {
  return `/api/players/${encodeURIComponent(playerId)}/follow`;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nullableCount(value: unknown): number | null {
  return isCount(value) ? value : null;
}

// GET /api/players/:id/follow-summary -- public counts, optional viewer.
// Goes through fetchAdminJson so the Telegram initData header is sent when
// available: `isFollowing` needs the viewer even where cookies are not
// available (Telegram Web/Desktop). Throws when the response is unusable;
// callers treat any throw as "no follow data" and keep rendering the profile.
export async function fetchFollowSummary(playerId: string): Promise<FollowSummary> {
  const payload = await fetchAdminJson<unknown>(`/api/players/${encodeURIComponent(playerId)}/follow-summary`, {
    cache: "no-store",
  });

  if (typeof payload !== "object" || payload === null) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  const record = payload as Record<string, unknown>;
  const summary: FollowSummary = {
    followers: nullableCount(record.followers),
    following: nullableCount(record.following),
    isFollowing: typeof record.isFollowing === "boolean" ? record.isFollowing : null,
  };

  // A body carrying none of the expected fields (e.g. an unrelated JSON
  // object) is not a summary at all.
  if (!("followers" in record) && !("following" in record) && !("isFollowing" in record)) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return summary;
}

async function mutateFollow(playerId: string, method: "POST" | "DELETE"): Promise<FollowMutationResult> {
  // Retries = 0: fetchJsonWithRetry's default would re-send the request once
  // after ANY failure, including 4xx. The mutations are idempotent so a retry
  // would be harmless, but the user would wait on a doomed request and see the
  // error later; the safe API message should show immediately.
  const payload = await fetchJsonWithRetry<unknown>(
    followUrl(playerId),
    {
      method,
      cache: "no-store",
      // Same header policy as fetchAdminJson (initData inside a Telegram Mini
      // App, nothing -- and no wait -- outside it).
      headers: await getAdminHeaders(),
    },
    0
  );

  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  if (typeof record.following !== "boolean" || !isCount(record.followers) || !isCount(record.following_count)) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return {
    following: record.following,
    followers: record.followers,
    following_count: record.following_count,
  };
}

// POST /api/players/:id/follow -- idempotent.
export function followPlayerRequest(playerId: string): Promise<FollowMutationResult> {
  return mutateFollow(playerId, "POST");
}

// DELETE /api/players/:id/follow -- idempotent.
export function unfollowPlayerRequest(playerId: string): Promise<FollowMutationResult> {
  return mutateFollow(playerId, "DELETE");
}

function nullableUrl(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Strict on what must be there (id, display_name, total), forgiving about
// avatars, and it COPIES only the four public fields: anything else the
// response might carry never reaches the UI.
function parseFollowListPage(payload: unknown): FollowListPage {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.items) || !isCount(record.total) || !Number.isInteger(record.total)) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  const items = record.items.map((raw): FollowListItem => {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof item.id !== "string" || item.id.length === 0 || typeof item.display_name !== "string") {
      throw new Error(INVALID_RESPONSE_MESSAGE);
    }
    return {
      id: item.id,
      display_name: item.display_name,
      telegram_avatar_url: nullableUrl(item.telegram_avatar_url),
      custom_avatar_url: nullableUrl(item.custom_avatar_url),
    };
  });

  return { items, total: record.total };
}

// The list endpoints are PUBLIC (same public-ness as the profile), so this is
// a plain GET: no Telegram initData header, no viewer identity of any kind.
// Default retry policy (one retry) because a read is safe to repeat.
async function fetchFollowListPage(
  kind: "followers" | "following",
  playerId: string,
  limit: number,
  offset: number
): Promise<FollowListPage> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  const payload = await fetchJsonWithRetry<unknown>(
    `/api/players/${encodeURIComponent(playerId)}/${kind}?limit=${limit}&offset=${offset}`,
    { cache: "no-store" }
  );

  return parseFollowListPage(payload);
}

// GET /api/players/:id/followers?limit=&offset= -- newest follower first.
export function fetchFollowers(playerId: string, limit: number, offset: number): Promise<FollowListPage> {
  return fetchFollowListPage("followers", playerId, limit, offset);
}

// GET /api/players/:id/following?limit=&offset= -- newest followed player first.
export function fetchFollowing(playerId: string, limit: number, offset: number): Promise<FollowListPage> {
  return fetchFollowListPage("following", playerId, limit, offset);
}

// GET /api/players/:id/following/ids -- EVERY id the player follows, with no
// page cap (unlike fetchFollowing). Public. The season leaderboard's
// "Подписки" filter uses this so follows beyond a UI page size are never lost.
export async function fetchFollowingIds(playerId: string): Promise<string[]> {
  const payload = await fetchJsonWithRetry<unknown>(`/api/players/${encodeURIComponent(playerId)}/following/ids`, {
    cache: "no-store",
  });

  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  if (!Array.isArray(record.ids) || record.ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return record.ids as string[];
}

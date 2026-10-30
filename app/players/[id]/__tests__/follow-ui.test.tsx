// Player following UI on the profile (Batch C): Follow/Unfollow button + the
// two read-only counters. Renders the REAL profile page and the REAL
// lib/follows-client.ts; only the transport (@/lib/client-request), the
// viewer (@/lib/current-player) and unrelated data sources are mocked, same
// style as team-card.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  params: { id: "other-1" } as { id: string },
  viewer: null as unknown,
  summary: (async () => ({})) as (playerId: string) => Promise<unknown>,
  mutation: (async () => ({})) as (url: string, init?: RequestInit, retries?: number) => Promise<unknown>,
  list: (async () => ({ items: [], total: 0 })) as (url: string, init?: RequestInit) => Promise<unknown>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/features/auth", () => ({
  getPlayerById: (id: string) => Promise.resolve(profilePlayer(id)),
  submitNicknameForModeration: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getMyTournaments: vi.fn().mockResolvedValue([]),
  getPlayedTournamentsCount: vi.fn().mockResolvedValue(0),
  getPlayerHistoryKnockouts: vi.fn().mockResolvedValue(0),
  getPlayerTournamentHistory: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

// The viewer: a Player, or null => resolveCurrentPlayer rejects (anonymous),
// exactly like the real one does without a session.
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () =>
    mocks.viewer ? Promise.resolve(mocks.viewer) : Promise.reject(new Error("Необходимо войти в систему")),
}));

const { fetchAdminJson: mockFetchAdminJson, fetchJsonWithRetry: mockFetchJsonWithRetry } = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  fetchJsonWithRetry: vi.fn(),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: mockFetchAdminJson,
  fetchJsonWithRetry: mockFetchJsonWithRetry,
  getAdminHeaders: async () => ({ "X-Telegram-Init-Data": "signed-init-data" }),
}));

vi.mock("@/lib/telegram", () => ({ getTelegramWebApp: vi.fn(() => null) }));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/tournament-visuals-client", () => ({ fetchTournamentVisualConfigs: vi.fn().mockResolvedValue([]) }));

function profilePlayer(id: string): Player {
  return {
    id,
    telegram_id: 2,
    username: "someone",
    display_name: `Player ${id}`,
    role: "player",
    is_blocked: false,
  } as Player;
}

const VIEWER: Player = {
  id: "viewer-1",
  telegram_id: 1,
  username: "viewer",
  display_name: "Viewer",
  role: "player",
  is_blocked: false,
} as Player;

const { default: PlayerProfilePage } = await import("@/app/players/[id]/page");

let container: HTMLDivElement;
let root: Root;

type Summary = { followers: number | null; following: number | null; isFollowing: boolean | null };

function respondWithSummary(summary: Summary) {
  mocks.summary = async () => summary;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  mocks.params = { id: "other-1" };
  mocks.viewer = VIEWER;
  respondWithSummary({ followers: 4, following: 7, isFollowing: false });
  mocks.mutation = async () => {
    throw new Error("unexpected mutation");
  };

  mockFetchAdminJson.mockReset().mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/follow-summary")) {
      const id = decodeURIComponent(url.split("/api/players/")[1].split("/")[0]);
      return mocks.summary(id);
    }
    return null;
  });
  mocks.list = async () => ({ items: [], total: 0 });
  mockFetchJsonWithRetry.mockReset().mockImplementation((url: string, init?: RequestInit, retries?: number) =>
    /\/(followers|following)\?/.test(url) ? mocks.list(url, init) : mocks.mutation(url, init, retries)
  );
  // The list sheet locks background scroll and restores the offset on close.
  vi.stubGlobal("scrollTo", vi.fn());

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/profile-v2")) {
        const id = url.split("/")[3];
        const own = (mocks.viewer as Player | null)?.id === id;
        return { ok: true, json: async () => ({ mode: own ? "own" : "public", profile: {
          id, display_name: `Player ${id}`, username: "someone", team: null,
          featured_achievement_keys: [], achievements: [], rating: { currentSeason: null, allTime: { points: 0, rank: null } },
          tournaments_played: 0, knockouts: 0, recent_form: [],
          ...(own ? { email: null, free_reentries_balance: 0, created_at: "2025-01-01", dealer: null,
            team_state: { pending_invitations: [], pending_outgoing_join_requests: [] }, upcoming_tournaments: [], registration_counts: {} } : {}),
        } }) } as Response;
      }
      if (typeof url === "string" && url.includes("/rating-summary")) {
        return { ok: true, json: async () => ({ currentSeason: null, allTime: { points: 0, rank: null } }) } as Response;
      }
      if (typeof url === "string" && url.includes("/achievements")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (typeof url === "string" && url.includes("/featured-achievements")) {
        return { ok: true, json: async () => ({ keys: [] }) } as Response;
      }
      if (typeof url === "string" && url === "/api/achievement-visuals") {
        return { ok: true, json: async () => ({ visuals: [] }) } as Response;
      }
      if (typeof url === "string" && url.includes("/api/teams/by-player/")) {
        return { ok: true, json: async () => ({ team: null }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    })
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage() {
  await act(async () => root.render(<PlayerProfilePage />));
  await settle();
}

function followButton(): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find((b) =>
      ["Подписаться", "Отписаться", "..."].includes((b.textContent ?? "").trim())
    ) as HTMLButtonElement | undefined) ?? null
  );
}

function counter(kind: "followers" | "following") {
  const node = container.querySelector(`[data-testid="follow-${kind}"]`);
  if (!node) return null;
  return { value: node.children[0].textContent, label: node.children[1].textContent };
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("follow block rendering", () => {
  it("A. other player, not followed: «Подписаться» + Подписчики 4 + Подписки 7", async () => {
    await renderPage();

    expect(followButton()?.textContent).toBe("Подписаться");
    expect(counter("followers")).toEqual({ value: "4", label: "Подписчики" });
    expect(counter("following")).toEqual({ value: "7", label: "Подписки" });
  });

  it("B. other player, followed: «Отписаться»", async () => {
    respondWithSummary({ followers: 4, following: 7, isFollowing: true });
    await renderPage();

    expect(followButton()?.textContent).toBe("Отписаться");
  });

  it("C. own profile: no button, counters still shown", async () => {
    mocks.params = { id: "viewer-1" };
    respondWithSummary({ followers: 3, following: 2, isFollowing: false });
    await renderPage();

    expect(followButton()).toBeNull();
    expect(counter("followers")).toEqual({ value: "3", label: "Подписчики" });
    expect(counter("following")).toEqual({ value: "2", label: "Подписки" });
  });

  it("D. anonymous viewer: no button, public counters still shown", async () => {
    mocks.viewer = null;
    respondWithSummary({ followers: 4, following: 7, isFollowing: false });
    await renderPage();

    expect(followButton()).toBeNull();
    expect(counter("followers")?.value).toBe("4");
    expect(counter("following")?.value).toBe("7");
  });

  it("E. unknown follow state (isFollowing null): no button, available counters still shown", async () => {
    respondWithSummary({ followers: 4, following: 7, isFollowing: null });
    await renderPage();

    expect(followButton()).toBeNull();
    expect(counter("followers")?.value).toBe("4");
    expect(counter("following")?.value).toBe("7");
  });

  it("F. zero counts render as a visible 0, not hidden", async () => {
    respondWithSummary({ followers: 0, following: 0, isFollowing: false });
    await renderPage();

    expect(counter("followers")).toEqual({ value: "0", label: "Подписчики" });
    expect(counter("following")).toEqual({ value: "0", label: "Подписки" });
  });

  it("G1. followers null hides only the Подписчики counter", async () => {
    respondWithSummary({ followers: null, following: 4, isFollowing: null });
    await renderPage();

    expect(counter("followers")).toBeNull();
    expect(counter("following")).toEqual({ value: "4", label: "Подписки" });
    expect(followButton()).toBeNull();
  });

  it("G2. following null hides only the Подписки counter; the button still works", async () => {
    respondWithSummary({ followers: 12, following: null, isFollowing: true });
    await renderPage();

    expect(counter("followers")).toEqual({ value: "12", label: "Подписчики" });
    expect(counter("following")).toBeNull();
    expect(followButton()?.textContent).toBe("Отписаться");
  });

  it("never renders a username anywhere in the follow block", async () => {
    await renderPage();

    const block = container.querySelector('[data-testid="follow-followers"]')?.parentElement?.textContent ?? "";
    expect(block).not.toContain("someone");
  });
});

describe("follow / unfollow", () => {
  it("H. follow success: POST, then «Отписаться» and the server's followers count", async () => {
    mocks.mutation = async () => ({ following: true, followers: 5, following_count: 7 });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(followButton()?.textContent).toBe("Отписаться");
    expect(counter("followers")?.value).toBe("5");
    expect(counter("following")?.value).toBe("7");
    expect(mockFetchJsonWithRetry).toHaveBeenCalledTimes(1);
    const [url, init, retries] = mockFetchJsonWithRetry.mock.calls[0];
    expect(url).toBe("/api/players/other-1/follow");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-Telegram-Init-Data": "signed-init-data" });
    // Mutations never auto-retry (4xx included).
    expect(retries).toBe(0);
  });

  it("I. canonical counts: the UI shows the server's 9, never a local 4 + 1 = 5", async () => {
    mocks.mutation = async () => ({ following: true, followers: 9, following_count: 7 });
    await renderPage();
    expect(counter("followers")?.value).toBe("4");

    await click(followButton()!);
    await settle();

    expect(counter("followers")?.value).toBe("9");
    expect(counter("followers")?.value).not.toBe("5");
  });

  it("I2. canonical counts also on unfollow: the server's 1, never a local 4 - 1 = 3", async () => {
    respondWithSummary({ followers: 4, following: 7, isFollowing: true });
    mocks.mutation = async () => ({ following: false, followers: 1, following_count: 7 });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(counter("followers")?.value).toBe("1");
    expect(counter("followers")?.value).not.toBe("3");
  });

  it("J. unfollow success: DELETE, then «Подписаться» and the server's counts", async () => {
    respondWithSummary({ followers: 4, following: 7, isFollowing: true });
    mocks.mutation = async () => ({ following: false, followers: 3, following_count: 7 });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(followButton()?.textContent).toBe("Подписаться");
    expect(counter("followers")?.value).toBe("3");
    const [url, init, retries] = mockFetchJsonWithRetry.mock.calls[0];
    expect(url).toBe("/api/players/other-1/follow");
    expect(init.method).toBe("DELETE");
    expect(retries).toBe(0);
  });

  it("an idempotent repeat (server says already following) simply converges on the server's state", async () => {
    // Local state says "not following" (stale tab), the server says the edge
    // already existed: the response is canonical, no error, no drift.
    mocks.mutation = async () => ({ following: true, followers: 4, following_count: 7 });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(followButton()?.textContent).toBe("Отписаться");
    expect(counter("followers")?.value).toBe("4");
  });

  it("is pessimistic: nothing changes until the server answers", async () => {
    const pending = deferred<unknown>();
    mocks.mutation = () => pending.promise;
    await renderPage();

    await click(followButton()!);

    // Still the OLD counts while in flight; the button label is only the busy marker.
    expect(counter("followers")?.value).toBe("4");

    await act(async () => pending.resolve({ following: true, followers: 5, following_count: 7 }));
    await settle();
    expect(counter("followers")?.value).toBe("5");
  });

  it("K. in flight: the button shows «...», is disabled, and repeated clicks start only one request", async () => {
    const pending = deferred<unknown>();
    mocks.mutation = () => pending.promise;
    await renderPage();

    const button = followButton()!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await click(followButton()!);

    expect(followButton()?.textContent).toBe("...");
    expect(followButton()?.disabled).toBe(true);
    expect(mockFetchJsonWithRetry).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ following: true, followers: 5, following_count: 7 }));
    await settle();

    expect(followButton()?.textContent).toBe("Отписаться");
    expect(followButton()?.disabled).toBe(false);
    expect(mockFetchJsonWithRetry).toHaveBeenCalledTimes(1);
  });
});

describe("mutation errors", () => {
  it("L. shows the safe API message in red, keeps state and counts, and clears it before the next attempt", async () => {
    let attempt = 0;
    const second = deferred<unknown>();
    mocks.mutation = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("Не удалось подписаться. Попробуйте ещё раз."));
      return second.promise;
    };
    await renderPage();

    await click(followButton()!);
    await settle();

    const error = Array.from(container.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes("Не удалось подписаться. Попробуйте ещё раз.")
    );
    expect(error).toBeDefined();
    expect(error?.className).toContain("text-red-300");
    expect(followButton()?.textContent).toBe("Подписаться");
    expect(followButton()?.disabled).toBe(false);
    expect(counter("followers")?.value).toBe("4");
    expect(counter("following")?.value).toBe("7");

    // Retry: the old message is gone as soon as the new attempt starts.
    await click(followButton()!);
    expect(container.textContent).not.toContain("Не удалось подписаться. Попробуйте ещё раз.");

    await act(async () => second.resolve({ following: true, followers: 5, following_count: 7 }));
    await settle();
    expect(followButton()?.textContent).toBe("Отписаться");
    expect(container.textContent).not.toContain("Не удалось подписаться");
  });

  it("a 4xx from the API (e.g. merged-away target) is shown as-is and nothing is retried", async () => {
    mocks.mutation = () => Promise.reject(new Error("Аккаунт был объединён. Обновите страницу."));
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(container.textContent).toContain("Аккаунт был объединён. Обновите страницу.");
    expect(mockFetchJsonWithRetry).toHaveBeenCalledTimes(1);
  });

  it("a malformed success body is rejected (state unchanged, safe message), never applied", async () => {
    mocks.mutation = async () => ({ ok: true });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(followButton()?.textContent).toBe("Подписаться");
    expect(counter("followers")?.value).toBe("4");
    expect(container.textContent).toContain("Не удалось выполнить запрос");
  });

  it("an error object without a message falls back to a safe Russian message (no stack/raw object)", async () => {
    mocks.mutation = () => Promise.reject({ stack: "secret stack", detail: "raw" });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(container.textContent).toContain("Не удалось подписаться. Попробуйте ещё раз.");
    expect(container.textContent).not.toContain("secret stack");
  });
});

describe("isolation", () => {
  it("M. a failing summary request leaves the profile fully rendered, with no follow controls and no page error", async () => {
    mocks.summary = () => Promise.reject(new Error("Сеть нестабильна. Попробуйте еще раз."));
    await renderPage();

    expect(container.textContent).toContain("Player other-1");
    expect(container.textContent).not.toContain("Профиль игрока не найден");
    expect(container.textContent).not.toContain("Ошибка загрузки профиля");
    expect(container.textContent).not.toContain("Нет команды");
    expect(followButton()).toBeNull();
    expect(counter("followers")).toBeNull();
    expect(counter("following")).toBeNull();
  });

  it("an unusable summary body (e.g. null / unrelated JSON) is treated the same way", async () => {
    mocks.summary = async () => null;
    await renderPage();
    expect(container.textContent).toContain("Player other-1");
    expect(counter("followers")).toBeNull();

    // Unrelated JSON that the other mocked fetchAdminJson callers return.
    mocks.summary = async () => ({ pending_invitations: [], pending_outgoing_join_requests: [] });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain("Player other-1");
    expect(counter("followers")).toBeNull();
    expect(followButton()).toBeNull();
  });

  it("the summary is requested independently of the profile load and via the authenticated client", async () => {
    await renderPage();

    const summaryCalls = mockFetchAdminJson.mock.calls.filter(([url]) => String(url).includes("/follow-summary"));
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0][0]).toBe("/api/players/other-1/follow-summary");
  });

  it("N. a summary that resolves after navigating to another player never overwrites that player's follow state", async () => {
    const slowFirst = deferred<unknown>();
    mocks.summary = (id: string) =>
      id === "other-1" ? slowFirst.promise : Promise.resolve({ followers: 5, following: 6, isFollowing: false });
    await renderPage();
    expect(counter("followers")).toBeNull(); // player 1's summary still pending

    mocks.params = { id: "other-2" };
    await renderPage();
    expect(container.textContent).toContain("Player other-2");
    expect(counter("followers")?.value).toBe("5");
    expect(counter("following")?.value).toBe("6");

    // The OLD request finally lands, carrying very different numbers.
    await act(async () => slowFirst.resolve({ followers: 99, following: 98, isFollowing: true }));
    await settle();

    expect(counter("followers")?.value).toBe("5");
    expect(counter("following")?.value).toBe("6");
    expect(followButton()?.textContent).toBe("Подписаться");
  });

  it("N2. a mutation that resolves after navigating away is not applied to the new player", async () => {
    const pending = deferred<unknown>();
    mocks.mutation = () => pending.promise;
    mocks.summary = (id: string) =>
      Promise.resolve(id === "other-1"
        ? { followers: 4, following: 7, isFollowing: false }
        : { followers: 10, following: 11, isFollowing: false });
    await renderPage();

    await click(followButton()!);
    mocks.params = { id: "other-2" };
    await renderPage();
    expect(counter("followers")?.value).toBe("10");

    await act(async () => pending.resolve({ following: true, followers: 50, following_count: 51 }));
    await settle();

    expect(counter("followers")?.value).toBe("10");
    expect(counter("following")?.value).toBe("11");
    expect(followButton()?.textContent).toBe("Подписаться");
  });
});

describe("followers / following lists", () => {
  const dialog = () => container.querySelector('[role="dialog"]') as HTMLElement | null;
  const counterButton = (kind: "followers" | "following") =>
    container.querySelector(`[data-testid="follow-${kind}"]`) as HTMLButtonElement | null;
  const listUrls = () =>
    mockFetchJsonWithRetry.mock.calls.map(([url]) => url as string).filter((url) => /\/(followers|following)\?/.test(url));
  const pressEscape = () =>
    act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

  it("both counters are real buttons when their number is available", async () => {
    await renderPage();

    expect(counterButton("followers")?.tagName).toBe("BUTTON");
    expect(counterButton("following")?.tagName).toBe("BUTTON");
    expect(counterButton("followers")?.getAttribute("type")).toBe("button");
    expect(dialog()).toBeNull();
  });

  it("clicking Подписчики opens the followers sheet (title + GET /followers, first page)", async () => {
    mocks.list = async () => ({
      items: [{ id: "p-1", display_name: "First Follower", telegram_avatar_url: null, custom_avatar_url: null }],
      total: 1,
    });
    await renderPage();

    await click(counterButton("followers")!);
    await settle();

    expect(dialog()?.querySelector("h2")?.textContent).toBe("Подписчики");
    expect(listUrls()).toEqual(["/api/players/other-1/followers?limit=50&offset=0"]);
    expect(dialog()?.textContent).toContain("First Follower");
    expect(dialog()?.querySelector("a")?.getAttribute("href")).toBe("/players/p-1");
  });

  it("clicking Подписки opens the following sheet (title + GET /following)", async () => {
    await renderPage();

    await click(counterButton("following")!);
    await settle();

    expect(dialog()?.querySelector("h2")?.textContent).toBe("Подписки");
    expect(listUrls()).toEqual(["/api/players/other-1/following?limit=50&offset=0"]);
    expect(dialog()?.textContent).toContain("Пока никого нет");
  });

  it("the list request is a plain public GET: no auth headers, no viewer/follower identity", async () => {
    await renderPage();

    await click(counterButton("followers")!);
    await settle();

    const call = mockFetchJsonWithRetry.mock.calls.find(([url]) => /\/followers\?/.test(url as string))!;
    expect(call[1]).toEqual({ cache: "no-store" });
    expect(String(call[0])).not.toContain("viewer");
  });

  it("a null count renders no button and opens nothing", async () => {
    respondWithSummary({ followers: null, following: 4, isFollowing: null });
    await renderPage();

    expect(counterButton("followers")).toBeNull();
    expect(counterButton("following")).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(listUrls()).toEqual([]);
  });

  it("a zero count is still clickable and shows the empty state", async () => {
    respondWithSummary({ followers: 0, following: 0, isFollowing: false });
    await renderPage();

    expect(counter("followers")?.value).toBe("0");
    await click(counterButton("followers")!);
    await settle();

    expect(dialog()?.textContent).toContain("Пока никого нет");
  });

  it("an anonymous viewer can open both lists", async () => {
    mocks.viewer = null;
    await renderPage();
    expect(followButton()).toBeNull();

    await click(counterButton("followers")!);
    await settle();
    expect(dialog()?.querySelector("h2")?.textContent).toBe("Подписчики");

    await pressEscape();
    await click(counterButton("following")!);
    await settle();
    expect(dialog()?.querySelector("h2")?.textContent).toBe("Подписки");
  });

  it("the owner can open both lists on their own profile", async () => {
    mocks.params = { id: "viewer-1" };
    await renderPage();

    await click(counterButton("followers")!);
    await settle();

    expect(dialog()?.querySelector("h2")?.textContent).toBe("Подписчики");
    expect(listUrls()[0]).toBe("/api/players/viewer-1/followers?limit=50&offset=0");
  });

  it("closing the sheet (Escape / backdrop / ×) returns to the untouched profile", async () => {
    await renderPage();

    await click(counterButton("followers")!);
    await settle();
    await pressEscape();
    expect(dialog()).toBeNull();

    await click(counterButton("following")!);
    await settle();
    await click(dialog()!.parentElement as HTMLElement);
    expect(dialog()).toBeNull();

    await click(counterButton("followers")!);
    await settle();
    await click(dialog()!.querySelector('button[aria-label="Закрыть"]')!);
    expect(dialog()).toBeNull();

    expect(container.textContent).toContain("Player other-1");
    expect(followButton()?.textContent).toBe("Подписаться");
    expect(counter("followers")?.value).toBe("4");
  });

  it("every open fetches fresh data (the sheet is unmounted on close)", async () => {
    await renderPage();

    await click(counterButton("followers")!);
    await settle();
    await pressEscape();
    await click(counterButton("followers")!);
    await settle();

    expect(listUrls()).toHaveLength(2);
  });

  it("a list error stays inside the sheet: the profile, Follow button and counters are unaffected", async () => {
    mocks.list = () => Promise.reject(new Error("Не удалось загрузить список. Попробуйте ещё раз."));
    await renderPage();

    await click(counterButton("followers")!);
    await settle();

    expect(dialog()?.textContent).toContain("Не удалось загрузить список. Попробуйте ещё раз.");
    expect(container.textContent).toContain("Player other-1");
    expect(container.textContent).not.toContain("Ошибка загрузки профиля");
    expect(followButton()?.textContent).toBe("Подписаться");
    expect(counter("followers")?.value).toBe("4");
  });

  it("Follow still works after the counters became buttons, and the counter shows the server's count", async () => {
    mocks.mutation = async () => ({ following: true, followers: 9, following_count: 7 });
    await renderPage();

    await click(followButton()!);
    await settle();

    expect(followButton()?.textContent).toBe("Отписаться");
    expect(counter("followers")?.value).toBe("9");
    expect(counterButton("followers")?.tagName).toBe("BUTTON");
    expect(listUrls()).toEqual([]);
  });

  it("navigating to another profile closes an open sheet (it never lingers over the wrong player)", async () => {
    await renderPage();
    await click(counterButton("followers")!);
    await settle();
    expect(dialog()).not.toBeNull();

    mocks.params = { id: "other-2" };
    await renderPage();

    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("Player other-2");
  });
});

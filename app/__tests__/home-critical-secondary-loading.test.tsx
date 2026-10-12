// Home startup split (see app/page.tsx refreshHomeData): the critical,
// above-the-fold tournament state renders as soon as it is ready, without
// waiting for any secondary/below-the-fold request; secondary sections fill
// in independently; every source is requested exactly once.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

vi.mock("@/features/auth", () => ({
  ensurePlayerFromTelegramUser: vi.fn(),
  acceptTerms: vi.fn(),
  completeProfile: vi.fn(),
}));

const tournaments = [
  { id: "t1", title: "Critical Cup", start_at: "2099-01-01T00:00:00.000Z", max_players: 20, kind: "free", tournament_type: "classic", season_id: null, status: "open", created_at: "2026-01-01T00:00:00.000Z", rating_formula_version: "v2", rating_guarantee: null, is_final: false },
] as unknown as Tournament[];

const snapshot = vi.hoisted(() => vi.fn());
vi.mock("@/features/home", () => ({ getHomeTournamentSnapshot: snapshot }));
// The individual actions must no longer be called from the client.
const legacyActions = vi.hoisted(() => ({
  getVisibleOpenTournamentsForPlayer: vi.fn(),
  getPlayerRegistrations: vi.fn(),
  getTournamentRegistrationCounts: vi.fn(),
}));
vi.mock("@/features/tournaments", () => legacyActions);

const player: Player = {
  id: "p1",
  telegram_id: 1,
  username: "p1",
  display_name: "Player One",
  role: "player",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
  accepted_terms_at: "2026-01-01T00:00:00.000Z",
  accepted_terms_version: "v1",
  profile_completed_at: "2026-01-01T00:00:00.000Z",
} as Player;

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
  invalidateCurrentPlayerCache: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({
  getTelegramUser: vi.fn(() => null),
  getTelegramInitData: vi.fn(async () => null),
  getTelegramWebApp: vi.fn(() => null),
  isTelegramMiniAppContext: vi.fn(() => true),
}));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn(), setActivityPlayerId: vi.fn() }));
// dealer/me: on the website this waits ~1.2 s for Telegram initData -- here
// it never resolves at all.
const fetchAdminJson = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson }));
vi.mock("@/lib/hooks/use-tournament-live-state", () => ({ useTournamentLiveState: () => ({}) }));

const { default: HomePage } = await import("@/app/page");

type Deferred = { resolve: (value: unknown) => void };
let pending: Map<string, Deferred>;
let fetchCalls: string[];
let container: HTMLDivElement;
let root: Root;

function respond(key: string, payload: unknown) {
  pending.get(key)!.resolve({ ok: true, json: async () => payload });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  snapshot.mockResolvedValue({ registrations: [], tournaments, counts: { t1: 7 } });
  pending = new Map();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    fetchCalls.push(url);
    if (url === "/api/tournament-visuals") {
      return Promise.resolve({ ok: true, json: async () => ({ visuals: [] }) });
    }
    // Every secondary request hangs until the test releases it.
    return new Promise((resolve) => pending.set(url.split("?")[0], { resolve }));
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
}

function ratingSection() {
  return [...container.querySelectorAll("section")].find((s) => s.textContent?.includes("Рейтинг сезона"))!;
}

describe("Home critical vs secondary loading", () => {
  it("renders the tournament carousel while every secondary request is still pending", async () => {
    await act(async () => root.render(<HomePage />));
    await flush();

    // Critical: visible now.
    expect(container.textContent).toContain("Critical Cup");
    expect(container.querySelector('button[aria-label="Показать турнир: Critical Cup"]')).not.toBeNull();
    // Secondary: still loading, independently.
    expect(ratingSection().textContent).toContain("Загружаем...");
    expect(container.textContent).toContain("— достижений");
    expect(container.textContent).not.toContain("Все события");

    // Releasing ONE secondary source updates only its own section.
    respond("/api/leaderboard", { season: { id: "s", title: "Осень" }, leaderboard: [], outOfCompetition: [] });
    await flush();
    expect(ratingSection().textContent).not.toContain("Загружаем...");
    expect(ratingSection().textContent).toContain("Рейтинг сезона пока пуст.");
    const teams = [...container.querySelectorAll("section")].find((s) => s.textContent?.includes("Командный рейтинг"))!;
    expect(teams.textContent).toContain("Загружаем...");

    respond("/api/club-activity", { events: [{ id: "e1", event_type: "news", title: "Новость дня", body: "b", published_at: "2026-10-01T10:00:00.000Z", player: null, image_url: null }] });
    await flush();
    expect(container.textContent).toContain("Новость дня");
  });

  it("requests each Home source exactly once, critical data via ONE server action", async () => {
    await act(async () => root.render(<HomePage />));
    await flush();

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith({ id: "p1", can_access_free: true, can_access_paid: true, can_access_cash: undefined });
    expect(legacyActions.getVisibleOpenTournamentsForPlayer).not.toHaveBeenCalled();
    expect(legacyActions.getPlayerRegistrations).not.toHaveBeenCalled();
    expect(legacyActions.getTournamentRegistrationCounts).not.toHaveBeenCalled();
    expect(fetchAdminJson).toHaveBeenCalledTimes(1);

    const counts = fetchCalls.reduce<Record<string, number>>((acc, url) => ({ ...acc, [url]: (acc[url] ?? 0) + 1 }), {});
    expect(counts).toEqual({
      "/api/tournament-visuals": 1,
      "/api/leaderboard": 1,
      "/api/teams?scope=current": 1,
      "/api/club-activity?limit=3": 1,
      "/api/players/p1/achievements": 1,
      "/api/players/p1/featured-achievements": 1,
      "/api/achievement-visuals": 1,
    });
  });

  it("a failed secondary source never blocks or breaks the critical state", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/tournament-visuals") return Promise.resolve({ ok: true, json: async () => ({ visuals: [] }) });
      return Promise.reject(new TypeError("network down"));
    }));
    await act(async () => root.render(<HomePage />));
    await flush();
    expect(container.textContent).toContain("Critical Cup");
    expect(ratingSection().textContent).toContain("Рейтинг сезона пока пуст.");
  });
});

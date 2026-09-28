// Home "Командный рейтинг" TOP-3 block (see app/page.tsx). Mounts the real
// HomePage with the same mock harness as
// home-carousel-lazy-loading.test.tsx (no tournaments needed for this
// block specifically, so the tournament list stays empty here).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

vi.mock("@/features/auth", () => ({
  ensurePlayerFromTelegramUser: vi.fn(),
  acceptTerms: vi.fn(),
  completeProfile: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getVisibleOpenTournamentsForPlayer: vi.fn().mockResolvedValue([]),
  getPlayerRegistrations: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

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

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
  setActivityPlayerId: vi.fn(),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/hooks/use-tournament-live-state", () => ({
  useTournamentLiveState: () => ({}),
}));

const { default: HomePage } = await import("@/app/page");

let container: HTMLDivElement;
let root: Root;
let teamStandingsResponse: { standings: unknown[] };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  teamStandingsResponse = { standings: [] };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/api/teams?")) {
        return { ok: true, json: async () => teamStandingsResponse } as Response;
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

async function renderHome() {
  await act(async () => {
    root.render(<HomePage />);
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Home -- Командный рейтинг block", () => {
  it("shows a compact empty/onboarding state when no team has points yet", async () => {
    await renderHome();
    expect(container.textContent).toContain("Командный рейтинг");
    expect(container.textContent).toContain("Пока ни одна команда не набрала очков");
    expect(container.textContent).toContain("Создать команду →");
  });

  it("shows TOP 3 teams for the active season, each linking to /teams/[id]", async () => {
    teamStandingsResponse = {
      standings: [
        { team_id: "t1", name: "Sharks", emblem: "🦈", status: "active", points: 300, rank: 1, member_count: 5 },
        { team_id: "t2", name: "Wolves", emblem: "🐺", status: "active", points: 200, rank: 2, member_count: 4 },
        { team_id: "t3", name: "Dragons", emblem: "🐉", status: "active", points: 100, rank: 3, member_count: 3 },
        { team_id: "t4", name: "Fourth", emblem: "💎", status: "active", points: 50, rank: 4, member_count: 2 },
      ],
    };
    await renderHome();

    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("Wolves");
    expect(container.textContent).toContain("Dragons");
    // Only TOP 3 -- the 4th-place team never shows on Home.
    expect(container.textContent).not.toContain("Fourth");

    const links = Array.from(container.querySelectorAll('a[href^="/teams/"]')).map((a) => a.getAttribute("href"));
    expect(links).toContain("/teams/t1");
    expect(links).toContain("/teams/t2");
    expect(links).toContain("/teams/t3");
  });

  it("links to /teams via 'Все команды →'", async () => {
    await renderHome();
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Все команды →");
    expect(link?.getAttribute("href")).toBe("/teams");
  });
});

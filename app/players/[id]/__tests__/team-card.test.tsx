// Player profile "Team card" (Teams v1) -- shown on BOTH own and public
// profiles when the player currently belongs to an active team; own-profile
// only "Нет команды · Создать" CTA when they don't.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({ params: { id: "viewer-1" }, legacyPlayerRead: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/features/auth", () => ({
  getPlayerById: mocks.legacyPlayerRead,
  submitNicknameForModeration: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getMyTournaments: vi.fn().mockResolvedValue([]),
  getPlayedTournamentsCount: vi.fn().mockResolvedValue(0),
  getPlayerHistoryKnockouts: vi.fn().mockResolvedValue(0),
  getPlayerTournamentHistory: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(viewer).catch(() => null),
}));

const { fetchAdminJson: mockFetchAdminJson } = vi.hoisted(() => ({
  fetchAdminJson: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: mockFetchAdminJson,
  getAdminHeaders: async () => ({ "X-Telegram-Init-Data": "signed-profile-test" }),
}));

vi.mock("@/lib/telegram", () => ({ getTelegramWebApp: vi.fn(() => null) }));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/tournament-visuals-client", () => ({ fetchTournamentVisualConfigs: vi.fn().mockResolvedValue([]) }));

const viewer: Player = {
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
let teamBadgeResponse: { team: unknown };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  teamBadgeResponse = { team: null };
  mockFetchAdminJson.mockReset().mockResolvedValue(null);
  mocks.legacyPlayerRead.mockClear();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/profile-v2")) {
        const id = url.split("/")[3];
        const own = id === viewer.id;
        return { ok: true, json: async () => ({ mode: own ? "own" : "public", profile: {
          id, display_name: own ? viewer.display_name : "Other Player", username: own ? viewer.username : "other",
          team: teamBadgeResponse.team, featured_achievement_keys: [], achievements: [],
          rating: { currentSeason: null, allTime: { points: 0, rank: null } },
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
        return { ok: true, json: async () => teamBadgeResponse } as Response;
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

async function render() {
  await act(async () => root.render(<PlayerProfilePage />));
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Profile V2 composition", () => {
  function useReadModel(own: boolean, balance = 0) {
    const id = own ? "viewer-1" : "other-1";
    mocks.params = { id };
    const history = Array.from({ length: 8 }, (_, index) => ({
      tournament: { id: `t-${index}`, title: `Result ${index + 1}`, tournament_type: "classic", start_at: new Date(2026, 9, 25 - index).toISOString() },
      result: { player_id: id, place: index + 1, field_size: 50, rating_points: 10, knockouts: 0 },
    }));
    const profile = {
      id, display_name: "Player", username: "player", team: null,
      achievements: [], featured_achievement_keys: [],
      rating: { currentSeason: null, allTime: { points: 80, rank: 5 } },
      tournaments_played: 8, knockouts: 0,
      recent_form: history.slice(0, 6), tournament_history: history,
      ...(own ? {
        email: "private@example.test", free_reentries_balance: balance, created_at: "2025-01-01T00:00:00Z",
        team_state: { pending_invitations: [], pending_outgoing_join_requests: [] },
        upcoming_tournaments: [{ tournament: { id: "upcoming", title: "Next tournament", tournament_type: "bounty", start_at: "2026-11-01T19:00:00Z", max_players: 100, status: "open" }, registration: { id: "reg", status: "registered" } }],
        registration_counts: { upcoming: 20 },
        dealer: { dealer: { isActive: true }, monthSummary: { completedShiftCount: 2, workedMinutes: 240, payoutRub: 6000 } },
      } : {}),
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/profile-v2") ? { mode: own ? "own" : "public", profile } : { visuals: [] },
    })));
  }

  it("links to dedicated history and renders only six recent results without duplication", async () => {
    useReadModel(true);
    await render();
    const results = () => container.querySelectorAll('#profile-results a[href^="/tournaments/"]');
    expect(results()).toHaveLength(6);
    const link = container.querySelector('a[href="/players/viewer-1/results"]')!;
    expect(link.textContent).toBe("Все результаты →");
    expect(container.querySelectorAll('a[href="/tournaments/t-0"]')).toHaveLength(1);
    expect(results()).toHaveLength(6);
  });

  it("shows the authorized positive legacy balance only on the own profile", async () => {
    useReadModel(true, 2);
    await render();
    expect(container.querySelector('[data-testid="free-reentries-balance"]')?.textContent).toBe("Бесплатные re-entry: 2");
    expect(fetch).toHaveBeenCalledWith("/api/players/viewer-1/profile-v2", {
      headers: { "X-Telegram-Init-Data": "signed-profile-test" },
      credentials: "include",
      cache: "no-store",
    });
  });

  it("hides a zero legacy balance", async () => {
    useReadModel(true, 0);
    await render();
    expect(container.querySelector('[data-testid="free-reentries-balance"]')).toBeNull();
  });

  it("fails closed when the profile API fails instead of requesting the raw Player through legacy data paths", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Profile unavailable" }) })));
    await render();
    expect(container.textContent).toContain("Profile unavailable");
    expect(container.querySelector('[data-testid="profile-hero"]')).toBeNull();
    expect(mocks.legacyPlayerRead).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith("/profile-v2") || String(url) === "/api/achievement-visuals")).toBe(true);
  });

  it("orders personal upcoming registrations before My Work and removes missions and tabs", async () => {
    useReadModel(true);
    await render();
    const text = container.textContent!;
    expect(text.indexOf("Ближайшие турниры")).toBeLessThan(text.indexOf("Моя работа"));
    expect(container.querySelector('a[href="/tournaments/upcoming"]')).not.toBeNull();
    expect(text).not.toContain("Задания недели");
    expect(text).not.toContain("Прошедшие (");
  });

  it("keeps public profiles free of personal registrations, work and private controls", async () => {
    useReadModel(false);
    await render();
    const text = container.textContent!;
    for (const privateCopy of ["Ближайшие турниры", "Моя работа", "private@example.test", "Задания недели", "Мои заявки", "Приглашение в команду"]) {
      expect(text).not.toContain(privateCopy);
    }
    expect(container.querySelector('a[href="/players/other-1/results"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="free-reentries-balance"]')).toBeNull();
    expect(container.querySelector('[aria-label="Сменить ник"]')).toBeNull();
  });
});

describe("own profile", () => {
  beforeEach(() => {
    mocks.params = { id: "viewer-1" };
  });

  it("shows the Team card when the player belongs to an active team, linking to /teams/[id]", async () => {
    teamBadgeResponse = { team: { team_id: "team-1", name: "Sharks", emblem: "🦈", rank: 3 } };
    await render();

    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("#3 в командном рейтинге");
    const link = container.querySelector('a[href="/teams/team-1"]');
    expect(link).not.toBeNull();
  });

  it("shows the 'Нет команды · Создать' CTA when the player has no team", async () => {
    teamBadgeResponse = { team: null };
    await render();

    expect(container.textContent).toContain("Нет команды · Создать");
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.getAttribute("href") === "/teams");
    expect(link).toBeDefined();
  });

  it("26. shows a pending invitation card with accept/decline when the player has no team but is invited", async () => {
    teamBadgeResponse = { team: null };
    mockFetchAdminJson.mockResolvedValue({
      pending_invitations: [
        { invitation_id: "inv-1", team_id: "team-1", team_name: "Sharks", team_emblem: "🦈", invited_by: { display_name: "Cap" } },
      ],
      pending_outgoing_join_requests: [],
    });
    await render();

    expect(container.textContent).toContain("Приглашение в команду");
    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("Принять");
    expect(container.textContent).toContain("Отклонить");
    expect(container.textContent).not.toContain("Нет команды · Создать");
  });

  it("26b. shows a compact 'Мои заявки: N' status when the player has only outgoing requests, no invitations", async () => {
    teamBadgeResponse = { team: null };
    mockFetchAdminJson.mockResolvedValue({
      pending_invitations: [],
      pending_outgoing_join_requests: [{ request_id: "req-1", team_id: "team-2", team_name: "Wolves", team_emblem: "🐺" }],
    });
    await render();

    expect(container.textContent).toContain("Мои заявки: 1");
    expect(container.textContent).not.toContain("Приглашение в команду");
  });
});

describe("public profile (viewing someone else)", () => {
  beforeEach(() => {
    mocks.params = { id: "other-1" };
  });

  it("shows the Team card for another player's active team", async () => {
    teamBadgeResponse = { team: { team_id: "team-2", name: "Wolves", emblem: "🐺", rank: 1 } };
    await render();

    expect(container.textContent).toContain("Wolves");
    expect(container.textContent).toContain("#1 в командном рейтинге");
  });

  it("never shows a 'no team' CTA on someone else's profile", async () => {
    teamBadgeResponse = { team: null };
    await render();

    expect(container.textContent).not.toContain("Нет команды");
  });

  it("27. never shows any invitation/request status on someone else's profile, even if they have pending items", async () => {
    teamBadgeResponse = { team: null };
    mockFetchAdminJson.mockResolvedValue({
      pending_invitations: [
        { invitation_id: "inv-1", team_id: "team-1", team_name: "Sharks", team_emblem: "🦈", invited_by: { display_name: "Cap" } },
      ],
      pending_outgoing_join_requests: [{ request_id: "req-1", team_id: "team-2", team_name: "Wolves", team_emblem: "🐺" }],
    });
    await render();

    expect(container.textContent).not.toContain("Приглашение в команду");
    expect(container.textContent).not.toContain("Мои заявки");
  });
});

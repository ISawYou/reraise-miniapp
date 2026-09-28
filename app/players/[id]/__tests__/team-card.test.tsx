// Player profile "Team card" (Teams v1) -- shown on BOTH own and public
// profiles when the player currently belongs to an active team; own-profile
// only "Нет команды · Создать" CTA when they don't.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({ params: { id: "viewer-1" } }));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/features/auth", () => ({
  getPlayerById: (id: string) => Promise.resolve(otherPlayer(id)),
  submitNicknameForModeration: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getMyTournaments: vi.fn().mockResolvedValue([]),
  getPlayedTournamentsCount: vi.fn().mockResolvedValue(0),
  getPlayerTournamentHistory: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(viewer).catch(() => null),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: vi.fn().mockResolvedValue(null),
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

function otherPlayer(id: string): Player {
  return { id, telegram_id: 2, username: "other", display_name: "Other Player", role: "player", is_blocked: false } as Player;
}

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

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
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
});

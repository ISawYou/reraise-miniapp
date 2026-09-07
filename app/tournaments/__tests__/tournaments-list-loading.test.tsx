// Phase 2B.2: /tournaments mounts every open tournament card simultaneously
// (openTournaments.map), and TournamentVisual defaults to loading="eager" --
// so before this change every open tournament's artwork was equally eager,
// same class of cold-load bandwidth competition Phase 2B.1 fixed on Home.
// This mounts the real TournamentsPage with real open-tournament data to
// verify only the first card is eager and every subsequent one is lazy,
// with no change to ordering, mounting, or completed-tournament rendering.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    title: "Test Tournament",
    start_at: "2099-01-01T00:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  } as Tournament;
}

const openTournaments = [
  tournament({ id: "open-1", title: "First" }),
  tournament({ id: "open-2", title: "Second" }),
  tournament({ id: "open-3", title: "Third" }),
];

const completedTournaments = [
  tournament({ id: "done-1", title: "Done One", status: "completed" }),
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentsForPlayer: vi.fn().mockResolvedValue({
    open: openTournaments,
    completed: completedTournaments,
  }),
  getPlayerRegistrations: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
  registerPlayerForTournament: vi.fn(),
  cancelPlayerRegistration: vi.fn(),
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
}));

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/lib/tournament-visuals-client", () => ({
  fetchTournamentVisualConfigs: vi.fn().mockResolvedValue({
    classic: {
      tournamentType: "classic",
      assetUrl: "/tournament-assets/classic.png",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      opacity: 100,
    },
  }),
}));

const { default: TournamentsPage } = await import("@/app/tournaments/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function openCardImages(): HTMLImageElement[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>("[data-tournament-visual-img]"));
}

async function renderTournamentsList() {
  await act(async () => {
    root.render(<TournamentsPage />);
  });
  for (let i = 0; i < 30 && openCardImages().length === 0; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("/tournaments open-list loading policy (Phase 2B.2)", () => {
  it("mounts all open tournament cards simultaneously, first eager, rest lazy", async () => {
    await renderTournamentsList();

    const imgs = openCardImages();
    expect(imgs.length).toBe(3); // all 3 open cards mounted at once

    expect(imgs[0].getAttribute("loading")).toBe("eager");
    expect(imgs[1].getAttribute("loading")).toBe("lazy");
    expect(imgs[2].getAttribute("loading")).toBe("lazy");
  });

  it("preserves the existing open-tournament ordering", async () => {
    await renderTournamentsList();

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/tournaments/"]'));
    const openLinks = links.filter((a) => a.getAttribute("href") !== "/tournaments/done-1");
    expect(openLinks.map((a) => a.getAttribute("href"))).toEqual([
      "/tournaments/open-1",
      "/tournaments/open-2",
      "/tournaments/open-3",
    ]);
  });

  it("does not render TournamentVisual for completed tournaments (unchanged)", async () => {
    await renderTournamentsList();

    const completedLink = container.querySelector('a[href="/tournaments/done-1"]');
    expect(completedLink).not.toBeNull();
    expect(completedLink?.querySelector("[data-tournament-visual-img]")).toBeNull();
    expect(container.textContent).toContain("Done One");
  });
});

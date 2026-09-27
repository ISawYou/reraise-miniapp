// Tournament detail "О турнире": Boost Rating badge next to the type label,
// driven by placement_points_multiplier; Bomb Pot shows only its label.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const mocks = vi.hoisted(() => ({ tournament: null as unknown }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: () => Promise.resolve(player) }));
vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentByIdForPlayer: () => Promise.resolve(mocks.tournament),
  getTournamentParticipants: () => Promise.resolve([]),
  getTournamentResults: () => Promise.resolve([]),
  getPlayerRegistrationForTournament: () => Promise.resolve(null),
  registerPlayerForTournament: vi.fn(),
  cancelPlayerRegistration: vi.fn(),
}));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));

const { default: TournamentDetailsPage } = await import("@/app/tournaments/[id]/page");

const player = { id: "viewer", role: "player", display_name: "V" } as Player;

function tournament(overrides: Partial<Tournament>): Tournament {
  return {
    id: "t1",
    title: "RERAISE MAIN EVENT",
    start_at: "2099-10-03T16:00:00.000Z",
    max_players: 40,
    kind: "free",
    tournament_type: "boost_rating",
    season_id: null,
    status: "open",
    created_at: "2026-09-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    placement_points_multiplier: 2,
    is_final: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(t: Tournament) {
  mocks.tournament = t;
  await act(async () => root.render(<TournamentDetailsPage />));
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function badges() {
  return Array.from(container.querySelectorAll('[data-testid="boost-rating-badge"]')).map(
    (el) => el.textContent
  );
}

describe("tournament detail -- Boost Rating presentation", () => {
  it("shows the Boost Rating type label and 'BOOST RATING ×2'; title unchanged", async () => {
    await render(tournament({}));
    expect(container.textContent).toContain("Boost Rating");
    expect(container.textContent).toContain("RERAISE MAIN EVENT");
    expect(badges().length).toBeGreaterThan(0);
    expect(new Set(badges())).toEqual(new Set(["BOOST RATING ×2"]));
  });

  it("×1.5", async () => {
    await render(tournament({ placement_points_multiplier: 1.5 }));
    expect(new Set(badges())).toEqual(new Set(["BOOST RATING ×1.5"]));
  });

  it("Bomb Pot: 'Bomb Pot' label, no boost badge", async () => {
    await render(tournament({ title: "BOMB POT", tournament_type: "bomb_pot", placement_points_multiplier: 1 }));
    expect(container.textContent).toContain("Bomb Pot");
    expect(badges()).toEqual([]);
  });
});

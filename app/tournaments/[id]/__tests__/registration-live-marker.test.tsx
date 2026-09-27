// Registration tab "● В игре" marker: shown only while the tournament is
// live, and only for players in the canonical active roster (the exact
// splitTournamentLiveRoster(...).active list the "В игре" tab renders --
// arrived + not eliminated). Same single useTournamentActivePlayers poll,
// never derived from registration status, never reorders the list.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament, TournamentParticipant } from "@/types/domain";
import type { PublicActiveTournamentPlayer } from "@/types/poker-clock-live-state";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
}));

const mocks = vi.hoisted(() => ({
  participants: [] as TournamentParticipant[],
  clockStatus: null as string | null,
  roster: [] as PublicActiveTournamentPlayer[],
  activePlayersCalls: [] as Array<{ id: string | null; enabled: boolean }>,
}));

vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentByIdForPlayer: () => Promise.resolve(tournament),
  getTournamentParticipants: () => Promise.resolve(mocks.participants),
  getTournamentResults: () => Promise.resolve([]),
  getPlayerRegistrationForTournament: () => Promise.resolve(null),
  registerPlayerForTournament: vi.fn(),
  cancelPlayerRegistration: vi.fn(),
}));

vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));

vi.mock("@/lib/hooks/use-tournament-live-state", () => ({
  useTournamentLiveState: (ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        mocks.clockStatus
          ? { clock: { status: mocks.clockStatus }, attendance: { active: 0 } }
          : { clock: null, attendance: null },
      ])
    ),
}));

// The ONE roster poll: returns the canned roster only while enabled, like
// the real hook's fetch gate.
vi.mock("@/lib/hooks/use-tournament-active-players", () => ({
  useTournamentActivePlayers: (id: string | null, enabled: boolean) => {
    mocks.activePlayersCalls.push({ id, enabled });
    return enabled ? mocks.roster : [];
  },
}));

const { default: TournamentDetailsPage } = await import("@/app/tournaments/[id]/page");

const player: Player = {
  id: "viewer",
  telegram_id: 1,
  username: "viewer",
  display_name: "Viewer",
  role: "player",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
} as Player;

const tournament: Tournament = {
  id: "t1",
  title: "Live Tournament",
  start_at: "2026-09-27T16:00:00.000Z",
  max_players: 20,
  kind: "free",
  tournament_type: "classic",
  season_id: null,
  status: "open",
  created_at: "2026-09-01T00:00:00.000Z",
  rating_formula_version: "v2",
  rating_guarantee: null,
  is_final: false,
} as Tournament;

function participant(id: string, rating: number, status = "registered"): TournamentParticipant {
  return {
    registration_id: `r-${id}`,
    player_id: id,
    status,
    created_at: "2026-09-01T00:00:00.000Z",
    username: null,
    display_name: `Name ${id}`,
    rating,
  } as TournamentParticipant;
}

function rosterPlayer(id: string, eliminated: boolean): PublicActiveTournamentPlayer {
  return {
    playerId: id,
    displayName: `Name ${id}`,
    avatarUrl: null,
    rating: 1000,
    eliminated,
    place: eliminated ? 5 : null,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // a: active, b: eliminated, c: registered but never arrived (not in roster).
  mocks.participants = [participant("a", 100), participant("b", 300), participant("c", 200)];
  mocks.roster = [rosterPlayer("a", false), rosterPlayer("b", true)];
  mocks.clockStatus = "running";
  mocks.activePlayersCalls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ visuals: [] }) }) as Response)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderRegistrationTab() {
  await act(async () => {
    root.render(<TournamentDetailsPage />);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  const tab = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith("Регистрация")
  )!;
  await act(async () => tab.click());
}

function rowFor(id: string): HTMLElement {
  const link = container.querySelector(`a[href="/players/${id}"]`);
  if (!link) throw new Error(`row not found: ${id}`);
  return link.closest("div.border-b") as HTMLElement;
}

function hasMarker(id: string) {
  return rowFor(id).textContent!.includes("● В игре");
}

function registrationOrder(): string[] {
  return Array.from(container.querySelectorAll('a[href^="/players/"]')).map(
    (a) => a.getAttribute("href")!.replace("/players/", "")
  );
}

describe("Registration tab — live '● В игре' marker", () => {
  it("4. shows the marker for a canonical active (arrived, not eliminated) player", async () => {
    await renderRegistrationTab();
    expect(hasMarker("a")).toBe(true);
  });

  it("reuses the single roster poll, enabled on the Registration tab while live", async () => {
    await renderRegistrationTab();
    expect(mocks.activePlayersCalls.at(-1)).toEqual({ id: "t1", enabled: true });
  });

  it("5. an eliminated player does not get the marker", async () => {
    await renderRegistrationTab();
    expect(hasMarker("b")).toBe(false);
  });

  it("6. a registered but not-arrived player does not get the marker", async () => {
    await renderRegistrationTab();
    expect(hasMarker("c")).toBe(false);
  });

  it("7. no marker (and no roster poll) when the tournament is not live", async () => {
    mocks.clockStatus = null;
    await renderRegistrationTab();
    expect(container.textContent).not.toContain("● В игре");
    expect(mocks.activePlayersCalls.every((call) => !call.enabled)).toBe(true);
  });

  it("8. does not reorder the list; 'По рейтингу' sort is unchanged", async () => {
    await renderRegistrationTab();
    expect(registrationOrder()).toEqual(["a", "b", "c"]);

    const sortButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "По рейтингу"
    )!;
    await act(async () => sortButton.click());

    expect(registrationOrder()).toEqual(["b", "c", "a"]);
    expect(hasMarker("a")).toBe(true);
    expect(hasMarker("b")).toBe(false);
  });
});

// Player-facing completed Results tab: the KO column is shown only for
// formats with ordinary knockouts (lib/tournament-helpers.ts
// supportsTournamentKnockouts -- bounty / boss_bounty). Everywhere else it
// was a column of zeros.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament, TournamentResult, TournamentType } from "@/types/domain";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
}));

const mocks = vi.hoisted(() => ({
  getVisibleTournamentByIdForPlayer: vi.fn(),
  getTournamentResults: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentByIdForPlayer: mocks.getVisibleTournamentByIdForPlayer,
  getTournamentParticipants: vi.fn().mockResolvedValue([]),
  getTournamentResults: mocks.getTournamentResults,
  getPlayerRegistrationForTournament: vi.fn().mockResolvedValue(null),
  registerPlayerForTournament: vi.fn(),
  cancelPlayerRegistration: vi.fn(),
}));

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
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

function tournament(tournament_type: TournamentType): Tournament {
  return {
    id: "t1",
    title: "Done",
    start_at: "2026-09-01T16:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type,
    season_id: null,
    status: "completed",
    created_at: "2026-08-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
  } as Tournament;
}

function result(overrides: Partial<TournamentResult>): TournamentResult {
  return {
    player_id: "a",
    place: 1,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    reentries: 1,
    addons: 0,
    free_reentries: 0,
    rating_points: 0,
    username: null,
    display_name: "A",
    ...overrides,
  } as TournamentResult;
}

const RESULTS = [
  result({ player_id: "alice", display_name: "Alice", place: 1, knockouts: 4, rating_points: 72 }),
  result({ player_id: "bob", display_name: "Bob", place: 2, knockouts: 3, rating_points: 55 }),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.getTournamentResults.mockResolvedValue(RESULTS);
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

async function renderResultsTab(type: TournamentType) {
  mocks.getVisibleTournamentByIdForPlayer.mockResolvedValue(tournament(type));
  await act(async () => {
    root.render(<TournamentDetailsPage />);
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const tab = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith("Результаты (")
  );
  if (!tab) throw new Error("results tab not found");
  await act(async () => tab.click());
}

function headerCells(): string[] {
  const header = Array.from(container.querySelectorAll("div")).find(
    (el) =>
      Array.from(el.children).map((c) => c.textContent).join("|").startsWith("Место|Игрок|")
  );
  if (!header) throw new Error("results header not found");
  return Array.from(header.children).map((c) => c.textContent ?? "");
}

function rowCells(name: string): string[] {
  const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === name)!;
  const row = link.closest("div.grid")!;
  return Array.from(row.children).map((c) => (c.textContent ?? "").trim());
}

describe("public completed Results tab -- KO column", () => {
  it.each(["classic", "crazy_pineapple"] as TournamentType[])(
    "%s: no KO header, no per-row KO value, 3-column grid",
    async (type) => {
      await renderResultsTab(type);

      expect(headerCells()).toEqual(["Место", "Игрок", "Очки"]);
      expect(rowCells("Alice")).toEqual(["1", "Alice", "72"]);
      expect(rowCells("Bob")).toEqual(["2", "Bob", "55"]);
      const row = container.querySelector("a[href='/players/alice']")!.closest("div.grid")!;
      expect(row.className).toContain("grid-cols-[40px_minmax(0,1fr)_58px]");
      expect(row.className).not.toContain("_44px_");
    }
  );

  it.each(["bounty", "boss_bounty"] as TournamentType[])(
    "%s: KO header and values shown exactly as before",
    async (type) => {
      await renderResultsTab(type);

      expect(headerCells()).toEqual(["Место", "Игрок", "KO", "Очки"]);
      expect(rowCells("Alice")).toEqual(["1", "Alice", "4", "72"]);
      expect(rowCells("Bob")).toEqual(["2", "Bob", "3", "55"]);
      const row = container.querySelector("a[href='/players/alice']")!.closest("div.grid")!;
      expect(row.className).toContain("grid-cols-[40px_minmax(0,1fr)_44px_58px]");
    }
  );
});

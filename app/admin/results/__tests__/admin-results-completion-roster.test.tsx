// "Завершить турнир" on the admin results page never treats the page's own
// (possibly stale) freeRows as the roster: right before validating places
// it re-reads the CANONICAL registered/attended roster and (a) silently
// drops rows of players who meanwhile became no-show / waitlist / cancelled
// -- they never need a place and are never submitted -- and (b) fails
// closed with a refresh message when a canonical participant is missing.
// Same harness as admin-results-sheet-auto-refresh.test.tsx (REAL page).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const TOURNAMENT_ID = "t-complete-1";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: TOURNAMENT_ID,
    title: "FREE",
    start_at: "2026-09-24T16:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-09-20T00:00:00.000Z",
    google_sheet_tab_name: "SHEET-TAB",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  } as Tournament;
}

function pulledRow(playerId: string, place: number | null) {
  return {
    player_id: playerId,
    display_name: playerId.toUpperCase(),
    username: null,
    arrived: true,
    paid: false,
    payment_type: "",
    free_reentries: 0,
    rebuys: 1,
    addons: 0,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    place,
  };
}

function draft(...ids: string[]) {
  return ids.map((id) => ({ player_id: id, username: null, display_name: id.toUpperCase(), status: "registered" }));
}

const admin: Player = {
  id: "admin-1",
  telegram_id: 1,
  username: "admin",
  display_name: "Admin",
  role: "admin",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
  accepted_terms_at: "2026-01-01T00:00:00.000Z",
  accepted_terms_version: "v1",
  profile_completed_at: "2026-01-01T00:00:00.000Z",
} as Player;

const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  getTournamentResults: vi.fn(),
  getTournamentEliminations: vi.fn(),
  getTournamentAttendance: vi.fn(),
  getTournamentRebuyState: vi.fn(),
  getDerivedEliminationPlaces: vi.fn(),
  getTournamentResultsDraft: vi.fn(),
  getTournamentLiveEntries: vi.fn(),
  fetchAdminJson: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: TOURNAMENT_ID }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: () => Promise.resolve(admin) }));
vi.mock("@/features/tournaments", () => ({
  getTournamentById: mocks.getTournamentById,
  getTournamentResults: mocks.getTournamentResults,
  getTournamentEliminations: mocks.getTournamentEliminations,
  getTournamentAttendance: mocks.getTournamentAttendance,
  getTournamentRebuyState: mocks.getTournamentRebuyState,
  getDerivedEliminationPlaces: mocks.getDerivedEliminationPlaces,
  getTournamentResultsDraft: mocks.getTournamentResultsDraft,
  getTournamentLiveEntries: mocks.getTournamentLiveEntries,
}));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));

const { default: AdminTournamentResultsPage } = await import("@/app/admin/results/[id]/page");

let container: HTMLDivElement;
let root: Root;
let pulledRows: ReturnType<typeof pulledRow>[];

async function flush() {
  for (let i = 0; i < 50; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  await act(async () => {
    root.render(<AdminTournamentResultsPage />);
  });
  await flush();
}

async function clickComplete() {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Завершить турнир"
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await flush();
}

function completeCalls() {
  return mocks.fetchAdminJson.mock.calls.filter(([url]) => String(url).includes("/complete-free"));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(window, "setInterval").mockImplementation(
    (() => 999_002 as unknown as ReturnType<typeof setInterval>) as unknown as typeof window.setInterval
  );

  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.getTournamentLiveEntries.mockResolvedValue([]);
  mocks.getTournamentResults.mockResolvedValue([]);

  // Loaded while "ns" (later marked "Не пришёл") and "wl" were still on
  // the page's roster -- both without a place.
  pulledRows = [pulledRow("p1", 1), pulledRow("p2", 2), pulledRow("ns", null), pulledRow("wl", null)];
  mocks.fetchAdminJson.mockImplementation((url: string) => {
    if (url.includes("/pull-sheet")) return Promise.resolve({ rows: pulledRows });
    if (url.includes("/late-registration")) return Promise.resolve({ snapshot: null });
    if (url.includes("/complete-free")) {
      return Promise.resolve({ ok: true, completedCount: 2, pokerClockSync: { status: "not_linked" } });
    }
    return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("admin results -- completion uses the canonical roster, not stale freeRows", () => {
  it("stale no-show / waitlist rows without a place do NOT block completion and are NOT submitted", async () => {
    await renderPage();
    mocks.getTournamentResultsDraft.mockResolvedValue(draft("p1", "p2"));

    await clickComplete();

    expect(container.textContent).not.toContain("заполните место");
    expect(completeCalls()).toHaveLength(1);
    const body = JSON.parse((completeCalls()[0][1] as { body: string }).body) as {
      rows: { player_id: string; place: number }[];
    };
    expect(body.rows.map((row) => [row.player_id, row.place])).toEqual([
      ["p1", 1],
      ["p2", 2],
    ]);
    expect(container.textContent).toContain("Турнир завершен");
  });

  it("a real (canonical) participant without a place still blocks completion -- never invented", async () => {
    await renderPage();
    mocks.getTournamentResultsDraft.mockResolvedValue(draft("p1", "p2", "ns"));

    await clickComplete();

    expect(completeCalls()).toHaveLength(0);
    expect(container.textContent).toContain("Перед завершением заполните место для всех игроков");
    expect(container.textContent).toContain("NS");
  });

  it("a canonical participant missing from the page fails closed with the refresh message", async () => {
    await renderPage();
    mocks.getTournamentResultsDraft.mockResolvedValue(draft("p1", "p2", "late"));

    await clickComplete();

    expect(completeCalls()).toHaveLength(0);
    expect(container.textContent).toContain(
      "Данные участников изменились. Обновите таблицу и повторите завершение."
    );
  });
});

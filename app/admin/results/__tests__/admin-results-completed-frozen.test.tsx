// BOUNTY HUNTERS (2026-09-10) product fix: the admin results page for a
// Google-Sheets-linked tournament re-pulled the LIVE Sheet on every load
// regardless of tournament.status, so a post-completion Sheet edit (or
// stale/never-updated cell) could show a different KO/rating than the
// frozen `results` row the app had already saved. This mounts the REAL
// page component (same pattern as
// app/tournaments/__tests__/tournaments-list-loading.test.tsx) to prove:
// open tournaments still read the live Sheet exactly as before, and
// completed tournaments now always render the canonical persisted
// snapshot (getTournamentResults) instead, never the Sheet.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament, TournamentResult } from "@/types/domain";

const TOURNAMENT_ID = "t-bounty-1";
const LEE_ID = "lee-player-id";

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: TOURNAMENT_ID,
    title: "BOUNTY HUNTERS",
    start_at: "2026-09-10T16:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "bounty",
    season_id: null,
    status: "open",
    created_at: "2026-09-07T00:00:00.000Z",
    google_sheet_tab_name: "SHEET-TAB",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  } as Tournament;
}

function persistedResult(overrides: Partial<TournamentResult> = {}): TournamentResult {
  return {
    player_id: LEE_ID,
    place: 1,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    reentries: 8,
    addons: 3,
    free_reentries: 0,
    rating_points: 132,
    username: "lee_tg",
    display_name: "Lee",
    ...overrides,
  };
}

function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: LEE_ID,
    display_name: "Lee",
    username: null,
    arrived: true,
    paid: false,
    payment_type: "",
    free_reentries: 0,
    rebuys: 8,
    addons: 3,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
    place: 1,
    ...overrides,
  };
}

const player: Player = {
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

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
}));

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

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: mocks.fetchAdminJson,
}));

const { default: AdminTournamentResultsPage } = await import("@/app/admin/results/[id]/page");

let container: HTMLDivElement;
let root: Root;

function pullSheetCalls() {
  return mocks.fetchAdminJson.mock.calls.filter(([url]) => String(url).includes("/pull-sheet"));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.getTournamentResultsDraft.mockResolvedValue([]);
  mocks.getTournamentLiveEntries.mockResolvedValue([]);
  mocks.getTournamentResults.mockResolvedValue([]);
  mocks.fetchAdminJson.mockImplementation((url: string) => {
    if (url.includes("/late-registration")) return Promise.resolve({ snapshot: null });
    if (url.includes("/completion-summary")) {
      return Promise.resolve({
        playersCount: 1,
        totalEntries: 1,
        rebuysCount: 0,
        addonsCount: 0,
        freeEntriesCount: 0,
        dealersCount: 0,
        dealerPayoutRub: 0,
      });
    }
    return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function findInputByLabel(labelText: string): HTMLInputElement | null {
  const labels = Array.from(container.querySelectorAll("p"));
  const label = labels.find((p) => p.textContent?.trim() === labelText);
  const wrapper = label?.parentElement;
  return (wrapper?.querySelector("input") as HTMLInputElement | null) ?? null;
}

async function renderPage() {
  await act(async () => {
    root.render(<AdminTournamentResultsPage />);
  });
  for (let i = 0; i < 50; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("admin results — completed tournaments show the frozen persisted snapshot, not the live Sheet", () => {
  it("1. open GS-linked tournament: admin page still uses live Sheet data (unchanged)", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "open" }));
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url.includes("/pull-sheet")) {
        return Promise.resolve({ rows: [sheetRow({ knockouts: 8 })] });
      }
      if (url.includes("/late-registration")) return Promise.resolve({ snapshot: null });
      return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
    });

    await renderPage();

    expect(pullSheetCalls().length).toBeGreaterThan(0);
    expect(findInputByLabel("Nok")?.value).toBe("8");
  });

  it("2. completed GS-linked tournament: admin page uses persisted results, never pulls the Sheet", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 0, rating_points: 132 })]);

    await renderPage();

    expect(pullSheetCalls().length).toBe(0);
    expect(container.textContent).toContain("Показаны зафиксированные результаты турнира");
    expect(container.textContent).toContain("Lee");
  });

  it("3. a Sheet KO change after completion cannot change what completed admin results display", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 0, rating_points: 132 })]);
    // Even if pull-sheet WOULD return a diverged KO=8, the page must never
    // call it for a completed tournament -- configured here so a future
    // regression that re-introduces the call would be caught by assertion
    // 4/5 below (displaying 8 instead of the persisted 0).
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url.includes("/pull-sheet")) {
        return Promise.resolve({ rows: [sheetRow({ knockouts: 8 })] });
      }
      if (url.includes("/completion-summary")) {
        return Promise.resolve({
          playersCount: 1,
          totalEntries: 1,
          rebuysCount: 0,
          addonsCount: 0,
          freeEntriesCount: 0,
          dealersCount: 0,
          dealerPayoutRub: 0,
        });
      }
      return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
    });

    await renderPage();

    expect(pullSheetCalls().length).toBe(0);
    expect(container.textContent).toContain("KO: 0");
    expect(container.textContent).not.toContain("KO: 8");
  });

  it("4. persisted KO=0 displays literally 0 for a completed tournament (not hidden)", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 0, rating_points: 132 })]);

    await renderPage();

    expect(container.textContent).toContain("KO: 0");
  });

  it("5. persisted KO=8 displays 8 for a completed tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 8, rating_points: 172 })]);

    await renderPage();

    expect(container.textContent).toContain("KO: 8");
  });

  it("6. rating shown for a completed tournament comes from frozen results.rating_points", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 8, rating_points: 172 })]);

    await renderPage();

    expect(container.textContent).toContain("172");
    // The exact BOUNTY HUNTERS incident value (rating_points as if KO=0)
    // must NOT appear when the persisted row already says 172.
    expect(container.textContent).not.toContain("132");
  });

  it("7. non-GS tournament behaviour is unchanged (open, no linked sheet -> draft rows, no pull-sheet call)", async () => {
    mocks.getTournamentById.mockResolvedValue(
      tournament({ status: "open", google_sheet_tab_name: null })
    );
    mocks.getTournamentResultsDraft.mockResolvedValue([
      { player_id: LEE_ID, username: null, display_name: "Lee" },
    ]);

    await renderPage();

    expect(pullSheetCalls().length).toBe(0);
    expect(findInputByLabel("Nok")?.value).toBe("0");
  });

  it("8. viewing a completed tournament triggers no result-affecting fetches at all (no recalculation just by viewing)", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 8, rating_points: 172 })]);

    await renderPage();

    expect(pullSheetCalls().length).toBe(0);
    expect(mocks.getTournamentResultsDraft).not.toHaveBeenCalled();
    expect(mocks.getTournamentLiveEntries).not.toHaveBeenCalled();
    // Only the canonical read, once.
    expect(mocks.getTournamentResults).toHaveBeenCalledTimes(1);
  });

  it("9. completed PAID/live tournament also shows the persisted snapshot, not tournament_live_entries", async () => {
    mocks.getTournamentById.mockResolvedValue(
      tournament({ status: "completed", kind: "paid", google_sheet_tab_name: "LIVE-TAB" })
    );
    mocks.getTournamentResults.mockResolvedValue([persistedResult({ knockouts: 8, rating_points: 172 })]);

    await renderPage();

    expect(pullSheetCalls().length).toBe(0);
    expect(mocks.getTournamentLiveEntries).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Показаны зафиксированные результаты турнира");
    expect(container.textContent).toContain("KO: 8");
  });
});

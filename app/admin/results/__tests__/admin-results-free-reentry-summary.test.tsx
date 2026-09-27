// Live "Rating Engine v2" card on the admin results page: display-only
// "Free re-entry" = sum of freeRows[].free_reentries over ARRIVED players
// (same meaning as completionSummary.freeEntriesCount / Finance). Never
// touches Entries/Rebuys/Add-ons or the engine meta.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const TOURNAMENT_ID = "t-live-1";

function tournament(): Tournament {
  return {
    id: TOURNAMENT_ID,
    title: "LIVE FREE",
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
  } as Tournament;
}

function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: "p1",
    display_name: "Lee",
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
    place: null,
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
let sheetRows: ReturnType<typeof sheetRow>[];

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

function summaryCard(): HTMLElement {
  const label = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent?.trim() === "Rating Engine v2"
  );
  if (!label?.parentElement) throw new Error("Rating Engine v2 card not found");
  return label.parentElement;
}

function summaryValues(): string[] {
  return Array.from(summaryCard().querySelectorAll("span")).map((s) => s.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // Never let the auto-refresh / status-clock intervals fire.
  const realSetInterval = window.setInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(
    (() => realSetInterval(() => undefined, 1_000_000)) as unknown as typeof window.setInterval
  );

  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.getTournamentResultsDraft.mockResolvedValue([]);
  mocks.getTournamentLiveEntries.mockResolvedValue([]);
  mocks.getTournamentResults.mockResolvedValue([]);

  sheetRows = [];
  mocks.fetchAdminJson.mockImplementation((url: string) => {
    if (url.includes("/pull-sheet")) return Promise.resolve({ rows: sheetRows });
    if (url.includes("/late-registration")) return Promise.resolve({ snapshot: null });
    return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("admin results — Rating Engine v2 live summary: Free re-entry", () => {
  it("1. shows the sum of free_reentries across arrived players", async () => {
    sheetRows = [
      sheetRow({ player_id: "p1", display_name: "A", free_reentries: 2 }),
      sheetRow({ player_id: "p2", display_name: "B", free_reentries: 1 }),
    ];
    await renderPage();

    expect(summaryValues()).toContain("Free re-entry: 3");
  });

  it("2. a non-arrived player's free_reentries are not counted", async () => {
    sheetRows = [
      sheetRow({ player_id: "p1", display_name: "A", free_reentries: 2 }),
      sheetRow({ player_id: "p2", display_name: "B", arrived: false, free_reentries: 5 }),
    ];
    await renderPage();

    expect(summaryValues()).toContain("Free re-entry: 2");
  });

  it("3. free re-entry does not change Entries/Rebuys/Add-ons/meta", async () => {
    const base = [
      sheetRow({ player_id: "p1", display_name: "A", rebuys: 3, addons: 1 }),
      sheetRow({ player_id: "p2", display_name: "B", rebuys: 1, addons: 0 }),
    ];

    sheetRows = base;
    await renderPage();
    const withoutFree = summaryCard().textContent!.replace(/Free re-entry: \d+/, "");
    expect(summaryValues()).toContain("Free re-entry: 0");

    await act(async () => root.unmount());
    root = createRoot(container);

    sheetRows = base.map((row) => ({ ...row, free_reentries: 2 }));
    await renderPage();
    expect(summaryValues()).toContain("Free re-entry: 4");
    expect(summaryValues()).toEqual(
      expect.arrayContaining(["Players: 2", "Entries: 4", "Rebuys: 2", "Add-ons: 1"])
    );
    expect(summaryCard().textContent!.replace(/Free re-entry: \d+/, "")).toBe(withoutFree);
  });
});

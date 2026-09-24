// Live Google Sheets mirror on the admin results page: an OPEN, kind="free",
// GS-linked tournament re-reads the Sheet (read-only pull-sheet) every
// ~15s and reconciles it with the same live Postgres overlay as loadPage /
// "Синхронизировать сейчас". Mounts the REAL page component (same harness
// as admin-results-completed-frozen.test.tsx) and drives the interval
// callback directly instead of waiting on wall-clock time.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const TOURNAMENT_ID = "t-live-1";
const P1 = "p1";
const AUTO_REFRESH_MS = 15_000;

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: TOURNAMENT_ID,
    title: "LIVE FREE",
    start_at: "2026-09-24T16:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "bounty",
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

function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: P1,
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
let autoRefreshCallbacks: Array<() => void>;
// What the next pull-sheet call returns; a function so a test can hand
// out a pending/rejected promise for a specific call.
let pullSheet: (body: unknown) => Promise<unknown>;

function pullSheetCalls() {
  return mocks.fetchAdminJson.mock.calls.filter(([url]) => String(url).includes("/pull-sheet"));
}

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

async function runAutoRefreshTick() {
  expect(autoRefreshCallbacks.length).toBeGreaterThan(0);
  await act(async () => {
    autoRefreshCallbacks[autoRefreshCallbacks.length - 1]();
  });
  await flush();
}

function inputByLabel(labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent?.trim() === labelText
  );
  const input = label?.parentElement?.querySelector("input") as HTMLInputElement | null;
  if (!input) throw new Error(`input not found: ${labelText}`);
  return input;
}

function checkboxByLabel(labelText: string): HTMLInputElement {
  const span = Array.from(container.querySelectorAll("label span")).find(
    (el) => el.textContent?.trim() === labelText
  );
  const input = span?.closest("label")?.querySelector("input") as HTMLInputElement | null;
  if (!input) throw new Error(`checkbox not found: ${labelText}`);
  return input;
}

function paymentTypeInput(): HTMLInputElement {
  return container.querySelector('input[placeholder="нал / карта"]') as HTMLInputElement;
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  autoRefreshCallbacks = [];
  const realSetInterval = window.setInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number) => {
    if (timeout === AUTO_REFRESH_MS) {
      autoRefreshCallbacks.push(handler as () => void);
      return 999_001 as unknown as ReturnType<typeof setInterval>;
    }
    // The status clock (5s) is irrelevant here -- never let it fire.
    return realSetInterval(() => undefined, 1_000_000);
  }) as typeof window.setInterval);

  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getTournamentEliminations.mockResolvedValue(new Map());
  mocks.getTournamentAttendance.mockResolvedValue(new Map());
  mocks.getTournamentRebuyState.mockResolvedValue(new Map());
  mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map());
  mocks.getTournamentResultsDraft.mockResolvedValue([
    { player_id: P1, username: null, display_name: "Lee" },
  ]);
  mocks.getTournamentLiveEntries.mockResolvedValue([]);
  mocks.getTournamentResults.mockResolvedValue([]);

  pullSheet = () => Promise.resolve({ rows: [sheetRow()] });
  mocks.fetchAdminJson.mockImplementation((url: string, init?: { body?: string }) => {
    if (url.includes("/pull-sheet")) {
      return pullSheet(init?.body ? JSON.parse(init.body) : undefined);
    }
    if (url.includes("/late-registration")) return Promise.resolve({ snapshot: null });
    return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("admin results — Google Sheets auto-refresh (open free GS-linked tournament)", () => {
  it("1/6. refreshes Sheet-backed values: Оплатил, Нал/карта, Беспл. re-entry, Re-buy, Addon, Nok", async () => {
    await renderPage();
    expect(inputByLabel("Nok").value).toBe("0");

    pullSheet = () =>
      Promise.resolve({
        rows: [
          sheetRow({
            paid: true,
            payment_type: "карта",
            free_reentries: 2,
            rebuys: 4,
            addons: 1,
            knockouts: 3,
          }),
        ],
      });
    await runAutoRefreshTick();

    expect(checkboxByLabel("Оплатил").checked).toBe(true);
    expect(paymentTypeInput().value).toBe("карта");
    expect(inputByLabel("Free re-entry").value).toBe("2");
    expect(inputByLabel("Re-buy").value).toBe("4");
    expect(inputByLabel("Addon").value).toBe("1");
    expect(inputByLabel("Nok").value).toBe("3");
  });

  it("uses the READ-ONLY pull-sheet (never commit:true) for the automatic refresh", async () => {
    await renderPage();
    const before = pullSheetCalls().length;

    await runAutoRefreshTick();

    const autoCalls = pullSheetCalls().slice(before);
    expect(autoCalls).toHaveLength(1);
    const [, init] = autoCalls[0];
    expect(init?.body).toBeUndefined();
  });

  it("6. Boss Nok also follows the Sheet for a boss_bounty tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ tournament_type: "boss_bounty" }));
    await renderPage();

    pullSheet = () => Promise.resolve({ rows: [sheetRow({ boss_knockouts: 2 })] });
    await runAutoRefreshTick();

    expect(inputByLabel("Boss Nok").value).toBe("2");
  });

  it("2. does not run for a completed tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    await renderPage();

    expect(autoRefreshCallbacks).toHaveLength(0);
    expect(pullSheetCalls()).toHaveLength(0);
  });

  it("3. does not run without google_sheet_tab_name", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ google_sheet_tab_name: null }));
    await renderPage();

    expect(autoRefreshCallbacks).toHaveLength(0);
    expect(pullSheetCalls()).toHaveLength(0);
  });

  it("does not run for a paid/cash tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ kind: "paid" }));
    pullSheet = () => Promise.resolve({ rows: [] });
    await renderPage();

    expect(autoRefreshCallbacks).toHaveLength(0);
  });

  it("4. skips the tick while the form has an unsaved local edit -- the edit is never overwritten", async () => {
    await renderPage();
    await typeInto(inputByLabel("Nok"), "5");
    const before = pullSheetCalls().length;

    pullSheet = () => Promise.resolve({ rows: [sheetRow({ knockouts: 9 })] });
    await runAutoRefreshTick();

    expect(pullSheetCalls().length).toBe(before);
    expect(inputByLabel("Nok").value).toBe("5");
    expect(container.textContent).not.toMatch(/ошибк/i);
  });

  it("skips the tick while an input is focused (in-progress typing)", async () => {
    await renderPage();
    const rebuyInput = inputByLabel("Re-buy");
    await act(async () => rebuyInput.focus());
    const before = pullSheetCalls().length;

    await runAutoRefreshTick();

    expect(pullSheetCalls().length).toBe(before);
  });

  it("discards a refresh result if the admin edited the form while it was in flight", async () => {
    await renderPage();
    let resolveSlow!: (value: unknown) => void;
    pullSheet = () => new Promise((resolve) => (resolveSlow = resolve));

    await runAutoRefreshTick();
    await typeInto(inputByLabel("Nok"), "5");
    resolveSlow({ rows: [sheetRow({ knockouts: 9 })] });
    await flush();

    expect(inputByLabel("Nok").value).toBe("5");
  });

  it("does not poll while the document is hidden", async () => {
    await renderPage();
    const before = pullSheetCalls().length;
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    await runAutoRefreshTick();
    expect(pullSheetCalls().length).toBe(before);

    hidden.mockReturnValue(false);
  });

  it("5. never overlaps: a slow refresh blocks further ticks until it finishes", async () => {
    await renderPage();
    const before = pullSheetCalls().length;
    let resolveSlow!: (value: unknown) => void;
    pullSheet = () => new Promise((resolve) => (resolveSlow = resolve));

    await runAutoRefreshTick();
    await runAutoRefreshTick();
    await runAutoRefreshTick();
    expect(pullSheetCalls().length).toBe(before + 1);

    resolveSlow({ rows: [sheetRow({ knockouts: 2 })] });
    await flush();
    expect(inputByLabel("Nok").value).toBe("2");

    pullSheet = () => Promise.resolve({ rows: [sheetRow({ knockouts: 3 })] });
    await runAutoRefreshTick();
    expect(pullSheetCalls().length).toBe(before + 2);
    expect(inputByLabel("Nok").value).toBe("3");
  });

  it("7. Postgres attendance / elimination / derived place win over the Sheet", async () => {
    await renderPage();

    mocks.getTournamentAttendance.mockResolvedValue(
      new Map([[P1, { arrived: false, arrived_at: null }]])
    );
    mocks.getTournamentEliminations.mockResolvedValue(
      new Map([[P1, { eliminated: true, eliminated_at: "2026-09-24T17:00:00.000Z" }]])
    );
    mocks.getDerivedEliminationPlaces.mockResolvedValue(new Map([[P1, 7]]));
    pullSheet = () => Promise.resolve({ rows: [sheetRow({ arrived: true, place: 1, knockouts: 4 })] });
    await runAutoRefreshTick();

    expect(checkboxByLabel("Пришёл").checked).toBe(false);
    expect(inputByLabel("Место").value).toBe("7");
    expect(inputByLabel("Место").disabled).toBe(true);
    // Sheet-only fields still refresh in the same tick.
    expect(inputByLabel("Nok").value).toBe("4");
  });

  it("8. live tournament_rebuy_state wins over the Sheet's Re-buy/Add-on", async () => {
    await renderPage();

    mocks.getTournamentRebuyState.mockResolvedValue(new Map([[P1, { rebuys: 6, addons: 2 }]]));
    pullSheet = () => Promise.resolve({ rows: [sheetRow({ rebuys: 9, addons: 0 })] });
    await runAutoRefreshTick();

    expect(inputByLabel("Re-buy").value).toBe("6");
    expect(inputByLabel("Addon").value).toBe("2");
  });

  it("9. a background failure keeps the last rows and surfaces no error; the next tick recovers", async () => {
    pullSheet = () => Promise.resolve({ rows: [sheetRow({ knockouts: 2 })] });
    await renderPage();

    pullSheet = () => Promise.reject(new Error("Google Sheets quota exceeded"));
    await runAutoRefreshTick();
    await runAutoRefreshTick();

    expect(inputByLabel("Nok").value).toBe("2");
    expect(container.textContent).not.toContain("Google Sheets quota exceeded");

    pullSheet = () => Promise.resolve({ rows: [sheetRow({ knockouts: 3 })] });
    await runAutoRefreshTick();
    expect(inputByLabel("Nok").value).toBe("3");
  });

  it("10. manual 'Синхронизировать сейчас' is unchanged: commit:true, success message, visible error on failure", async () => {
    await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Синхронизировать сейчас"
    )!;

    pullSheet = () => Promise.resolve({ rows: [sheetRow({ knockouts: 6 })] });
    await act(async () => button.click());
    await flush();

    const lastCall = pullSheetCalls().at(-1)!;
    expect(JSON.parse(lastCall[1].body)).toEqual({ commit: true });
    expect(inputByLabel("Nok").value).toBe("6");
    expect(container.textContent).toContain("Данные подтянуты из Google Sheets");

    pullSheet = () => Promise.reject(new Error("Лист не найден"));
    await act(async () => button.click());
    await flush();
    expect(container.textContent).toContain("Лист не найден");
  });

  it("shows a small sync status after a successful Sheet read", async () => {
    await renderPage();

    const status = container.querySelector('[data-testid="sheet-sync-status"]');
    expect(status?.textContent).toBe("Google Sheets · синхронизировано только что");
  });

  it("no sync status when the initial Sheet read failed (never claims a sync that didn't happen)", async () => {
    pullSheet = () => Promise.reject(new Error("boom"));
    await renderPage();

    expect(container.querySelector('[data-testid="sheet-sync-status"]')).toBeNull();
  });
});

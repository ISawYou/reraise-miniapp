// Super-Admin Merge Center UI (/admin/account-merges): selectors, search,
// swap, server preview (final identity / warnings / blockers), blocker-
// disabled merge button, typed confirmation gate, success state, preserved
// conflict queue and "Открыть в объединении" prefill. Structure/behavior
// only -- no pixel assertions. Same render harness as the admin tournament
// UI tests.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  currentPlayer: { current: null as unknown },
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(mocks.currentPlayer.current),
}));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));
vi.mock("@/components/ui/back-button", () => ({ BackButton: () => null }));

const { default: AdminAccountMergesPage } = await import("@/app/admin/account-merges/page");

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const TOURNAMENT_ID = "18bcea75-d8fe-4d0d-85f5-67320905cfab";

function resultCard(playerId: string, nickname: string, place: number, ratingPoints: number) {
  return {
    result_id: `result-${playerId}`,
    player_id: playerId,
    nickname,
    place,
    rating_points: ratingPoints,
    entries: 2,
    addons: 0,
    knockouts: 0,
    boss_knockouts: 0,
    mystery_bounty_points: 0,
  };
}

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: id === TARGET_ID ? "Ivan TG" : "Ivan Email",
    admin_display_name: null,
    username: id === TARGET_ID ? "ivan_tg" : null,
    email: id === TARGET_ID ? null : "ivan@example.com",
    telegram_linked: id === TARGET_ID,
    role: "player",
    is_blocked: false,
    merged: false,
    can_access_free: true,
    can_access_paid: false,
    can_access_cash: false,
    club_discount_percent: 0,
    online_registration_restricted: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    target: candidate(TARGET_ID),
    source: candidate(SOURCE_ID),
    final_identity: {
      player_id: TARGET_ID,
      display_name: "Ivan TG",
      email: "ivan@example.com",
      telegram_linked: true,
      telegram_username: "ivan_tg",
      role: "player",
      is_blocked: false,
      online_registration_restricted: false,
    },
    blockers: [],
    warnings: [{ code: "display_name_differs", message: "Имя профиля останется «Ivan TG»" }],
    counts: {
      target: { tournaments: 2, registrations: 2, results: 2, no_shows: 0, team_memberships: 0, dealer_shifts: 0, activity_events: 0 },
      source: { tournaments: 2, registrations: 2, results: 1, no_shows: 1, team_memberships: 0, dealer_shifts: 0, activity_events: 0 },
    },
    tournament_reconciliation: [] as unknown[],
    result_conflicts: [] as unknown[],
    requires_result_resolution: false,
    ...overrides,
  };
}

const conflict = {
  intent: {
    id: "intent-1",
    email: "ivan@example.com",
    status: "conflict",
    conflict_reason: "У найденного аккаунта есть собственная Telegram-идентификация",
    created_at: "2026-10-01T00:00:00.000Z",
  },
  target: { ...candidate(TARGET_ID), telegram_id: 1, merged_into_player_id: null },
  source: { ...candidate(SOURCE_ID), telegram_id: null, merged_into_player_id: null },
  overlappingTournamentIds: [],
  sourceTournamentCount: 0,
  targetTournamentCount: 0,
};

let container: HTMLDivElement;
let root: Root;
let previewResponse: ReturnType<typeof preview>;
let conflictsResponse: unknown[];
// When set, the preview call awaits this instead of resolving immediately.
let previewGate: Promise<void> | null;
let previewFailure: Error | null;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.currentPlayer.current = { id: "admin", role: "admin", display_name: "Admin" } as Player;
  previewResponse = preview();
  conflictsResponse = [conflict];
  previewGate = null;
  previewFailure = null;
  mocks.fetchAdminJson.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/account-merges") return { conflicts: conflictsResponse };
    if (url.startsWith("/api/admin/account-merges/search")) {
      const q = new URL(url, "http://x").searchParams.get("q");
      return { players: q === "tg" ? [candidate(TARGET_ID)] : [candidate(SOURCE_ID), candidate("33333333-3333-4333-8333-333333333333", { merged: true, display_name: "Ghost" })] };
    }
    if (url === "/api/admin/account-merges/preview") {
      if (previewGate) await previewGate;
      if (previewFailure) throw previewFailure;
      return { preview: previewResponse };
    }
    if (url === "/api/admin/account-merges/execute") {
      return {
        ok: true,
        result: {
          merged: true,
          target_player_id: TARGET_ID,
          source_player_id: SOURCE_ID,
          final_identity: previewResponse.final_identity,
          transferred_tournament_count: 2,
        },
        achievementRefreshFailed: false,
      };
    }
    throw new Error(`unexpected ${url} ${init?.method ?? "GET"}`);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render() {
  await act(async () => root.render(<AdminAccountMergesPage />));
  await flush();
}

function q<T extends Element = HTMLElement>(testId: string): T | null {
  return container.querySelector(`[data-testid="${testId}"]`) as T | null;
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await flush();
}

async function pick(side: "merge-target" | "merge-source", query: string) {
  await typeInto(q<HTMLInputElement>(`${side}-search-input`)!, query);
  await click(q(`${side}-search-submit`));
  await click(container.querySelector(`[data-testid="${side}-result"]:not([disabled])`));
}

function precedes(a: Element | null, b: Element | null) {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  return Boolean(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function executeCalls() {
  return mocks.fetchAdminJson.mock.calls.filter(([url]) => url === "/api/admin/account-merges/execute");
}

function previewCalls() {
  return mocks.fetchAdminJson.mock.calls.filter(([url]) => url === "/api/admin/account-merges/preview");
}

describe("Merge Center UI", () => {
  it("renders two account selectors above the preserved conflict queue", async () => {
    await render();

    expect(q("merge-target")?.textContent).toContain("ОСНОВНОЙ АККАУНТ");
    expect(q("merge-source")?.textContent).toContain("ПРИСОЕДИНЯЕМЫЙ АККАУНТ");
    expect(q("merge-swap")?.textContent).toContain("Поменять местами");
    const center = q("merge-center")!;
    const queue = q("conflict-queue")!;
    expect(queue.querySelectorAll('[data-testid="conflict-card"]')).toHaveLength(1);
    expect(center.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not usable by non-admins", async () => {
    mocks.currentPlayer.current = { id: "op", role: "operator" } as Player;
    await render();
    expect(q("merge-center")).toBeNull();
    expect(container.textContent).toContain("Доступ запрещён");
  });

  it("search works; merged-away candidates are shown disabled and cannot be selected", async () => {
    await render();
    await typeInto(q<HTMLInputElement>("merge-source-search-input")!, "ivan");
    await click(q("merge-source-search-submit"));

    const results = container.querySelectorAll<HTMLButtonElement>('[data-testid="merge-source-result"]');
    expect(results).toHaveLength(2);
    expect(results[0].disabled).toBe(false);
    expect(results[1].disabled).toBe(true);
    expect(mocks.fetchAdminJson).toHaveBeenCalledWith("/api/admin/account-merges/search?q=ivan");

    await click(results[0]);
    expect(q("merge-source-selected")?.textContent).toContain("Ivan Email");
  });

  it("selecting both accounts runs the server preview: final identity, counts, warnings render; swap re-runs it with ids reversed", async () => {
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    expect(previewCalls()).toHaveLength(1);
    expect(JSON.parse(previewCalls()[0][1].body)).toEqual({ targetPlayerId: TARGET_ID, sourcePlayerId: SOURCE_ID });
    expect(q("merge-final-identity")?.textContent).toContain("@ivan_tg");
    expect(q("merge-final-identity")?.textContent).toContain("ivan@example.com");
    expect(q("merge-counts")?.textContent).toContain("Неявок: 1");
    expect(q("merge-warnings")?.textContent).toContain("Имя профиля останется");
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);
    expect(q("merge-open-confirm")?.textContent).toBe("Объединить аккаунты");

    await click(q("merge-swap"));
    expect(q("merge-target-selected")?.textContent).toContain("Ivan Email");
    expect(q("merge-source-selected")?.textContent).toContain("Ivan TG");
    expect(JSON.parse(previewCalls()[1][1].body)).toEqual({ targetPlayerId: SOURCE_ID, sourcePlayerId: TARGET_ID });
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);
    expect(q("merge-open-confirm")?.textContent).toBe("Объединить аккаунты");
  });

  it("the primary CTA appears right after both accounts are chosen -- under the swap button, BEFORE the long preview", async () => {
    await render();
    await pick("merge-target", "tg");
    expect(q("merge-open-confirm")).toBeNull();
    await pick("merge-source", "ivan");

    const cta = q("merge-open-confirm");
    expect(container.querySelectorAll('[data-testid="merge-open-confirm"]')).toHaveLength(1);
    expect(precedes(q("merge-swap"), cta)).toBe(true);
    expect(precedes(cta, q("merge-preview"))).toBe(true);

    // The confirmation panel opens directly under the CTA, also above the preview.
    await click(cta);
    expect(precedes(cta, q("merge-confirm"))).toBe(true);
    expect(precedes(q("merge-confirm"), q("merge-preview"))).toBe(true);
  });

  it("CTA is disabled with a 'checking' label while the preview loads, then enables once an eligible preview arrives", async () => {
    let release!: () => void;
    previewGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    const loadingCta = q<HTMLButtonElement>("merge-open-confirm");
    expect(loadingCta?.disabled).toBe(true);
    expect(loadingCta?.textContent).toBe("Проверяем возможность объединения...");
    expect(q("merge-preview")).toBeNull();

    await act(async () => release());
    await flush();

    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);
    expect(q("merge-open-confirm")?.textContent).toBe("Объединить аккаунты");
  });

  it("a failed preview leaves the CTA visible but disabled with an explicit 'could not check' label", async () => {
    previewFailure = new Error("Сервер недоступен");
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    const cta = q<HTMLButtonElement>("merge-open-confirm");
    expect(cta?.disabled).toBe(true);
    expect(cta?.textContent).toBe("Не удалось проверить объединение");
    expect(container.textContent).toContain("Сервер недоступен");
    await click(cta);
    expect(q("merge-confirm")).toBeNull();
    expect(executeCalls()).toHaveLength(0);
  });

  it("blockers render and disable the merge button", async () => {
    previewResponse = preview({
      eligible: false,
      blockers: [
        {
          code: "live_entry_place_conflict",
          message: "Texas Classic — 12.10.2026: в живой игре у аккаунтов записаны разные места (2 и 6)",
        },
      ],
    });
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    expect(q("merge-blockers")?.textContent).toContain("Texas Classic — 12.10.2026");
    const cta = q<HTMLButtonElement>("merge-open-confirm");
    expect(cta).not.toBeNull();
    expect(cta?.disabled).toBe(true);
    expect(cta?.textContent).toBe("Объединение невозможно");
    expect(precedes(cta, q("merge-blockers"))).toBe(true);
    await click(cta);
    expect(q("merge-confirm")).toBeNull();
    expect(executeCalls()).toHaveLength(0);
  });

  it("requires the exact typed confirmation before the execute call fires; success state renders, form resets, queue reloads", async () => {
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");
    await click(q("merge-open-confirm"));

    const confirmPanel = q("merge-confirm")!;
    expect(confirmPanel.textContent).toContain("Основным останется: Ivan TG");
    expect(confirmPanel.textContent).toContain("В него будет объединён: Ivan Email");
    const submit = q<HTMLButtonElement>("merge-confirm-submit")!;
    expect(submit.disabled).toBe(true);

    await typeInto(q<HTMLInputElement>("merge-confirm-input")!, "объединить");
    expect(q<HTMLButtonElement>("merge-confirm-submit")!.disabled).toBe(true);
    await click(q("merge-confirm-submit"));
    expect(executeCalls()).toHaveLength(0);

    await typeInto(q<HTMLInputElement>("merge-confirm-input")!, "ОБЪЕДИНИТЬ");
    expect(q<HTMLButtonElement>("merge-confirm-submit")!.disabled).toBe(false);
    const queueLoadsBefore = mocks.fetchAdminJson.mock.calls.filter(([url]) => url === "/api/admin/account-merges").length;
    conflictsResponse = [];
    await click(q("merge-confirm-submit"));

    expect(executeCalls()).toHaveLength(1);
    expect(JSON.parse(executeCalls()[0][1].body)).toEqual({
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      confirmation: "ОБЪЕДИНИТЬ",
      resultResolutions: {},
    });
    expect(q("merge-success")?.textContent).toContain("Аккаунты объединены");
    expect(q("merge-success")?.textContent).toContain("Перенесено турниров2");
    expect(q("merge-target-selected")).toBeNull();
    expect(q("merge-source-selected")).toBeNull();
    expect(q("merge-preview")).toBeNull();
    const queueLoadsAfter = mocks.fetchAdminJson.mock.calls.filter(([url]) => url === "/api/admin/account-merges").length;
    expect(queueLoadsAfter).toBe(queueLoadsBefore + 1);
    expect(q("conflict-queue-empty")).not.toBeNull();
  });

  it("'Открыть в объединении' prefills target+source from the conflict and runs the SAME preview path (blockers are not bypassed)", async () => {
    previewResponse = preview({
      eligible: false,
      blockers: [{ code: "telegram_conflict", message: "У обоих аккаунтов разные Telegram-аккаунты — объединение заблокировано" }],
    });
    await render();

    await click(q("conflict-open-in-merge"));

    expect(q("merge-target-selected")?.textContent).toContain("Ivan TG");
    expect(q("merge-source-selected")?.textContent).toContain("Ivan Email");
    expect(previewCalls()).toHaveLength(1);
    expect(JSON.parse(previewCalls()[0][1].body)).toEqual({ targetPlayerId: TARGET_ID, sourcePlayerId: SOURCE_ID });
    expect(q("merge-blockers")?.textContent).toContain("разные Telegram-аккаунты");
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(true);
  });

  it("ordinary same-tournament overlap is an informational block, NOT a red blocker; the CTA stays enabled", async () => {
    previewResponse = preview({
      tournament_reconciliation: [
        {
          tournament: { id: TOURNAMENT_ID, title: "CRAZY PINEAPPLE", start_at: "2026-09-13T16:00:00.000Z" },
          collapsed: ["отметка прихода", "ребаи/аддоны"],
          result_conflict: false,
        },
      ],
    });
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    const info = q("merge-tournament-reconciliation");
    expect(info?.textContent).toContain("Совпадающая история турниров будет объединена: 1");
    expect(info?.textContent).toContain("CRAZY PINEAPPLE — 13.09.2026");
    expect(info?.textContent).toContain("отметка прихода, ребаи/аддоны");
    expect(q("merge-blockers")).toBeNull();
    expect(container.textContent).not.toContain("Объединение невозможно");
    expect(q("merge-result-conflicts")).toBeNull();
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);
    expect(q("merge-open-confirm")?.textContent).toBe("Объединить аккаунты");
  });

  it("double result: dedicated choice section; CTA disabled until a result is chosen; confirmation names the kept result; execute sends the choice", async () => {
    previewResponse = preview({
      tournament_reconciliation: [
        {
          tournament: { id: TOURNAMENT_ID, title: "CRAZY PINEAPPLE", start_at: "2026-09-13T16:00:00.000Z" },
          collapsed: ["регистрация"],
          result_conflict: true,
        },
      ],
      result_conflicts: [
        {
          tournament: { id: TOURNAMENT_ID, title: "CRAZY PINEAPPLE", start_at: "2026-09-13T16:00:00.000Z" },
          target: resultCard(TARGET_ID, "TOXIN", 7, 2),
          source: resultCard(SOURCE_ID, "TO_OXIN", 3, 15),
        },
      ],
      requires_result_resolution: true,
    });
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");

    const section = q("merge-result-conflicts");
    expect(section?.textContent).toContain("Нужно выбрать правильный результат");
    expect(section?.textContent).toContain("В этом турнире найдены два результата");
    expect(section?.textContent).toContain("CRAZY PINEAPPLE — 13.09.2026");
    expect(q("merge-result-card-target")?.textContent).toContain("TOXIN");
    expect(q("merge-result-card-target")?.textContent).toContain("Место7");
    expect(q("merge-result-card-target")?.textContent).toContain("Очки рейтинга2");
    expect(q("merge-result-card-target")?.textContent).toContain("Входы2");
    expect(q("merge-result-card-source")?.textContent).toContain("Оставить результат TO_OXIN");
    expect(q("merge-blockers")).toBeNull();

    const cta = q<HTMLButtonElement>("merge-open-confirm");
    expect(cta?.disabled).toBe(true);
    expect(cta?.textContent).toBe("Выберите правильный результат турнира");
    expect(q("merge-cta-result-hint")).not.toBeNull();
    await click(cta);
    expect(q("merge-confirm")).toBeNull();

    await click(q("merge-result-choice-source"));
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);
    expect(q("merge-open-confirm")?.textContent).toBe("Объединить аккаунты");
    await click(q("merge-open-confirm"));
    expect(q("merge-confirm-results")?.textContent).toContain(
      "CRAZY PINEAPPLE — 13.09.2026: будет сохранён результат TO_OXIN (3 место, 15 очк.), результат TOXIN будет удалён"
    );

    // Changing the choice closes the confirmation -- it must be re-read.
    await click(q("merge-result-choice-target"));
    expect(q("merge-confirm")).toBeNull();
    await click(q("merge-open-confirm"));
    expect(q("merge-confirm-results")?.textContent).toContain("будет сохранён результат TOXIN (7 место, 2 очк.)");

    await typeInto(q<HTMLInputElement>("merge-confirm-input")!, "ОБЪЕДИНИТЬ");
    await click(q("merge-confirm-submit"));
    expect(executeCalls()).toHaveLength(1);
    expect(JSON.parse(executeCalls()[0][1].body)).toEqual({
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      confirmation: "ОБЪЕДИНИТЬ",
      resultResolutions: { [TOURNAMENT_ID]: "target" },
    });
  });

  it("a fresh preview (e.g. swap) resets any earlier result choice", async () => {
    previewResponse = preview({
      result_conflicts: [
        {
          tournament: { id: TOURNAMENT_ID, title: "CRAZY PINEAPPLE", start_at: null },
          target: resultCard(TARGET_ID, "TOXIN", 7, 2),
          source: resultCard(SOURCE_ID, "TO_OXIN", 3, 15),
        },
      ],
      requires_result_resolution: true,
    });
    await render();
    await pick("merge-target", "tg");
    await pick("merge-source", "ivan");
    await click(q("merge-result-choice-target"));
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(false);

    await click(q("merge-swap"));
    expect(q<HTMLInputElement>("merge-result-choice-target")?.checked).toBe(false);
    expect(q<HTMLButtonElement>("merge-open-confirm")?.disabled).toBe(true);
  });
});

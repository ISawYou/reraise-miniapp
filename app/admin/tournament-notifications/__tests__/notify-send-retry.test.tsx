// Admin "Уведомления" page against the REAL lib/client-request.ts helper
// with global fetch stubbed (no network, no Telegram). Incident 2026-10-21/22:
// the mass-send POST was auto-retried after nginx's 60s 504 and every
// recipient got the broadcast twice. Proves:
//   - Dry Run keeps the helper's default retry;
//   - the real mass send and Test Send are attempted EXACTLY ONCE on 504;
//   - every real send carries a broadcastId, created once per confirmed action;
//   - already_processing / already_completed responses render a clear status;
//   - the existing dryRun -> confirm -> send flow is unchanged.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mocks = vi.hoisted(() => ({
  viewer: null as Player | null,
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(mocks.viewer),
}));
vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: vi.fn(async () => "init-data"),
  isTelegramMiniAppContext: vi.fn(() => true),
}));
vi.mock("@/components/ui/back-button", () => ({ BackButton: () => null }));

const { default: AdminTournamentNotificationsPage } = await import("@/app/admin/tournament-notifications/page");

const TOURNAMENT = {
  id: "t-1",
  title: "Friday Cup",
  start_at: "2026-10-23T18:00:00.000Z",
  location: "Club",
} as Tournament;

type NotifyBody = {
  tournamentId: string;
  message: string;
  audience: string;
  dryRun: boolean;
  testMode: boolean;
  testTelegramId?: string;
  broadcastId?: string;
};

const fetchMock = vi.fn();
let notifyHandler: (body: NotifyBody, call: number) => Response;
let confirmMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function result(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    tournamentTitle: TOURNAMENT.title,
    audience: "registered",
    totalRecipients: 3,
    successCount: 3,
    failedCount: 0,
    skippedCount: 0,
    errors: [],
    ...extra,
  };
}

function notifyCalls(): NotifyBody[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/admin/tournaments/notify")
    .map(([, init]) => JSON.parse(init.body as string) as NotifyBody);
}

const realSends = () => notifyCalls().filter((b) => !b.dryRun);
const dryRuns = () => notifyCalls().filter((b) => b.dryRun);

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

// Longer than the helper's 400ms retry back-off, so a retry -- if one were
// scheduled -- would have happened by the time we assert.
async function waitPastRetryWindow() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 900));
  });
  await flush();
}

function button(text: string) {
  const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  expect(found, `button "${text}"`).toBeDefined();
  return found as HTMLButtonElement;
}

async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}

async function typeTestTelegramId(value: string) {
  const input = container.querySelector('input[type="text"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function render() {
  await act(async () => root.render(<AdminTournamentNotificationsPage />));
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.viewer = { id: "admin", role: "admin", display_name: "Admin" } as Player;
  let notifyCall = 0;
  notifyHandler = () => json(result());
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/tournaments?scope=all") {
      return json({ tournaments: [TOURNAMENT] });
    }
    if (url === "/api/admin/tournaments/notify") {
      notifyCall += 1;
      return notifyHandler(JSON.parse(init!.body as string), notifyCall);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  confirmMock = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmMock);
  window.confirm = confirmMock as unknown as typeof window.confirm;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Dry Run (read-only) keeps the existing retry", () => {
  it("[1] a failed dry run is retried once and the preview renders", async () => {
    notifyHandler = (body, call) => (call === 1 ? json({}, 504) : json(result({ dryRun: true, successCount: 0 })));
    await render();
    await typeTestTelegramId("111");

    await click("Dry Run");
    await waitPastRetryWindow();

    expect(dryRuns()).toHaveLength(2);
    expect(realSends()).toHaveLength(0);
    expect(dryRuns().every((b) => b.broadcastId === undefined)).toBe(true);
    expect(container.textContent).toContain("Dry Run выполнен");
  });
});

describe("real mass send is never auto-retried", () => {
  it("[2] 504 on the confirmed real send -> exactly ONE real POST, error surfaced", async () => {
    notifyHandler = (body) => (body.dryRun ? json(result({ dryRun: true })) : json({}, 504));
    await render();

    await click("Массовая отправка");
    await waitPastRetryWindow();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(dryRuns()).toHaveLength(1);
    expect(realSends()).toHaveLength(1);
    expect(container.textContent).toContain("Не удалось выполнить запрос");
  });

  it("[2] network failure (TypeError) on the real send -> still exactly ONE attempt", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/tournaments?scope=all") return json({ tournaments: [TOURNAMENT] });
      const body = JSON.parse(init!.body as string) as NotifyBody;
      if (body.dryRun) return json(result({ dryRun: true }));
      throw new TypeError("Failed to fetch");
    });
    await render();

    await click("Массовая отправка");
    await waitPastRetryWindow();

    expect(realSends()).toHaveLength(1);
  });

  it("[4][5] the real body carries one UUID broadcastId; the dry-run preview carries none", async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    notifyHandler = (body) => (body.dryRun ? json(result({ dryRun: true })) : json(result()));
    await render();

    await click("Массовая отправка");

    expect(dryRuns()[0].broadcastId).toBeUndefined();
    expect(realSends()).toHaveLength(1);
    expect(realSends()[0].broadcastId).toMatch(UUID_RE);
    expect(uuidSpy).toHaveBeenCalledTimes(1);
    expect(realSends()[0].broadcastId).toBe(uuidSpy.mock.results[0].value);
  });

  it("[5] two separate confirmed sends use two different ids (deliberate re-send is not blocked)", async () => {
    notifyHandler = (body) => (body.dryRun ? json(result({ dryRun: true })) : json(result()));
    await render();

    await click("Массовая отправка");
    await click("Массовая отправка");

    const ids = realSends().map((b) => b.broadcastId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(UUID_RE);
    expect(ids[1]).toMatch(UUID_RE);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("[17] cancelling the confirm dialog sends nothing and keeps the preview", async () => {
    confirmMock.mockReturnValue(false);
    notifyHandler = () => json(result({ dryRun: true, totalRecipients: 7, successCount: 0 }));
    await render();

    await click("Массовая отправка");

    expect(confirmMock).toHaveBeenCalledWith("Отправить уведомление 7 получателям?");
    expect(realSends()).toHaveLength(0);
    expect(container.textContent).toContain("Dry Run выполнен");
    expect(container.textContent).toContain("Получателей: 7");
  });

  it("[17] confirmed send renders the completed result", async () => {
    notifyHandler = (body) =>
      body.dryRun ? json(result({ dryRun: true })) : json(result({ successCount: 2, failedCount: 1 }));
    await render();

    await click("Массовая отправка");

    expect(container.textContent).toContain("Операция выполнена");
    expect(container.textContent).toContain("Отправлено: 2");
    expect(container.textContent).toContain("Не отправлено: 1");
  });
});

describe("Test Send is a side effect too", () => {
  it("[3] 504 on Test Send -> exactly ONE attempt, with a broadcastId", async () => {
    notifyHandler = () => json({}, 504);
    await render();
    await typeTestTelegramId("111");

    await click("Test Send");
    await waitPastRetryWindow();

    expect(notifyCalls()).toHaveLength(1);
    expect(notifyCalls()[0]).toMatchObject({ dryRun: false, testMode: true, testTelegramId: "111" });
    expect(notifyCalls()[0].broadcastId).toMatch(UUID_RE);
  });
});

describe("duplicate responses render a clear status, not a generic error", () => {
  it("already_processing", async () => {
    notifyHandler = (body) =>
      body.dryRun
        ? json(result({ dryRun: true }))
        : json(result({ ok: false, duplicate: "already_processing", successCount: 0 }), 202);
    await render();

    await click("Массовая отправка");

    expect(container.textContent).toContain("Эта рассылка уже выполняется");
    expect(container.textContent).toContain("Повторно ничего не отправлено");
    expect(realSends()).toHaveLength(1);
  });

  it("already_completed", async () => {
    notifyHandler = (body) =>
      body.dryRun ? json(result({ dryRun: true })) : json(result({ duplicate: "already_completed" }));
    await render();

    await click("Массовая отправка");

    expect(container.textContent).toContain("Эта рассылка уже была выполнена ранее");
    expect(container.textContent).toContain("Отправлено: 3");
  });
});

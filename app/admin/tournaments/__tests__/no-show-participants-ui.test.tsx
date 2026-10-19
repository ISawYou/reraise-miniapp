// Admin tournament edit screen: the no-show waitlist policy UI --
// separate "Основная регистрация" / "Лист ожидания" sections, "Не пришёл"
// (with confirmation), "Допустить в игру", badges, and the refresh after
// each action. Same render harness as free-roll-form.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";
import type { AdminTournamentParticipant } from "@/features/tournaments";

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  getTournamentById: vi.fn(),
  getAdminTournamentParticipants: vi.fn(),
  removeAdminTournamentParticipant: vi.fn(),
  markTournamentPlayerNoShow: vi.fn(),
  admitTournamentPlayerFromWaitlist: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(admin),
}));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));
vi.mock("@/features/tournament-roster-actions", () => ({
  markTournamentPlayerNoShow: mocks.markTournamentPlayerNoShow,
  admitTournamentPlayerFromWaitlist: mocks.admitTournamentPlayerFromWaitlist,
}));
vi.mock("@/features/tournaments", () => ({
  addAdminTournamentParticipant: vi.fn(),
  addExistingPlayerToTournament: vi.fn(),
  getAdminTournamentParticipants: mocks.getAdminTournamentParticipants,
  getTournamentById: mocks.getTournamentById,
  removeAdminTournamentParticipant: mocks.removeAdminTournamentParticipant,
  updateTournament: vi.fn(),
}));

const admin = { id: "admin", role: "operator", display_name: "Op" } as Player;

const { default: AdminTournamentEditPage } = await import("@/app/admin/tournaments/[id]/edit/page");

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    title: "Вечерний",
    description: "d",
    location: "l",
    start_at: "2026-10-12T16:00:00.000Z",
    max_players: 3,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-10-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    placement_points_multiplier: 1,
    is_final: false,
    ...overrides,
  } as Tournament;
}

function participant(
  id: string,
  status: AdminTournamentParticipant["status"],
  extra: Partial<AdminTournamentParticipant> = {}
): AdminTournamentParticipant {
  return {
    registration_id: `reg-${id}`,
    player_id: id,
    admin_nick: id,
    status,
    no_show_count: 0,
    online_registration_restricted: false,
    no_show_at: null,
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.fetchAdminJson.mockResolvedValue({ season: { title: "Осень" } });
  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getAdminTournamentParticipants.mockResolvedValue([
    participant("Alice", "registered"),
    participant("Bob", "registered", { no_show_count: 2 }),
    participant("Cid", "registered"),
    participant("Dan", "waitlist", { online_registration_restricted: true, no_show_count: 1 }),
    participant("Eve", "waitlist"),
  ]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => root.render(<AdminTournamentEditPage />));
  await flush();
}

const q = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

function buttonIn(scope: HTMLElement | null, text: string): HTMLButtonElement | undefined {
  return Array.from(scope?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

async function click(button: HTMLElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await flush();
}

describe("separate sections", () => {
  it("renders registered and waitlist players in visibly separate sections with correct counts", async () => {
    await render();

    const registered = q("registered-section")!;
    const waitlist = q("waitlist-section")!;
    expect(container.textContent).toContain("Основная регистрация");
    expect(container.textContent).toContain("Лист ожидания");
    expect(q("registered-count")!.textContent).toBe("3 / 3");
    expect(q("waitlist-count")!.textContent).toBe("2");

    expect(registered.textContent).toContain("Alice");
    expect(registered.textContent).not.toContain("Dan");
    expect(waitlist.textContent).toContain("Dan");
    expect(waitlist.textContent).toContain("Eve");
    expect(waitlist.textContent).not.toContain("Alice");
  });

  it("registered rows have 'Не пришёл' AND a separate 'Удалить'; waitlist rows have 'Допустить в игру' AND 'Удалить'", async () => {
    await render();

    const aliceRow = q("registered-row-reg-Alice");
    expect(buttonIn(aliceRow, "Не пришёл")).toBeDefined();
    expect(buttonIn(aliceRow, "Удалить")).toBeDefined();
    expect(buttonIn(aliceRow, "Допустить в игру")).toBeUndefined();

    const danRow = q("waitlist-row-reg-Dan");
    expect(buttonIn(danRow, "Допустить в игру")).toBeDefined();
    expect(buttonIn(danRow, "Удалить")).toBeDefined();
    expect(buttonIn(danRow, "Не пришёл")).toBeUndefined();
  });

  it("shows the restriction badge and the derived no-show count where applicable", async () => {
    await render();

    expect(q("waitlist-row-reg-Dan")!.textContent).toContain("⚠ После неявки");
    expect(q("waitlist-row-reg-Dan")!.textContent).toContain("Неявок: 1");
    expect(q("registered-row-reg-Bob")!.textContent).toContain("Неявок: 2");
    expect(q("registered-row-reg-Bob")!.textContent).not.toContain("После неявки");
    expect(q("registered-row-reg-Alice")!.textContent).not.toContain("Неявок");
    expect(q("waitlist-row-reg-Eve")!.textContent).not.toContain("После неявки");
  });
});

describe("'Не пришёл'", () => {
  it("asks for confirmation first; 'Отмена' fires nothing", async () => {
    await render();

    await click(buttonIn(q("registered-row-reg-Alice"), "Не пришёл"));

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Отметить Alice как «Не пришёл»?");
    expect(dialog.textContent).toContain(
      "Игрок будет перенесён в раздел «Не пришли» и не займёт место автоматически, а самостоятельная запись на следующие турниры будет доступна только через лист ожидания до личного визита."
    );
    expect(mocks.markTournamentPlayerNoShow).not.toHaveBeenCalled();

    await click(buttonIn(dialog, "Отмена"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.markTournamentPlayerNoShow).not.toHaveBeenCalled();
  });

  it("confirming fires the action and refreshes: the player moves to 'Не пришли' (NOT the normal waitlist) with the badge, an auto-promoted player moves up", async () => {
    await render();
    mocks.markTournamentPlayerNoShow.mockResolvedValue({ ok: true, promotedCount: 1 });
    mocks.getAdminTournamentParticipants.mockResolvedValue([
      participant("Alice", "waitlist", { online_registration_restricted: true, no_show_count: 1, no_show_at: "2026-10-12T17:00:00Z" }),
      participant("Bob", "registered", { no_show_count: 2 }),
      participant("Cid", "registered"),
      participant("Dan", "waitlist", { online_registration_restricted: true, no_show_count: 1 }),
      participant("Eve", "registered"),
    ]);

    await click(buttonIn(q("registered-row-reg-Alice"), "Не пришёл"));
    await click(buttonIn(container.querySelector('[role="dialog"]') as HTMLElement, "Не пришёл"));

    expect(mocks.markTournamentPlayerNoShow).toHaveBeenCalledWith("t1", "reg-Alice");
    expect(mocks.getAdminTournamentParticipants).toHaveBeenCalledTimes(2);
    expect(q("registered-section")!.textContent).not.toContain("Alice");
    expect(q("waitlist-row-reg-Alice")).toBeNull();
    expect(q("waitlist-section")!.textContent).not.toContain("Alice");
    expect(q("no-show-row-reg-Alice")!.textContent).toContain("⚠ После неявки");
    expect(q("registered-section")!.textContent).toContain("Eve");
    expect(q("registered-count")!.textContent).toBe("3 / 3");
    // Dan is an ordinary (restricted, but not THIS tournament's no-show)
    // waitlist entry; Alice counts only under "Не пришли".
    expect(q("waitlist-count")!.textContent).toBe("1");
    expect(q("no-show-count")!.textContent).toBe("1");
  });

  it("a rejected no-show shows the server's message", async () => {
    await render();
    mocks.markTournamentPlayerNoShow.mockResolvedValue({
      ok: false,
      error: "Турнир ещё не начался — отметить «Не пришёл» можно после старта",
    });

    await click(buttonIn(q("registered-row-reg-Alice"), "Не пришёл"));
    await click(buttonIn(container.querySelector('[role="dialog"]') as HTMLElement, "Не пришёл"));

    expect(container.textContent).toContain("Турнир ещё не начался");
  });

  it("is not offered for a Final Month tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ is_final: true }));
    await render();

    expect(buttonIn(q("registered-row-reg-Alice"), "Не пришёл")).toBeUndefined();
    expect(buttonIn(q("registered-row-reg-Alice"), "Удалить")).toBeDefined();
  });

  it("is not offered (nor admission) for a completed tournament", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    await render();

    expect(buttonIn(q("registered-row-reg-Alice"), "Не пришёл")).toBeUndefined();
    expect(buttonIn(q("waitlist-row-reg-Dan"), "Допустить в игру")).toBeUndefined();
  });
});

describe("'Допустить в игру'", () => {
  it("no free seat => clear error, player stays in the waitlist", async () => {
    await render();
    mocks.admitTournamentPlayerFromWaitlist.mockResolvedValue({
      ok: false,
      error: "Свободных мест нет — игрок остаётся в листе ожидания",
    });

    await click(buttonIn(q("waitlist-row-reg-Dan"), "Допустить в игру"));

    expect(mocks.admitTournamentPlayerFromWaitlist).toHaveBeenCalledWith("t1", "reg-Dan");
    expect(container.textContent).toContain("Свободных мест нет — игрок остаётся в листе ожидания");
    expect(q("waitlist-section")!.textContent).toContain("Dan");
  });

  it("success => refreshed list shows the player in the main registration", async () => {
    await render();
    mocks.admitTournamentPlayerFromWaitlist.mockResolvedValue({ ok: true, promotedCount: 0 });
    mocks.getAdminTournamentParticipants.mockResolvedValue([
      participant("Alice", "registered"),
      participant("Bob", "registered"),
      participant("Dan", "registered", { no_show_count: 1 }),
      participant("Eve", "waitlist"),
    ]);

    await click(buttonIn(q("waitlist-row-reg-Dan"), "Допустить в игру"));

    expect(q("registered-section")!.textContent).toContain("Dan");
    expect(q("registered-row-reg-Dan")!.textContent).not.toContain("После неявки");
    expect(q("waitlist-section")!.textContent).not.toContain("Dan");
    expect(container.textContent).toContain("Dan допущен(а) в игру");
  });
});

describe("'Удалить' stays a separate, unchanged action", () => {
  it("calls only removeAdminTournamentParticipant -- never the no-show action, no confirmation dialog", async () => {
    await render();
    mocks.removeAdminTournamentParticipant.mockResolvedValue(undefined);

    await click(buttonIn(q("registered-row-reg-Alice"), "Удалить"));

    expect(mocks.removeAdminTournamentParticipant).toHaveBeenCalledWith("reg-Alice");
    expect(mocks.markTournamentPlayerNoShow).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("'Не пришли' -- quarantined no-shows get their own section", () => {
  const LONG_NICK = "Очень_Длинный_Никнейм_Игрока_Который_Нельзя_Обрезать_2026";

  beforeEach(() => {
    mocks.getAdminTournamentParticipants.mockResolvedValue([
      participant("Alice", "registered"),
      participant("Bob", "registered", { admin_nick: LONG_NICK }),
      participant("Cid", "attended"),
      // ordinary waitlist (one restricted from an OLD no-show elsewhere)
      participant("Dan", "waitlist", { online_registration_restricted: true, no_show_count: 1 }),
      participant("Eve", "waitlist"),
      // THIS tournament's no-shows
      participant("Fay", "waitlist", {
        online_registration_restricted: true,
        no_show_count: 2,
        no_show_at: "2026-10-12T17:00:00Z",
      }),
      participant("Gus", "waitlist", {
        admin_nick: `${LONG_NICK}_NS`,
        online_registration_restricted: false,
        no_show_count: 1,
        no_show_at: "2026-10-12T17:05:00Z",
      }),
    ]);
  });

  it("no-show rows are NOT in (or counted by) the normal waitlist; 'Не пришли' shows its own count", async () => {
    await render();

    expect(container.textContent).toContain("Не пришли");
    expect(q("registered-count")!.textContent).toBe("3 / 3");
    expect(q("waitlist-count")!.textContent).toBe("2");
    expect(q("no-show-count")!.textContent).toBe("2");
    expect(q("waitlist-section")!.textContent).not.toContain("Fay");
    expect(q("waitlist-row-reg-Fay")).toBeNull();
    expect(q("no-show-section")!.textContent).toContain("Fay");
    expect(q("no-show-section")!.textContent).not.toContain("Dan");
    expect(q("waitlist-row-reg-Dan")).not.toBeNull();
  });

  it("each no-show card: avatar, FULL nickname, compact 'Неявок: N', restriction badge only when restricted; 'Допустить в игру' + 'Удалить', never 'Не пришёл'", async () => {
    await render();

    const fay = q("no-show-row-reg-Fay")!;
    expect(fay.textContent).toContain("Неявок: 2");
    expect(fay.textContent).toContain("⚠ После неявки");
    expect(buttonIn(fay, "Допустить в игру")).toBeDefined();
    expect(buttonIn(fay, "Удалить")).toBeDefined();
    expect(buttonIn(fay, "Не пришёл")).toBeUndefined();
    expect(fay.querySelector('[data-testid="participant-identity"]')!.textContent).toContain("F");

    const gus = q("no-show-row-reg-Gus")!;
    expect(gus.querySelector('[data-testid="participant-nick"]')!.textContent).toBe(`${LONG_NICK}_NS`);
    expect(gus.textContent).toContain("Неявок: 1");
    expect(gus.textContent).not.toContain("После неявки");
  });

  it("'Допустить в игру' on a no-show card uses the existing staff admission", async () => {
    await render();
    mocks.admitTournamentPlayerFromWaitlist.mockResolvedValue({ ok: true, promotedCount: 0 });

    await click(buttonIn(q("no-show-row-reg-Fay"), "Допустить в игру"));

    expect(mocks.admitTournamentPlayerFromWaitlist).toHaveBeenCalledWith("t1", "reg-Fay");
    expect(mocks.getAdminTournamentParticipants).toHaveBeenCalledTimes(2);
  });

  it("a completed tournament hides 'Допустить в игру' on no-show cards too", async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: "completed" }));
    await render();

    expect(buttonIn(q("no-show-row-reg-Fay"), "Допустить в игру")).toBeUndefined();
    expect(buttonIn(q("no-show-row-reg-Fay"), "Удалить")).toBeDefined();
  });

  it("a sheet-cleanup warning from 'Не пришёл' is shown while the no-show itself succeeded", async () => {
    await render();
    mocks.markTournamentPlayerNoShow.mockResolvedValue({
      ok: true,
      promotedCount: 0,
      warning: "Игрок отмечен как «Не пришёл», но Google Таблицу обновить не удалось — строка будет удалена при следующей синхронизации",
    });

    await click(buttonIn(q("registered-row-reg-Alice"), "Не пришёл"));
    await click(buttonIn(container.querySelector('[role="dialog"]') as HTMLElement, "Не пришёл"));

    expect(container.textContent).toContain("отмечен(а) как «Не пришёл»");
    expect(container.textContent).toContain("Google Таблицу обновить не удалось");
  });
});

describe("mobile participant cards (narrow width) -- two levels, nothing truncated", () => {
  const LONG_NICK = "Full_Long_Nickname_That_Must_Stay_Fully_Visible_On_Narrow_Phones";

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    window.dispatchEvent(new Event("resize"));
    mocks.getAdminTournamentParticipants.mockResolvedValue([
      participant("Alice", "registered", { admin_nick: LONG_NICK }),
      participant("Eve", "waitlist", { admin_nick: `${LONG_NICK}_W` }),
      participant("Fay", "waitlist", {
        admin_nick: `${LONG_NICK}_NS`,
        online_registration_restricted: true,
        no_show_count: 3,
        no_show_at: "2026-10-12T17:00:00Z",
      }),
    ]);
  });

  function card(testId: string) {
    const element = q(testId)!;
    const identity = element.querySelector('[data-testid="participant-identity"]') as HTMLElement;
    const actions = element.querySelector('[data-testid="participant-actions"]') as HTMLElement;
    const nick = element.querySelector('[data-testid="participant-nick"]') as HTMLElement;
    return { element, identity, actions, nick };
  }

  it.each([
    ["registered-row-reg-Alice", LONG_NICK, ["Не пришёл", "Удалить"]],
    ["waitlist-row-reg-Eve", `${LONG_NICK}_W`, ["Допустить в игру", "Удалить"]],
    ["no-show-row-reg-Fay", `${LONG_NICK}_NS`, ["Допустить в игру", "Удалить"]],
  ])("%s: TOP = avatar + full nickname (+ badges), BOTTOM = actions", async (testId, nickname, buttons) => {
    await render();
    const { element, identity, actions, nick } = card(testId);

    // Two levels: the card stacks vertically by default (mobile-first);
    // only from `sm` up does it become a single row.
    expect(element.className).toMatch(/(^|\s)flex-col(\s|$)/);
    expect(element.className).toContain("sm:flex-row");
    expect(Array.from(element.children)).toEqual([identity, actions]);

    // Full nickname, wrapping instead of truncation.
    expect(nick.textContent).toBe(nickname);
    expect(nick.className).not.toContain("truncate");
    expect(nick.className).toContain("break-words");
    expect(element.querySelector(".truncate")).toBeNull();

    // Avatar stays visible and fixed-size (never shrinks).
    const avatar = identity.firstElementChild as HTMLElement;
    expect(avatar.className).toContain("flex-shrink-0");
    expect(avatar.className).toContain("h-9");

    // Actions are on their own full-width row, buttons comfortably tappable
    // and sharing the row -- they never squeeze the identity.
    expect(actions.className).toContain("w-full");
    expect(identity.contains(actions)).toBe(false);
    const actionButtons = Array.from(actions.querySelectorAll("button"));
    expect(actionButtons.map((b) => b.textContent?.trim())).toEqual(buttons);
    for (const button of actionButtons) {
      expect(button.className).toContain("min-h-10");
      expect(button.className).toContain("flex-1");
    }
  });

  it("no-show badges are preserved on the mobile card", async () => {
    await render();
    const { identity } = card("no-show-row-reg-Fay");
    expect(identity.textContent).toContain("⚠ После неявки");
    expect(identity.textContent).toContain("Неявок: 3");
  });
});

describe("Late Registration closed -- adding NEW participants is hidden, the roster stays manageable", () => {
  function snapshotResponse(closed: boolean) {
    mocks.fetchAdminJson.mockImplementation(async (url: string) =>
      url.endsWith("/late-registration")
        ? { ok: true, snapshot: closed ? { tournament_id: "t1" } : null }
        : { season: { title: "Осень" } }
    );
  }

  it("closed: no '+ Добавить', an explanation instead; existing roster actions remain", async () => {
    snapshotResponse(true);
    await render();

    expect(buttonIn(container, "+ Добавить")).toBeUndefined();
    expect(container.textContent).toContain("Поздняя регистрация завершена — запись на турнир закрыта");
    expect(buttonIn(container, "Создать нового")).toBeUndefined();
    expect(buttonIn(container, "Добавить существующего")).toBeUndefined();
    // Roster management is untouched.
    expect(container.textContent).toContain("Alice");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Удалить")).toBe(true);
  });

  it("open: '+ Добавить' is offered as before", async () => {
    snapshotResponse(false);
    await render();

    expect(buttonIn(container, "+ Добавить")).toBeDefined();
    expect(container.textContent).not.toContain("Поздняя регистрация завершена");
  });
});

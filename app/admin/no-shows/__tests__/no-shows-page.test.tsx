// Global "Неявки игроков" admin page: list + "Разрешить обычную запись"
// (with confirmation). Server Actions mocked -- their authorization is
// covered in features/__tests__/no-show-admin-actions.test.ts and the data
// path in no-show-quarantine.postgres.integration.test.ts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";
import type { NoShowPlayerSummary } from "@/features/tournament-no-show";

const mocks = vi.hoisted(() => ({
  viewer: null as Player | null,
  getAdminNoShowPlayers: vi.fn(),
  allowPlayerOrdinaryRegistration: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(mocks.viewer),
}));
vi.mock("@/features/no-show-admin-actions", () => ({
  getAdminNoShowPlayers: mocks.getAdminNoShowPlayers,
  allowPlayerOrdinaryRegistration: mocks.allowPlayerOrdinaryRegistration,
}));

const { default: AdminNoShowsPage } = await import("@/app/admin/no-shows/page");

function summary(id: string, extra: Partial<NoShowPlayerSummary> = {}): NoShowPlayerSummary {
  return {
    player_id: id,
    nickname: id,
    telegram_avatar_url: null,
    custom_avatar_url: null,
    no_show_count: 1,
    last_no_show_at: "2026-10-05T18:00:00.000Z",
    online_registration_restricted: false,
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => root.render(<AdminNoShowsPage />));
  await flush();
}

const q = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

function buttonIn(scope: Element | null, text: string) {
  return Array.from(scope?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

async function click(button: HTMLElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.viewer = { id: "op", role: "operator", display_name: "Op" } as Player;
  mocks.getAdminNoShowPlayers.mockResolvedValue([
    summary("Lee", { no_show_count: 2, online_registration_restricted: true, custom_avatar_url: "https://img/lee.png" }),
    summary("Max"),
  ]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Неявки игроков", () => {
  it.each(["operator", "admin"])("%s sees every player with avatar, full nickname, derived count, last date and restriction state", async (role) => {
    mocks.viewer = { id: "staff", role, display_name: "S" } as Player;
    await render();

    expect(container.textContent).toContain("Неявки игроков");
    expect(q("no-show-players-count")!.textContent).toBe("2");
    expect(q("restricted-players-count")!.textContent).toBe("1");
    const lee = q("no-show-player-Lee")!;
    expect(lee.querySelector("img")?.getAttribute("src")).toBe("https://img/lee.png");
    expect(lee.textContent).toContain("Lee");
    expect(lee.querySelector('[data-testid="no-show-total"]')!.textContent).toBe("Неявок: 2");
    expect(lee.textContent).toContain("Последняя: 05.10.2026");
    expect(lee.querySelector('[data-testid="restriction-badge"]')).not.toBeNull();
    expect(buttonIn(lee, "Разрешить обычную запись")).toBeDefined();

    const max = q("no-show-player-Max")!;
    expect(max.querySelector('[data-testid="no-restriction-badge"]')).not.toBeNull();
    expect(buttonIn(max, "Разрешить обычную запись")).toBeUndefined();
  });

  it("a normal player is denied the page and no data is requested", async () => {
    mocks.viewer = { id: "p", role: "player", display_name: "P" } as Player;
    await render();

    expect(container.textContent).toContain("Доступ запрещён");
    expect(mocks.getAdminNoShowPlayers).not.toHaveBeenCalled();
  });

  it("'Разрешить обычную запись' asks for confirmation (history is kept); Отмена does nothing", async () => {
    await render();

    await click(buttonIn(q("no-show-player-Lee"), "Разрешить обычную запись"));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Снять ограничение на самостоятельную запись?");
    expect(dialog.textContent).toContain("История неявок сохранится.");

    await click(buttonIn(dialog, "Отмена"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.allowPlayerOrdinaryRegistration).not.toHaveBeenCalled();
  });

  it("confirming clears only the restriction: the refreshed list keeps the same no-show count", async () => {
    await render();
    mocks.allowPlayerOrdinaryRegistration.mockResolvedValue({ ok: true, cleared: true });
    mocks.getAdminNoShowPlayers.mockResolvedValue([
      summary("Lee", { no_show_count: 2, online_registration_restricted: false }),
      summary("Max"),
    ]);

    await click(buttonIn(q("no-show-player-Lee"), "Разрешить обычную запись"));
    await click(buttonIn(container.querySelector('[role="dialog"]'), "Разрешить обычную запись"));

    expect(mocks.allowPlayerOrdinaryRegistration).toHaveBeenCalledWith("Lee");
    expect(mocks.getAdminNoShowPlayers).toHaveBeenCalledTimes(2);
    const lee = q("no-show-player-Lee")!;
    expect(lee.querySelector('[data-testid="no-show-total"]')!.textContent).toBe("Неявок: 2");
    expect(lee.querySelector('[data-testid="no-restriction-badge"]')).not.toBeNull();
    expect(container.textContent).toContain("История неявок сохранена");
  });
});

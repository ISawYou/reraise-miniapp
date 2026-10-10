// Admin create/edit forms: the FREE-ROLL option, its template, and what it
// submits. Same harness as boost-multiplier-form.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  getTournamentById: vi.fn(),
  updateTournament: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(admin),
}));

vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));

vi.mock("@/features/tournaments", () => ({
  addAdminTournamentParticipant: vi.fn(),
  addExistingPlayerToTournament: vi.fn(),
  getAdminTournamentParticipants: vi.fn().mockResolvedValue([]),
  getTournamentById: mocks.getTournamentById,
  removeAdminTournamentParticipant: vi.fn(),
  updateTournament: mocks.updateTournament,
}));

const admin: Player = {
  id: "admin",
  telegram_id: 1,
  username: "admin",
  display_name: "Admin",
  role: "admin",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
} as Player;

const createModule = await import("@/app/admin/tournaments/create/page");
const editModule = await import("@/app/admin/tournaments/[id]/edit/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.fetchAdminJson.mockImplementation((url: string) =>
    url.includes("/seasons/resolve")
      ? Promise.resolve({ season: { title: "Осень" } })
      : Promise.resolve({ tournament: {} })
  );
  mocks.updateTournament.mockResolvedValue({});
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

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const FREE_ROLL_DESCRIPTION =
  "Классический фриролл по Texas Hold'em. Первый вход в турнир бесплатный для каждого игрока. Re-entry и Add-on оплачиваются по обычным правилам и продолжают увеличивать рейтинговый пул турнира. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.";

function titleInput(): HTMLInputElement {
  return container.querySelector('input[type="text"]') as HTMLInputElement;
}

function descriptionInput(): HTMLTextAreaElement {
  return container.querySelector("textarea") as HTMLTextAreaElement;
}

function multiplierInput(): HTMLInputElement | null {
  const label = Array.from(container.querySelectorAll("label")).find((l) =>
    l.textContent?.startsWith("Коэффициент буста")
  );
  return (label?.nextElementSibling as HTMLInputElement | null) ?? null;
}

function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  )!;
  return act(async () => button.click());
}

describe("type options", () => {
  it.each([createModule, editModule])("both screens offer Free-roll", (mod) => {
    expect(mod.TOURNAMENT_TYPE_OPTIONS).toContainEqual({ value: "free_roll", label: "Free-roll" });
  });
});

describe("create screen", () => {
  async function render() {
    await act(async () => root.render(<createModule.default />));
    await flush();
  }

  function submittedBody() {
    const call = mocks.fetchAdminJson.mock.calls.find(([url]) => url === "/api/admin/tournaments");
    return JSON.parse(call![1].body);
  }

  it("selecting Free-roll fills FREE-ROLL + the canonical description and submits free_roll", async () => {
    await render();
    await act(async () => setValue(container.querySelector("select")!, "free_roll"));
    await act(async () =>
      setValue(container.querySelector('input[type="datetime-local"]')!, "2026-10-20T19:00")
    );

    expect(titleInput().value).toBe("FREE-ROLL");
    expect(descriptionInput().value).toBe(FREE_ROLL_DESCRIPTION);
    expect(multiplierInput()).toBeNull();

    await click("Создать турнир");
    await flush();
    expect(submittedBody()).toMatchObject({
      tournament_type: "free_roll",
      title: "FREE-ROLL",
      description: FREE_ROLL_DESCRIPTION,
      placement_points_multiplier: 1,
      is_final: false,
    });
  });
});

describe("edit screen", () => {
  function tournament(overrides: Partial<Tournament> = {}): Tournament {
    return {
      id: "t1",
      title: "ФИНАЛ МЕСЯЦА",
      description: "d",
      location: "l",
      start_at: "2026-10-20T16:00:00.000Z",
      max_players: 40,
      kind: "free",
      tournament_type: "classic",
      season_id: null,
      status: "open",
      created_at: "2026-09-01T00:00:00.000Z",
      rating_formula_version: "v2",
      rating_guarantee: null,
      placement_points_multiplier: 1,
      is_final: true,
      ...overrides,
    };
  }

  async function render(t: Tournament) {
    mocks.getTournamentById.mockResolvedValue(t);
    await act(async () => root.render(<editModule.default />));
    await flush();
  }

  it("loads a stored free_roll tournament with Free-roll selected", async () => {
    await render(tournament({ tournament_type: "free_roll", is_final: false, title: "FREE-ROLL" }));
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("free_roll");
  });

  it("leaving Final Month for Free-roll fills the FREE-ROLL template and saves free_roll", async () => {
    await render(tournament());
    await act(async () => setValue(container.querySelector("select")!, "free_roll"));

    expect(titleInput().value).toBe("FREE-ROLL");
    expect(descriptionInput().value).toBe(FREE_ROLL_DESCRIPTION);

    await click("Сохранить");
    await flush();
    expect(mocks.updateTournament).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        tournament_type: "free_roll",
        is_final: false,
        title: "FREE-ROLL",
        description: FREE_ROLL_DESCRIPTION,
        placement_points_multiplier: 1,
      })
    );
  });
});

// Admin create/edit forms: Bomb Pot / Boost Rating options, templates, and
// the Boost placement multiplier field (default 2 on create, stored value
// preserved on edit, non-boost presets submit 1).
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
  it.each([createModule, editModule])("both screens offer Bomb Pot and Boost Rating", (mod) => {
    expect(mod.TOURNAMENT_TYPE_OPTIONS).toContainEqual({ value: "bomb_pot", label: "Bomb Pot" });
    expect(mod.TOURNAMENT_TYPE_OPTIONS).toContainEqual({ value: "boost_rating", label: "Boost Rating" });
  });
});

describe("create screen", () => {
  async function render() {
    await act(async () => root.render(<createModule.default />));
    await flush();
  }

  async function fillAndSelect(preset: string) {
    await act(async () => setValue(container.querySelector("select")!, preset));
    await act(async () =>
      setValue(container.querySelector('input[type="datetime-local"]')!, "2026-10-03T19:00")
    );
  }

  function submittedBody() {
    const call = mocks.fetchAdminJson.mock.calls.find(([url]) => url === "/api/admin/tournaments");
    return JSON.parse(call![1].body);
  }

  it("selecting Boost Rating fills the RERAISE MAIN EVENT template and defaults the multiplier to 2", async () => {
    await render();
    expect(multiplierInput()).toBeNull();

    await fillAndSelect("boost_rating");
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe(
      "RERAISE MAIN EVENT"
    );
    expect(multiplierInput()!.value).toBe("2");

    await click("Создать турнир");
    await flush();
    expect(submittedBody()).toMatchObject({
      tournament_type: "boost_rating",
      title: "RERAISE MAIN EVENT",
      placement_points_multiplier: 2,
    });
  });

  it("an edited 1.5 is submitted as 1.5", async () => {
    await render();
    await fillAndSelect("boost_rating");
    await act(async () => setValue(multiplierInput()!, "1.5"));
    await click("Создать турнир");
    await flush();
    expect(submittedBody().placement_points_multiplier).toBe(1.5);
  });

  it("an invalid multiplier blocks submission", async () => {
    await render();
    await fillAndSelect("boost_rating");
    await act(async () => setValue(multiplierInput()!, "0"));
    await click("Создать турнир");
    await flush();
    expect(mocks.fetchAdminJson.mock.calls.some(([url]) => url === "/api/admin/tournaments")).toBe(false);
    expect(container.textContent).toContain("Коэффициент буста должен быть положительным");
  });

  it("Bomb Pot: BOMB POT template, no multiplier field, submits 1", async () => {
    await render();
    await fillAndSelect("bomb_pot");
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe("BOMB POT");
    expect(multiplierInput()).toBeNull();
    await click("Создать турнир");
    await flush();
    expect(submittedBody()).toMatchObject({ tournament_type: "bomb_pot", placement_points_multiplier: 1 });
  });
});

describe("edit screen", () => {
  function tournament(overrides: Partial<Tournament> = {}): Tournament {
    return {
      id: "t1",
      title: "RERAISE MAIN EVENT",
      description: "d",
      location: "l",
      start_at: "2026-10-03T16:00:00.000Z",
      max_players: 40,
      kind: "free",
      tournament_type: "boost_rating",
      season_id: null,
      status: "open",
      created_at: "2026-09-01T00:00:00.000Z",
      rating_formula_version: "v2",
      rating_guarantee: null,
      placement_points_multiplier: 1.5,
      is_final: false,
      ...overrides,
    };
  }

  async function render(t: Tournament) {
    mocks.getTournamentById.mockResolvedValue(t);
    await act(async () => root.render(<editModule.default />));
    await flush();
  }

  it("loads and re-submits the STORED multiplier unchanged (1.5, not the default 2)", async () => {
    await render(tournament());
    expect(multiplierInput()!.value).toBe("1.5");

    await click("Сохранить");
    await flush();
    expect(mocks.updateTournament).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ tournament_type: "boost_rating", placement_points_multiplier: 1.5 })
    );
  });

  it("an ordinary tournament has no multiplier field and submits 1", async () => {
    await render(tournament({ tournament_type: "classic", placement_points_multiplier: 1 }));
    expect(multiplierInput()).toBeNull();

    await click("Сохранить");
    await flush();
    expect(mocks.updateTournament).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ tournament_type: "classic", placement_points_multiplier: 1 })
    );
  });
});

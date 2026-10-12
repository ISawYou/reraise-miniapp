// Player-facing side of the no-show waitlist policy on the tournament page:
// the compact "Запись бронирует место" hint, the restricted waitlist
// explanation (a SUCCESSFUL waitlist registration, never "Ошибка записи"),
// and that cancelling stays available. Same harness as fixed-cta.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, RegistrationStatus, Tournament } from "@/types/domain";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const m = vi.hoisted(() => ({
  resolveCurrentPlayer: vi.fn(),
  getVisibleTournamentByIdForPlayer: vi.fn(),
  getTournamentParticipants: vi.fn(),
  getTournamentResults: vi.fn(),
  getPlayerRegistrationForTournament: vi.fn(),
  registerPlayerForTournament: vi.fn(),
  cancelPlayerRegistration: vi.fn(),
  getMyOnlineRegistrationRestriction: vi.fn(),
}));

vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: () => m.resolveCurrentPlayer() }));
vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentByIdForPlayer: m.getVisibleTournamentByIdForPlayer,
  getTournamentParticipants: m.getTournamentParticipants,
  getTournamentResults: m.getTournamentResults,
  getPlayerRegistrationForTournament: m.getPlayerRegistrationForTournament,
  registerPlayerForTournament: m.registerPlayerForTournament,
  cancelPlayerRegistration: m.cancelPlayerRegistration,
  getMyOnlineRegistrationRestriction: m.getMyOnlineRegistrationRestriction,
}));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));

const { default: TournamentDetailsPage } = await import("@/app/tournaments/[id]/page");

const player = { id: "p1", role: "player", display_name: "P1" } as Player;

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    title: "Test Tournament",
    start_at: "2099-01-01T00:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  } as Tournament;
}

const HINT = "Запись бронирует место. Если планы изменились — отмени её заранее.";
const EXPLANATION = "После прошлой неявки место подтверждает администратор при личном визите в клуб.";

let container: HTMLDivElement;
let root: Root;
let currentStatus: RegistrationStatus | null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  currentStatus = null;

  m.resolveCurrentPlayer.mockReset().mockResolvedValue(player);
  m.getVisibleTournamentByIdForPlayer.mockReset().mockResolvedValue(tournament());
  m.getTournamentParticipants.mockReset().mockResolvedValue([]);
  m.getTournamentResults.mockReset().mockResolvedValue([]);
  m.getPlayerRegistrationForTournament
    .mockReset()
    .mockImplementation(async () => (currentStatus ? { status: currentStatus } : null));
  m.registerPlayerForTournament.mockReset();
  m.cancelPlayerRegistration.mockReset().mockResolvedValue(undefined);
  m.getMyOnlineRegistrationRestriction.mockReset().mockResolvedValue({ restricted: false });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ visuals: [] }) }) as Response)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  await act(async () => root.render(<TournamentDetailsPage />));
  await flush();
}

function fixedPanel(): HTMLElement {
  return Array.from(container.querySelectorAll("div")).find((el) =>
    el.className.includes("bottom-[calc(env(safe-area-inset-bottom)+92px)]")
  ) as HTMLElement;
}

function button(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((el) => el.textContent?.includes(text));
}

async function click(el: HTMLElement | undefined) {
  expect(el).toBeDefined();
  await act(async () => el!.click());
  await flush();
}

async function openRegistrationTab() {
  await click(button(container, "Регистрация"));
}

describe("compact hint near the registration control", () => {
  it("is shown under the CTA for an unregistered player (not a giant warning)", async () => {
    await render();
    const panel = fixedPanel();
    expect(panel.textContent).toContain(HINT);
    const hint = Array.from(panel.querySelectorAll("p")).find((p) => p.textContent === HINT)!;
    expect(hint.className).toContain("text-[11px]");
  });

  it("is not shown on an invite-only Final Month", async () => {
    m.getVisibleTournamentByIdForPlayer.mockResolvedValue(tournament({ is_final: true }));
    await render();
    expect(container.textContent).not.toContain(HINT);
  });
});

describe("normal (unrestricted) player -- unchanged", () => {
  it("registering shows the usual success, no restricted copy", async () => {
    m.registerPlayerForTournament.mockImplementation(async () => {
      currentStatus = "registered";
      return { status: "registered" };
    });
    await render();
    await click(button(fixedPanel(), "Записаться на турнир"));
    await openRegistrationTab();

    expect(container.textContent).toContain("Вы записаны на турнир");
    expect(container.textContent).not.toContain(EXPLANATION);
    expect(container.textContent).not.toContain("Ошибка записи");
  });

  it("an unrestricted waitlist registration keeps the existing copy", async () => {
    m.registerPlayerForTournament.mockImplementation(async () => {
      currentStatus = "waitlist";
      return { status: "waitlist" };
    });
    await render();
    await click(button(fixedPanel(), "Записаться на турнир"));
    await openRegistrationTab();

    expect(container.textContent).toContain("Вы добавлены в список ожидания");
    expect(container.textContent).not.toContain(EXPLANATION);
  });
});

describe("restricted player", () => {
  it("'Записаться' => a successful waitlist result with the explanation -- never 'Ошибка записи'", async () => {
    m.registerPlayerForTournament.mockImplementation(async () => {
      currentStatus = "waitlist";
      return { status: "waitlist", online_registration_restricted: true };
    });
    await render();
    await click(button(fixedPanel(), "Записаться на турнир"));
    await openRegistrationTab();

    expect(container.textContent).toContain("Вы добавлены в лист ожидания.");
    expect(container.textContent).toContain(EXPLANATION);
    expect(container.textContent).not.toContain("Ошибка записи");
  });

  it("already waitlisted: 'Вы в листе ожидания' + the secondary explanation, and leaving the waitlist stays available", async () => {
    currentStatus = "waitlist";
    m.getMyOnlineRegistrationRestriction.mockResolvedValue({ restricted: true });
    await render();
    await openRegistrationTab();

    expect(container.textContent).toContain("Вы в листе ожидания");
    expect(fixedPanel().textContent).toContain(EXPLANATION);

    const leave = button(fixedPanel(), "Выйти из списка ожидания");
    await click(leave);
    expect(m.cancelPlayerRegistration).toHaveBeenCalledWith("p1", "t1");
  });

  it("a restricted player who still holds an earlier REGISTERED seat can cancel it normally", async () => {
    currentStatus = "registered";
    m.getMyOnlineRegistrationRestriction.mockResolvedValue({ restricted: true });
    await render();

    await click(button(fixedPanel(), "Вы записаны"));
    expect(m.cancelPlayerRegistration).toHaveBeenCalledWith("p1", "t1");
  });

  it("the restriction lookup failing never breaks the page", async () => {
    m.getMyOnlineRegistrationRestriction.mockRejectedValue(new Error("boom"));
    await render();
    expect(button(fixedPanel(), "Записаться на турнир")).toBeDefined();
  });
});

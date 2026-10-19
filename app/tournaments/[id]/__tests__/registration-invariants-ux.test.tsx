// Player-facing mirror of the registration invariants on the tournament
// page (the server enforces both regardless -- see
// features/__tests__/registration-invariants*.test.ts):
//   - after a recorded arrival the CTA is informational ("Вы участвуете в
//     турнире"), never a cancel button, and cancelPlayerRegistration is
//     never dispatched -- even after busting out;
//   - after Late Registration closes, a player without a registration sees
//     a disabled "Поздняя регистрация завершена" state, no register/waitlist
//     button. Same harness as no-show-registration-ux.test.tsx.
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
  getMyTournamentRegistrationGuards: vi.fn(),
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
  getMyTournamentRegistrationGuards: m.getMyTournamentRegistrationGuards,
}));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));

const { default: TournamentDetailsPage } = await import("@/app/tournaments/[id]/page");

const player = { id: "p1", role: "player", display_name: "P1" } as Player;

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    title: "Test Tournament",
    start_at: "2020-01-01T00:00:00.000Z",
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
  m.getMyTournamentRegistrationGuards
    .mockReset()
    .mockResolvedValue({ lateRegistrationClosed: false, arrived: false });

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

function buttons(scope: ParentNode, text: string): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button")).filter((el) => el.textContent?.includes(text));
}

describe("arrived player -- no self-cancel CTA", () => {
  it("shows 'Вы участвуете в турнире' as information (no button anywhere) and never dispatches cancel", async () => {
    currentStatus = "registered";
    m.getMyTournamentRegistrationGuards.mockResolvedValue({ lateRegistrationClosed: true, arrived: true });

    await render();

    const panel = fixedPanel();
    expect(panel.textContent).toContain("Вы участвуете в турнире");
    expect(panel.querySelector("button")).toBeNull();
    // Neither the fixed CTA nor the in-card action is a clickable cancel.
    expect(buttons(container, "Вы записаны")).toHaveLength(0);
    expect(buttons(container, "Вы участвуете в турнире")).toHaveLength(0);
    expect(panel.textContent).not.toContain("Запись бронирует место");

    for (const el of Array.from(container.querySelectorAll<HTMLElement>("div, span"))) {
      if (el.textContent === "Вы участвуете в турнире") {
        await act(async () => el.click());
      }
    }
    await flush();
    expect(m.cancelPlayerRegistration).not.toHaveBeenCalled();
  });

  it("a registered player who has NOT arrived keeps the normal cancel button", async () => {
    currentStatus = "registered";

    await render();

    expect(buttons(fixedPanel(), "Вы записаны")).toHaveLength(1);
  });
});

describe("Late Registration closed -- no new entry CTA", () => {
  it("an unregistered player sees 'Поздняя регистрация завершена', no register/waitlist button", async () => {
    m.getMyTournamentRegistrationGuards.mockResolvedValue({ lateRegistrationClosed: true, arrived: false });

    await render();

    const panel = fixedPanel();
    expect(panel.textContent).toContain("Поздняя регистрация завершена");
    expect(panel.querySelector("button")).toBeNull();
    expect(buttons(container, "Записаться")).toHaveLength(0);
    expect(buttons(container, "Встать в список ожидания")).toHaveLength(0);
    expect(m.registerPlayerForTournament).not.toHaveBeenCalled();
  });

  it("an existing (not arrived) registration keeps its normal cancel control after close", async () => {
    currentStatus = "registered";
    m.getMyTournamentRegistrationGuards.mockResolvedValue({ lateRegistrationClosed: true, arrived: false });

    await render();

    expect(buttons(fixedPanel(), "Вы записаны")).toHaveLength(1);
  });

  it("a guard lookup failure never blocks the page (server still enforces)", async () => {
    m.getMyTournamentRegistrationGuards.mockRejectedValue(new Error("boom"));

    await render();

    expect(buttons(fixedPanel(), "Записаться на турнир")).toHaveLength(1);
  });
});

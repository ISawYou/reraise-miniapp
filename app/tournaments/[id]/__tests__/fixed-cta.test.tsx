// Restored large fixed registration CTA above the bottom nav
// (app/tournaments/[id]/page.tsx) -- coexists with the small in-card CTA
// the shared TournamentCard already renders, both driven by the exact same
// registrationStatus/handleRegister/handleCancel, never a second business
// logic path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Player,
  RegistrationStatus,
  Tournament,
  TournamentParticipant,
} from "@/types/domain";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const resolveCurrentPlayerMock = vi.fn();
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => resolveCurrentPlayerMock(),
}));

const getVisibleTournamentByIdForPlayerMock = vi.fn();
const getTournamentParticipantsMock = vi.fn();
const getTournamentResultsMock = vi.fn();
const getPlayerRegistrationForTournamentMock = vi.fn();
const registerPlayerForTournamentMock = vi.fn();
const cancelPlayerRegistrationMock = vi.fn();

vi.mock("@/features/tournaments", () => ({
  getVisibleTournamentByIdForPlayer: (...args: unknown[]) =>
    getVisibleTournamentByIdForPlayerMock(...args),
  getTournamentParticipants: (...args: unknown[]) => getTournamentParticipantsMock(...args),
  getTournamentResults: (...args: unknown[]) => getTournamentResultsMock(...args),
  getPlayerRegistrationForTournament: (...args: unknown[]) =>
    getPlayerRegistrationForTournamentMock(...args),
  registerPlayerForTournament: (...args: unknown[]) => registerPlayerForTournamentMock(...args),
  cancelPlayerRegistration: (...args: unknown[]) => cancelPlayerRegistrationMock(...args),
}));

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
}));

const { default: TournamentDetailsPage } = await import("@/app/tournaments/[id]/page");

let container: HTMLDivElement;
let root: Root;

const player: Player = {
  id: "p1",
  telegram_id: 1,
  username: "p1",
  display_name: "Player One",
  role: "player",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
} as Player;

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

function participant(overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    registration_id: "r1",
    player_id: "someone-else",
    status: "registered",
    created_at: "2026-01-01T00:00:00.000Z",
    username: null,
    display_name: "Someone Else",
    rating: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  resolveCurrentPlayerMock.mockReset().mockResolvedValue(player);
  getVisibleTournamentByIdForPlayerMock.mockReset();
  getTournamentParticipantsMock.mockReset().mockResolvedValue([]);
  getTournamentResultsMock.mockReset().mockResolvedValue([]);
  getPlayerRegistrationForTournamentMock.mockReset().mockResolvedValue(null);
  registerPlayerForTournamentMock.mockReset().mockResolvedValue({ status: "registered" });
  cancelPlayerRegistrationMock.mockReset().mockResolvedValue(undefined);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/tournament-visuals")) {
        return { ok: true, json: async () => ({ visuals: [] }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    })
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderDetail(options: {
  tournamentOverrides?: Partial<Tournament>;
  registrationStatus?: RegistrationStatus | null;
  participants?: TournamentParticipant[];
} = {}) {
  getVisibleTournamentByIdForPlayerMock.mockResolvedValue(tournament(options.tournamentOverrides));
  getPlayerRegistrationForTournamentMock.mockResolvedValue(
    options.registrationStatus ? { status: options.registrationStatus } : null
  );
  if (options.participants) {
    getTournamentParticipantsMock.mockResolvedValue(options.participants);
  }

  await act(async () => {
    root.render(<TournamentDetailsPage />);
  });
  // Flush the async init() chain (resolveCurrentPlayer -> refreshPageData).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getFixedWrapper(): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("div")).find((el) =>
    el.className.includes("bottom-[calc(env(safe-area-inset-bottom)+92px)]")
  );
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((el) => el.textContent === text);
}

describe("Tournament detail -- fixed CTA above bottom nav", () => {
  it("renders the shared TournamentCard's own small CTA (not registered)", async () => {
    await renderDetail();
    expect(buttonWithText(container, "Записаться")).toBeDefined();
  });

  it("also renders the large fixed CTA for a normal, non-completed tournament", async () => {
    await renderDetail();
    const wrapper = getFixedWrapper();
    expect(wrapper).toBeDefined();
    expect(buttonWithText(wrapper!, "Записаться на турнир")).toBeDefined();
  });

  it("the unregistered fixed CTA calls the existing register handler", async () => {
    await renderDetail();
    const wrapper = getFixedWrapper()!;
    const button = buttonWithText(wrapper, "Записаться на турнир")!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(registerPlayerForTournamentMock).toHaveBeenCalledWith("p1", "t1");
  });

  it("a full tournament shows waitlist copy on the fixed CTA", async () => {
    await renderDetail({
      tournamentOverrides: { max_players: 1 },
      participants: [participant({ status: "registered", player_id: "p1" })],
    });

    const wrapper = getFixedWrapper()!;
    expect(buttonWithText(wrapper, "Встать в список ожидания")).toBeDefined();
  });

  it("registered: the fixed CTA reflects the current registered state and calls the existing cancel handler", async () => {
    await renderDetail({ registrationStatus: "registered" });

    const wrapper = getFixedWrapper()!;
    const button = buttonWithText(wrapper, "Вы записаны");
    expect(button).toBeDefined();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelPlayerRegistrationMock).toHaveBeenCalledWith("p1", "t1");
  });

  it("waitlist: the fixed CTA uses the existing cancel handler", async () => {
    await renderDetail({ registrationStatus: "waitlist" });

    const wrapper = getFixedWrapper()!;
    const button = buttonWithText(wrapper, "Выйти из списка ожидания");
    expect(button).toBeDefined();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelPlayerRegistrationMock).toHaveBeenCalledWith("p1", "t1");
  });

  it("Final Month: the fixed state is informational/invite-only, never a button", async () => {
    await renderDetail({ tournamentOverrides: { is_final: true }, registrationStatus: null });

    const wrapper = getFixedWrapper()!;
    expect(wrapper.textContent).toContain("Только по приглашению");
    expect(wrapper.querySelector("button")).toBeNull();
  });

  it("Final Month, in the roster: the fixed state shows the in-final wording, still no button", async () => {
    await renderDetail({
      tournamentOverrides: { is_final: true },
      registrationStatus: "registered",
    });

    const wrapper = getFixedWrapper()!;
    expect(wrapper.textContent).toContain("Вы в составе финала");
    expect(wrapper.querySelector("button")).toBeNull();
  });

  it("a completed tournament renders no fixed CTA at all", async () => {
    await renderDetail({ tournamentOverrides: { status: "completed" } });
    expect(getFixedWrapper()).toBeUndefined();
  });

  it("the fixed wrapper is positioned above the bottom nav via safe-area-aware offsets", async () => {
    await renderDetail();
    const wrapper = getFixedWrapper()!;
    expect(wrapper.className).toContain("fixed");
    expect(wrapper.className).toContain("bottom-[calc(env(safe-area-inset-bottom)+92px)]");
    expect(wrapper.className).toContain("z-20");
  });

  it("the page reserves enough bottom padding for the fixed CTA + bottom nav", async () => {
    await renderDetail();
    const main = container.querySelector("main");
    expect(main?.className).toContain("pb-44");
  });

  it("Home (app/page.tsx) does not gain a fixed CTA -- restore is scoped to the detail page only", () => {
    const source = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    expect(source).not.toContain("bottom-[calc(env(safe-area-inset-bottom)+92px)]");
  });
});

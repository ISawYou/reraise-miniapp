import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({ fetchAdminJson: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
}));

vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));

const player: Player = {
  id: "viewer-1",
  telegram_id: 1,
  username: "viewer",
  display_name: "Viewer",
  role: "player",
  is_blocked: false,
} as Player;

const { default: TeamsPage } = await import("@/app/teams/page");

let container: HTMLDivElement;
let root: Root;

function standing(overrides: Record<string, unknown> = {}) {
  return {
    team_id: "team-1",
    name: "Sharks",
    emblem: "🦈",
    status: "active",
    points: 100,
    rank: 1,
    member_count: 3,
    ...overrides,
  };
}

function myTeamState(overrides: Record<string, unknown> = {}) {
  return {
    team: null,
    pending_invitations: [],
    is_captain: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  mocks.fetchAdminJson.mockImplementation((url: string) => {
    if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
    if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
    if (url === "/api/teams/me") return Promise.resolve(myTeamState());
    return Promise.reject(new Error(`unexpected fetchAdminJson call: ${url}`));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render() {
  await act(async () => root.render(<TeamsPage />));
  await flush();
}

function click(text: string) {
  const el = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
  return act(async () => el.click());
}

describe("Teams -- Рейтинг tab", () => {
  it("renders empty state when no team has points", async () => {
    await render();
    expect(container.textContent).toContain("Пока ни одна команда не набрала очков");
  });

  it("renders standings with rank/emblem/name/points/member count", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?"))
        return Promise.resolve({ standings: [standing(), standing({ team_id: "team-2", name: "Wolves", rank: 1, points: 100 })] });
      return Promise.resolve(myTeamState());
    });
    await render();

    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("Wolves");
    expect(container.textContent).toContain("3 / 5");
  });

  it("tie ranks: two teams with equal points both show rank 1 (never an invented tiebreak)", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?"))
        return Promise.resolve({
          standings: [standing({ team_id: "a", name: "Alpha", rank: 1 }), standing({ team_id: "b", name: "Beta", rank: 1 })],
        });
      return Promise.resolve(myTeamState());
    });
    await render();

    const rankCells = Array.from(container.querySelectorAll("a")).map((a) => a.querySelector("div")?.textContent);
    expect(rankCells.filter((c) => c === "1")).toHaveLength(2);
  });

  it("switching to Архив requires a season before querying, then queries with the chosen seasonId", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [{ id: "s1", title: "Осень 2025", isActive: false }] });
      if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
      return Promise.resolve(myTeamState());
    });
    await render();

    await click("Архив");
    await flush();
    expect(container.textContent).toContain("Выберите архивный сезон");

    const select = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "s1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(
      mocks.fetchAdminJson.mock.calls.some((call: unknown[]) => call[0] === "/api/teams?scope=archive&seasonId=s1")
    ).toBe(true);
  });

  it("Текущий сезон / За всё время query the correct scope", async () => {
    await render();
    await click("За всё время");
    await flush();
    expect(mocks.fetchAdminJson.mock.calls.some((call: unknown[]) => call[0] === "/api/teams?scope=all_time")).toBe(true);
  });
});

describe("Teams -- Моя команда tab, no team", () => {
  it("shows the create-team empty state with a CTA", async () => {
    await render();
    await click("Моя команда");
    await flush();
    expect(container.textContent).toContain("У вас пока нет команды");
    expect(container.textContent).toContain("Создать команду");
  });

  it("emblem selection: clicking an emblem selects it (visually distinct border), default is ♠️", async () => {
    await render();
    await click("Моя команда");
    await flush();
    await click("Создать команду");

    const buttons = Array.from(container.querySelectorAll("button")).filter((b) =>
      ["♠️", "♥️", "♦️", "♣️", "👑", "🔥", "⚡", "🐺", "🦈", "🐉", "💎", "🏆"].includes(b.textContent ?? "")
    );
    expect(buttons).toHaveLength(12);
    const defaultSelected = buttons.find((b) => b.textContent === "♠️")!;
    expect(defaultSelected.className).toContain("border-[#d5b867]");

    const fire = buttons.find((b) => b.textContent === "🔥")!;
    await act(async () => fire.click());
    expect(fire.className).toContain("border-[#d5b867]");
    expect(defaultSelected.className).not.toContain("border-[#d5b867]");
  });

  it("creates a team with the chosen name and emblem", async () => {
    await render();
    await click("Моя команда");
    await flush();
    await click("Создать команду");

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Sharks");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await click("Создать");
    await flush();

    const createCall = mocks.fetchAdminJson.mock.calls.find((call: unknown[]) => call[0] === "/api/teams");
    expect(createCall).toBeDefined();
    expect(JSON.parse((createCall![1] as RequestInit).body as string)).toMatchObject({
      name: "Sharks",
      emblem: "♠️",
    });
  });

  it("pending invitations are visible even with no team, with Принять/Отклонить actions", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
      if (url === "/api/teams/me")
        return Promise.resolve(
          myTeamState({
            pending_invitations: [
              {
                invitation_id: "inv-1",
                team_id: "team-1",
                team_name: "Sharks",
                team_emblem: "🦈",
                invited_by: { player_id: "cap-1", display_name: "Captain", username: null, telegram_avatar_url: null, custom_avatar_url: null },
                created_at: new Date().toISOString(),
              },
            ],
          })
        );
      if (url.includes("/accept") || url.includes("/decline")) return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("Принять");
    expect(container.textContent).toContain("Отклонить");

    await click("Принять");
    await flush();
    expect(mocks.fetchAdminJson.mock.calls.some((call: unknown[]) => call[0] === "/api/teams/invitations/inv-1/accept")).toBe(
      true
    );
  });
});

describe("Teams -- Моя команда tab, has a team", () => {
  function teamDetail(overrides: Record<string, unknown> = {}) {
    return {
      id: "team-1",
      name: "Sharks",
      emblem: "🦈",
      status: "active",
      disbanded_at: null,
      captain_player_id: "captain-1",
      points: 250,
      rank: 2,
      roster: [
        { player_id: "captain-1", display_name: "Captain", username: null, telegram_avatar_url: null, custom_avatar_url: null, is_captain: true, joined_at: new Date().toISOString() },
        { player_id: "viewer-1", display_name: "Viewer", username: null, telegram_avatar_url: null, custom_avatar_url: null, is_captain: false, joined_at: new Date().toISOString() },
      ],
      contributions: [
        { player_id: "captain-1", display_name: "Captain", username: null, telegram_avatar_url: null, custom_avatar_url: null, points: 150, is_current_member: true },
        { player_id: "former-1", display_name: "Former Guy", username: null, telegram_avatar_url: null, custom_avatar_url: null, points: 100, is_current_member: false },
      ],
      ...overrides,
    };
  }

  function withTeam(isCaptain: boolean, roster?: unknown[]) {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
      if (url === "/api/teams/me")
        return Promise.resolve(
          myTeamState({ team: teamDetail(roster ? { roster } : {}), is_captain: isCaptain, pending_invitations: [] })
        );
      return Promise.resolve({ ok: true });
    });
  }

  it("former contributor shows the 'Бывший участник' marker; current member does not", async () => {
    withTeam(false);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("Former Guy");
    expect(container.textContent).toContain("Бывший участник");
  });

  it("member-only controls: a non-captain sees 'Покинуть команду', never captain management buttons", async () => {
    withTeam(false);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("Покинуть команду");
    expect(container.textContent).not.toContain("Распустить");
    expect(container.textContent).not.toContain("Пригласить");
  });

  it("captain management controls: rename/emblem, invite, disband are all present", async () => {
    withTeam(true);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("Изменить команду");
    expect(container.textContent).toContain("Пригласить");
    expect(container.textContent).toContain("Распустить");
    expect(container.textContent).not.toContain("Покинуть команду");
  });

  it("5/5 full state hides the Пригласить button", async () => {
    const fullRoster = Array.from({ length: 5 }, (_, i) => ({
      player_id: `p${i}`,
      display_name: `Player ${i}`,
      username: null,
      telegram_avatar_url: null,
      custom_avatar_url: null,
      is_captain: i === 0,
      joined_at: new Date().toISOString(),
    }));
    withTeam(true, fullRoster);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("5 / 5");
    expect(container.textContent).not.toContain("Пригласить");
  });
});

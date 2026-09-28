import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({ fetchAdminJson: vi.fn(), searchParams: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
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
    roster_preview: [],
    ...overrides,
  };
}

function myTeamState(overrides: Record<string, unknown> = {}) {
  return {
    team: null,
    pending_invitations: [],
    pending_outgoing_join_requests: [],
    pending_incoming_join_requests: [],
    is_captain: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
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
  // Strips a trailing numeric pending-count badge (e.g. "Моя команда" +
  // "2" rendered as a nested <span>) so tab-button lookups by label still
  // match regardless of whether a badge is currently showing.
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text || b.textContent?.trim().replace(/\d+$/, "") === text
  )!;
  return act(async () => el.click());
}

describe("Teams -- invitation badge (visible from ANY tab)", () => {
  it("25. shows the pending-count badge on 'Моя команда' while the Рейтинг tab is active -- never waits for the tab switch", async () => {
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
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    await render();
    // Still on Рейтинг (default tab) -- the badge must already be visible.
    const badge = container.querySelector('[data-testid="my-team-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("1");
  });

  it("no badge when there is nothing pending", async () => {
    await render();
    expect(container.querySelector('[data-testid="my-team-badge"]')).toBeNull();
  });
});

describe("Teams -- deep-link initial tab (?tab=my-team, wrapped in Suspense)", () => {
  it("/teams?tab=my-team initializes the 'Моя команда' tab", async () => {
    mocks.searchParams = new URLSearchParams("tab=my-team");
    await render();

    expect(container.textContent).toContain("Создать команду");
    expect(container.textContent).not.toContain("Текущий сезон");
  });

  it("plain /teams (no query) initializes the 'Рейтинг' tab", async () => {
    mocks.searchParams = new URLSearchParams();
    await render();

    expect(container.textContent).toContain("Текущий сезон");
  });
});

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

    const cards = Array.from(container.querySelectorAll('a[href^="/teams/"]'));
    const rankBadges = cards.map((card) => card.textContent?.includes("#1"));
    expect(rankBadges.filter(Boolean)).toHaveLength(2);
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

  function withTeam(isCaptain: boolean, roster?: unknown[], incomingRequests: unknown[] = []) {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
      if (url === "/api/teams/me")
        return Promise.resolve(
          myTeamState({
            team: teamDetail(roster ? { roster } : {}),
            is_captain: isCaptain,
            pending_invitations: [],
            pending_incoming_join_requests: isCaptain ? incomingRequests : [],
          })
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

  describe("captain team-photo editing inside 'Изменить команду'", () => {
    it("1. shows 'Фото команды' inside the edit panel", async () => {
      withTeam(true);
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      expect(container.textContent).toContain("Фото команды");
      expect(container.textContent).toContain(
        "Фото будет использоваться в рейтинге, профилях и на странице команды."
      );
    });

    it("2. no existing avatar => shows 'Загрузить фото'", async () => {
      withTeam(true);
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      expect(container.textContent).toContain("Загрузить фото");
      expect(container.textContent).not.toContain("Удалить фото");
    });

    it("3. existing avatar => shows 'Изменить фото' + 'Удалить фото'", async () => {
      mocks.fetchAdminJson.mockImplementation((url: string) => {
        if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
        if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
        if (url === "/api/teams/me")
          return Promise.resolve(
            myTeamState({
              team: teamDetail({ avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" }),
              is_captain: true,
              pending_invitations: [],
              pending_incoming_join_requests: [],
            })
          );
        return Promise.resolve({ ok: true });
      });
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      expect(container.textContent).toContain("Изменить фото");
      expect(container.textContent).toContain("Удалить фото");
    });

    it("4. upload posts multipart 'file' to the existing /api/teams/[id]/avatar endpoint", async () => {
      withTeam(true);
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["fake"], "photo.png", { type: "image/png" });
      Object.defineProperty(fileInput, "files", { value: [file] });
      await act(async () => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await flush();

      const call = mocks.fetchAdminJson.mock.calls.find((c: unknown[]) => c[0] === "/api/teams/team-1/avatar");
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get("file")).toBe(file);
    });

    it("5. delete calls DELETE on the existing /api/teams/[id]/avatar endpoint", async () => {
      mocks.fetchAdminJson.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
        if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
        if (url === "/api/teams/me")
          return Promise.resolve(
            myTeamState({
              team: teamDetail({ avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" }),
              is_captain: true,
              pending_invitations: [],
              pending_incoming_join_requests: [],
            })
          );
        if (url === "/api/teams/team-1/avatar" && init?.method === "DELETE") {
          return Promise.resolve({ team: teamDetail({ avatar_url: null }) });
        }
        return Promise.resolve({ ok: true });
      });
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();
      await click("Удалить фото");
      await flush();

      const call = mocks.fetchAdminJson.mock.calls.find(
        (c: unknown[]) => c[0] === "/api/teams/team-1/avatar" && (c[1] as RequestInit)?.method === "DELETE"
      );
      expect(call).toBeDefined();
    });

    it("6. successful upload refreshes /api/teams/me and the new photo renders instead of the emblem", async () => {
      let uploaded = false;
      mocks.fetchAdminJson.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
        if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
        if (url === "/api/teams/me")
          return Promise.resolve(
            myTeamState({
              team: teamDetail(uploaded ? { avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" } : {}),
              is_captain: true,
              pending_invitations: [],
              pending_incoming_join_requests: [],
            })
          );
        if (url === "/api/teams/team-1/avatar" && init?.method === "POST") {
          uploaded = true;
          return Promise.resolve({ team: teamDetail({ avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" }) });
        }
        return Promise.resolve({ ok: true });
      });
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      expect(container.querySelector("img")).toBeNull();

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["fake"], "photo.png", { type: "image/png" });
      Object.defineProperty(fileInput, "files", { value: [file] });
      await act(async () => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await flush();

      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe("https://cdn/teams/team-1/avatar.webp?v=1");
    });

    it("7. delete restores the emoji-emblem fallback", async () => {
      let deleted = false;
      mocks.fetchAdminJson.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
        if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [] });
        if (url === "/api/teams/me")
          return Promise.resolve(
            myTeamState({
              team: teamDetail(deleted ? {} : { avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" }),
              is_captain: true,
              pending_invitations: [],
              pending_incoming_join_requests: [],
            })
          );
        if (url === "/api/teams/team-1/avatar" && init?.method === "DELETE") {
          deleted = true;
          return Promise.resolve({ team: teamDetail({ avatar_url: null }) });
        }
        return Promise.resolve({ ok: true });
      });
      await render();
      await click("Моя команда");
      await flush();
      await click("Изменить команду");
      await flush();

      expect(container.querySelector("img")).not.toBeNull();

      await click("Удалить фото");
      await flush();

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("🦈");
    });

    it("8. a non-captain never sees the photo-edit controls (no 'Изменить команду' section at all)", async () => {
      withTeam(false);
      await render();
      await click("Моя команда");
      await flush();

      expect(container.textContent).not.toContain("Изменить команду");
      expect(container.textContent).not.toContain("Загрузить фото");
      expect(container.textContent).not.toContain("Фото команды");
    });
  });

  it("32. captain sees incoming join requests with Принять/Отклонить", async () => {
    withTeam(true, undefined, [
      {
        request_id: "req-1",
        team_id: "team-1",
        applicant: { player_id: "applicant-1", display_name: "Applicant", username: null, telegram_avatar_url: null, custom_avatar_url: null },
        created_at: new Date().toISOString(),
      },
    ]);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).toContain("Заявки в команду");
    expect(container.textContent).toContain("Applicant");

    await click("Принять");
    await flush();
    expect(
      mocks.fetchAdminJson.mock.calls.some((call: unknown[]) => call[0] === "/api/teams/join-requests/req-1/accept")
    ).toBe(true);
  });

  it("33. a non-captain member never sees the incoming-requests section or its controls", async () => {
    withTeam(false);
    await render();
    await click("Моя команда");
    await flush();

    expect(container.textContent).not.toContain("Заявки в команду");
  });
});

describe("Teams -- leaderboard card identity (photo vs emblem)", () => {
  it("shows the team's photo instead of the emoji emblem when avatar_url is set", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?"))
        return Promise.resolve({
          standings: [standing({ avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" })],
        });
      if (url === "/api/teams/me") return Promise.resolve(myTeamState());
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    await render();

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn/teams/team-1/avatar.webp?v=1");
  });

  it("falls back to the emoji emblem when avatar_url is absent", async () => {
    mocks.fetchAdminJson.mockImplementation((url: string) => {
      if (url === "/api/leaderboard/seasons") return Promise.resolve({ seasons: [] });
      if (url.startsWith("/api/teams?")) return Promise.resolve({ standings: [standing()] });
      if (url === "/api/teams/me") return Promise.resolve(myTeamState());
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    await render();

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🦈");
  });
});

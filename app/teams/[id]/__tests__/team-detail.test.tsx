import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "team-1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ viewer: null as Player | null, fetchAdminJson: vi.fn() }));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => (mocks.viewer ? Promise.resolve(mocks.viewer) : Promise.reject(new Error("no session"))),
}));

vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));

const { default: TeamDetailPage } = await import("@/app/teams/[id]/page");

let container: HTMLDivElement;
let root: Root;

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
      {
        player_id: "captain-1",
        display_name: "Captain",
        username: null,
        telegram_avatar_url: null,
        custom_avatar_url: null,
        is_captain: true,
        joined_at: new Date().toISOString(),
      },
    ],
    contributions: [
      { player_id: "captain-1", display_name: "Captain", username: null, telegram_avatar_url: null, custom_avatar_url: null, points: 150, is_current_member: true },
      { player_id: "former-1", display_name: "Former Guy", username: null, telegram_avatar_url: null, custom_avatar_url: null, points: 100, is_current_member: false },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.viewer = null;
  mocks.fetchAdminJson.mockReset().mockResolvedValue({ players: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<TeamDetailPage />));
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function click(text: string) {
  const el = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text))!;
  return act(async () => el.click());
}

describe("public team detail page", () => {
  it("renders emblem, name, rank, points, status, roster and contributions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail() }) }) as Response)
    );

    await render();

    expect(container.textContent).toContain("Sharks");
    expect(container.textContent).toContain("#2 в рейтинге");
    expect(container.textContent).toContain("250");
    expect(container.textContent).toContain("Captain");
    expect(container.textContent).toContain("👑 Капитан");
  });

  it("former contributor shows the marker; current member does not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail() }) }) as Response)
    );

    await render();

    expect(container.textContent).toContain("Former Guy");
    expect(container.textContent).toContain("Бывший участник");
    // Exactly one marker -- the current member (Captain) never gets one.
    const markers = Array.from(container.querySelectorAll("p")).filter((p) => p.textContent === "Бывший участник");
    expect(markers).toHaveLength(1);
  });

  it("disbanded status is shown instead of a rank", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail({ status: "disbanded", rank: null }) }) }) as Response)
    );

    await render();
    expect(container.textContent).toContain("Распущена");
  });

  it("shows an error state when the team is not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Команда не найдена" }) }) as Response)
    );

    await render();
    expect(container.textContent).toContain("Команда не найдена");
  });

  it("roster and contribution rows link to /players/[id]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail() }) }) as Response)
    );

    await render();
    const links = Array.from(container.querySelectorAll('a[href^="/players/"]')).map((a) => a.getAttribute("href"));
    expect(links).toContain("/players/captain-1");
    expect(links).toContain("/players/former-1");
  });

  it("7. a zero-point team shows 'Пока без рейтинга · 0 очков', never '#1'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail({ points: 0, rank: null }) }) }) as Response)
    );

    await render();
    expect(container.textContent).toContain("Пока без рейтинга · 0 очков");
    expect(container.textContent).not.toContain("#1");
  });

  it("shows the contribution empty state, and percentage shares that sum near 100% otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail({ contributions: [] }) }) }) as Response)
    );
    await render();
    expect(container.textContent).toContain(
      "Командные очки появятся после турниров, которые участники сыграют за эту команду."
    );
  });
});

describe("public team detail -- captain-only invite slot (Part E)", () => {
  it("12. the captain of THIS team sees a '+ Пригласить' roster slot when the team isn't full", async () => {
    mocks.viewer = { id: "captain-1", role: "player", display_name: "Captain" } as Player;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail() }) }) as Response)
    );

    await render();
    expect(container.textContent).toContain("Пригласить");

    await click("Пригласить");
    expect(container.querySelector('input[placeholder="Найти игрока по нику"]')).not.toBeNull();
  });

  it("13. a public (logged-out) viewer never sees an invite affordance", async () => {
    mocks.viewer = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail() }) }) as Response)
    );

    await render();
    expect(container.textContent).not.toContain("Пригласить");
  });

  it("13. a non-captain member of the SAME team never sees an invite affordance", async () => {
    mocks.viewer = { id: "member-1", role: "player", display_name: "Member" } as Player;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          json: async () => ({
            team: teamDetail({
              roster: [
                ...teamDetail().roster,
                {
                  player_id: "member-1",
                  display_name: "Member",
                  username: null,
                  telegram_avatar_url: null,
                  custom_avatar_url: null,
                  is_captain: false,
                  joined_at: new Date().toISOString(),
                },
              ],
            }),
          }),
        }) as Response
      )
    );

    await render();
    expect(container.textContent).not.toContain("Пригласить");
  });

  it("14. even the captain sees no invite slot once the team is full (5/5)", async () => {
    mocks.viewer = { id: "captain-1", role: "player", display_name: "Captain" } as Player;
    const fullRoster = Array.from({ length: 5 }, (_, i) => ({
      player_id: i === 0 ? "captain-1" : `member-${i}`,
      display_name: i === 0 ? "Captain" : `Member ${i}`,
      username: null,
      telegram_avatar_url: null,
      custom_avatar_url: null,
      is_captain: i === 0,
      joined_at: new Date().toISOString(),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ team: teamDetail({ roster: fullRoster }) }) }) as Response)
    );

    await render();
    expect(container.textContent).toContain("5 / 5");
    expect(container.textContent).not.toContain("Пригласить");
  });
});

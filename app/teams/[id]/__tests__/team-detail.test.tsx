import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "team-1" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<TeamDetailPage />));
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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
});

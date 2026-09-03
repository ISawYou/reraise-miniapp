import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardAvatar, Podium, RankMovementBadge, type PodiumPlayer } from "@/components/leaderboard/podium";

// next/link needs router context this test doesn't set up -- a plain <a>
// passthrough is enough to assert hrefs/content without pulling in a full
// Next.js app shell, same tradeoff other component tests in this repo make.
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function player(overrides: Partial<PodiumPlayer> = {}): PodiumPlayer {
  return {
    player_id: "p1",
    display_name: "Игрок",
    telegram_avatar_url: null,
    custom_avatar_url: null,
    rating: 100,
    ...overrides,
  };
}

async function renderPodium(
  topThree: readonly PodiumPlayer[],
  props: { currentPlayerId?: string | null; variant?: "full" | "compact" } = {},
) {
  await act(async () => {
    root.render(
      <Podium topThree={topThree} currentPlayerId={props.currentPlayerId ?? null} variant={props.variant} />,
    );
  });
}

describe("Podium -- shared TOP-3 presentation (full and compact)", () => {
  it("renders 3 players in #2, #1, #3 slot order", async () => {
    const first = player({ player_id: "first", display_name: "First", rating: 300 });
    const second = player({ player_id: "second", display_name: "Second", rating: 200 });
    const third = player({ player_id: "third", display_name: "Third", rating: 100 });

    await renderPodium([first, second, third]);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/players/second",
      "/players/first",
      "/players/third",
    ]);
  });

  it("works with exactly 1 player -- only the center slot renders", async () => {
    const only = player({ player_id: "solo", display_name: "Solo" });
    await renderPodium([only]);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/players/solo");
  });

  it("works with exactly 2 players -- left and center, no right slot", async () => {
    const first = player({ player_id: "first" });
    const second = player({ player_id: "second" });
    await renderPodium([first, second]);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/players/second", "/players/first"]);
  });

  it("renders nothing (null) for zero players", async () => {
    await renderPodium([]);
    expect(container.innerHTML).toBe("");
  });

  it("highlights the current player with the ring class", async () => {
    const first = player({ player_id: "me", display_name: "Me" });
    await renderPodium([first], { currentPlayerId: "me" });

    const link = container.querySelector("a");
    expect(link?.className).toContain("ring-[#d7b55a]/40");
  });

  it("both variant='full' and variant='compact' render the same player set through the one component", async () => {
    const first = player({ player_id: "first" });

    await renderPodium([first], { variant: "full" });
    expect(container.querySelectorAll("a")).toHaveLength(1);

    await renderPodium([first], { variant: "compact" });
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("shows the server-provided rank movement label, never recalculating it", async () => {
    const first = player({ player_id: "first", rankMovement: { type: "up", places: 2 } });
    await renderPodium([first]);

    expect(container.textContent).toContain("↑2");
  });

  it("renders nothing for a player with no rankMovement (OOC/archive/all-time)", async () => {
    const first = player({ player_id: "first" });
    await renderPodium([first]);

    expect(container.textContent).not.toMatch(/↑|↓|NEW/);
  });
});

describe("LeaderboardAvatar -- fallback safety", () => {
  async function renderAvatar(p: PodiumPlayer) {
    await act(async () => {
      root.render(<LeaderboardAvatar player={p} size={40} />);
    });
  }

  it("renders an <img> when an avatar URL is present", async () => {
    await renderAvatar(player({ custom_avatar_url: "https://example.com/a.png" }));
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("falls back to the first letter of display_name when no avatar URL exists", async () => {
    await renderAvatar(player({ display_name: "Захар", custom_avatar_url: null, telegram_avatar_url: null }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("З");
  });
});

describe("RankMovementBadge", () => {
  it("renders nothing for undefined movement", async () => {
    await act(async () => {
      root.render(<RankMovementBadge movement={undefined} />);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders NEW for a new entrant", async () => {
    await act(async () => {
      root.render(<RankMovementBadge movement={{ type: "new" }} />);
    });
    expect(container.textContent).toBe("NEW");
  });
});

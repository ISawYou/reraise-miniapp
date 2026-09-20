// RELEASE C1: verifies the player-facing Rating screen's tab rewiring --
// Archive removed, Current/All-time behavior unchanged, Statistics tab
// wired to the new shared endpoint. Same render convention as
// app/__tests__/home-carousel-lazy-loading.test.tsx (raw react-dom/client,
// not a testing-library dependency this repo doesn't have).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve({ id: "p1" }),
}));

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
}));

// BackButton (rendered at the top of the page) calls useRouter() -- no app
// router is mounted under raw react-dom/client rendering, so it's stubbed,
// same reasoning as every other mock in this file.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const { default: LeaderboardPage } = await import("@/app/leaderboard/page");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/leaderboard") {
      return {
        ok: true,
        json: async () => ({
          season: { id: "s1", title: "Сезон 1" },
          leaderboard: [
            { player_id: "p1", username: "alice", display_name: "Alice", telegram_avatar_url: null, custom_avatar_url: null, rating: 300 },
          ],
          outOfCompetition: [],
        }),
      } as Response;
    }
    if (url === "/api/leaderboard/all-time") {
      return {
        ok: true,
        json: async () => ({
          leaderboard: [
            { player_id: "p1", username: "alice", display_name: "Alice", telegram_avatar_url: null, custom_avatar_url: null, rating: 900 },
          ],
        }),
      } as Response;
    }
    if (typeof url === "string" && url.startsWith("/api/leaderboard/statistics")) {
      const metric = new URL(url, "http://localhost").searchParams.get("metric");
      return {
        ok: true,
        json: async () => ({
          metric,
          topPlayers: [
            { playerId: "p1", displayName: "Alice", username: "alice", telegramAvatarUrl: null, customAvatarUrl: null, value: 42, rank: 1 },
          ],
        }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function modeButtons(): HTMLButtonElement[] {
  // The mode selector is the only button group with exactly these three
  // labels rendered as sibling buttons at the top of the page.
  return Array.from(container.querySelectorAll("button")).filter((btn) =>
    ["Текущий сезон", "Всё время", "Статистика"].includes(btn.textContent ?? "")
  );
}

function clickButtonWithText(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`Button "${text}" not found`);
  btn.click();
}

async function renderPage() {
  await act(async () => {
    root.render(<LeaderboardPage />);
  });
  // Flush the initial data-loading effects (resolveCurrentPlayer + /api/leaderboard).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Rating screen tabs (RELEASE C1)", () => {
  it("shows exactly Текущий сезон / Всё время / Статистика -- Архив is gone", async () => {
    await renderPage();
    const labels = modeButtons().map((b) => b.textContent);
    expect(labels).toEqual(["Текущий сезон", "Всё время", "Статистика"]);
    expect(container.textContent).not.toContain("Архив");
  });

  it("Current (Текущий сезон) is unchanged: loads /api/leaderboard and renders the season row", async () => {
    await renderPage();
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("300");
  });

  it("All-time is unchanged: switching to it loads /api/leaderboard/all-time and shows the all-time rating", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Всё время");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/all-time");
    expect(container.textContent).toContain("900");
  });

  it("Statistics selector works: switching to it loads the default metric, and selecting another metric re-fetches it", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Статистика");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/statistics?metric=tournaments_played");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("42");

    await act(async () => {
      clickButtonWithText("Победы");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/statistics?metric=wins");
  });
});

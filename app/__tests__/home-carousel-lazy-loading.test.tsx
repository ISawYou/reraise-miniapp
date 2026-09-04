// Phase 2B.1: Home's tournament carousel mounts every slide simultaneously
// (the track shifts via CSS transform, see app/page.tsx's
// renderTournamentCard/translate3d), so without a loading hint every
// off-screen slide's artwork is as eager as the visible one. This mounts
// the real HomePage with actual tournament data (unlike the boot-watchdog
// test, which never reaches this render path) to verify only the active
// slide is eager and every other slide is lazy, and that changing the
// active index flips the newly-active slide to eager on its next render.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

vi.mock("@/features/auth", () => ({
  ensurePlayerFromTelegramUser: vi.fn(),
  acceptTerms: vi.fn(),
  completeProfile: vi.fn(),
}));

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

const homeTournaments = [
  tournament({ id: "t1", title: "First" }),
  tournament({ id: "t2", title: "Second" }),
  tournament({ id: "t3", title: "Third" }),
];

vi.mock("@/features/tournaments", () => ({
  getVisibleOpenTournamentsForPlayer: vi.fn().mockResolvedValue(homeTournaments),
  getPlayerRegistrations: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

const player: Player = {
  id: "p1",
  telegram_id: 1,
  username: "p1",
  display_name: "Player One",
  role: "player",
  is_blocked: false,
  can_access_free: true,
  can_access_paid: true,
  accepted_terms_at: "2026-01-01T00:00:00.000Z",
  accepted_terms_version: "v1",
  profile_completed_at: "2026-01-01T00:00:00.000Z",
} as Player;

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(player),
  invalidateCurrentPlayerCache: vi.fn(),
}));

vi.mock("@/lib/telegram", () => ({
  getTelegramUser: vi.fn(() => null),
  getTelegramInitData: vi.fn(async () => null),
  getTelegramWebApp: vi.fn(() => null),
  isTelegramMiniAppContext: vi.fn(() => true),
}));

vi.mock("@/lib/activity-client", () => ({
  logEvent: vi.fn(),
  setActivityPlayerId: vi.fn(),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: vi.fn().mockResolvedValue(null),
}));

// Bypasses the live-state poll's own fetch entirely -- unrelated to this
// test, and would otherwise need its own fetch-mock handling for real
// tournament ids.
vi.mock("@/lib/hooks/use-tournament-live-state", () => ({
  useTournamentLiveState: () => ({}),
}));

const { default: HomePage } = await import("@/app/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/tournament-visuals")) {
        return {
          ok: true,
          json: async () => ({
            visuals: [
              {
                tournamentType: "classic",
                assetUrl: "/tournament-assets/classic.png",
                scale: 100,
                offsetX: 0,
                offsetY: 0,
                opacity: 100,
              },
            ],
          }),
        } as Response;
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

function slides(): HTMLImageElement[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>("[data-tournament-visual-img]"));
}

async function renderHomeWithCarousel() {
  await act(async () => {
    root.render(<HomePage />);
  });
  // Flush the boot chain (resolveCurrentPlayer -> refreshHomeData's
  // Promise.all of several chained fetch().then() calls) across enough
  // microtask/macrotask turns for it to fully settle and re-render.
  for (let i = 0; i < 30 && slides().length === 0; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("Home tournament carousel -- lazy off-screen artwork (Phase 2B.1)", () => {
  it("mounts all slides simultaneously (no conditional unmounting), active slide eager, rest lazy", async () => {
    await renderHomeWithCarousel();

    const imgs = slides();
    expect(imgs.length).toBe(3); // all 3 slides mounted at once, not just the active one

    expect(imgs[0].getAttribute("loading")).toBe("eager"); // index 0 is active by default
    expect(imgs[1].getAttribute("loading")).toBe("lazy");
    expect(imgs[2].getAttribute("loading")).toBe("lazy");
  });

  it("clicking a pagination dot flips the newly active slide to eager (and the old one back to lazy)", async () => {
    await renderHomeWithCarousel();

    const dots = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-current]'));
    expect(dots.length).toBe(3);

    await act(async () => {
      dots[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const imgs = slides();
    expect(imgs.length).toBe(3); // still all mounted, DOM structure unchanged
    expect(imgs[0].getAttribute("loading")).toBe("lazy");
    expect(imgs[1].getAttribute("loading")).toBe("lazy");
    expect(imgs[2].getAttribute("loading")).toBe("eager");
  });
});

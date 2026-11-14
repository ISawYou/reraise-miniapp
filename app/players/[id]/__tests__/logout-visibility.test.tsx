import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playerId: "p1",
  viewer: { id: "p1", is_blocked: false },
  detectTelegramMiniAppContext: vi.fn(),
  resolveCurrentPlayer: vi.fn(),
  invalidateCurrentPlayerCache: vi.fn(),
  fetchAdminJson: vi.fn(),
  getAdminHeaders: vi.fn(),
  fetchFollowSummary: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: mocks.playerId }), useRouter: () => ({ replace: mocks.routerReplace, refresh: mocks.routerRefresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/features/auth", () => ({ submitNicknameForModeration: vi.fn() }));
vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: mocks.resolveCurrentPlayer, invalidateCurrentPlayerCache: mocks.invalidateCurrentPlayerCache }));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson, getAdminHeaders: mocks.getAdminHeaders }));
vi.mock("@/lib/follows-client", () => ({ fetchFollowSummary: mocks.fetchFollowSummary, followPlayerRequest: vi.fn(), unfollowPlayerRequest: vi.fn() }));
vi.mock("@/lib/player-avatar-client", () => ({ uploadPlayerAvatar: vi.fn() }));
vi.mock("@/lib/telegram", () => ({ detectTelegramMiniAppContext: mocks.detectTelegramMiniAppContext }));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/tournament-visuals-client", () => ({ fetchTournamentVisualConfigs: vi.fn().mockResolvedValue({}) }));
vi.mock("@/components/ui/back-button", () => ({ BackButton: ({ href }: { href: string }) => <a href={href}>Назад</a> }));
vi.mock("@/components/profile/player-avatar-image", () => ({ PlayerAvatarImage: () => <div data-testid="avatar" /> }));
vi.mock("@/components/achievements/achievement-visual", () => ({ AchievementVisual: () => <div /> }));
vi.mock("@/components/teams/team-ui", () => ({ TeamIdentity: () => <div /> }));
vi.mock("@/components/profile/profile-upcoming-row", () => ({ ProfileUpcomingRow: () => <div /> }));
vi.mock("@/components/profile/profile-result-row", () => ({ ProfileResultRow: () => <div /> }));
vi.mock("@/components/follows/follow-list-modal", () => ({ FollowListModal: () => <div /> }));
vi.mock("@/components/profile/profile-primitives", () => ({ ContentCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ProfileKpiCell: () => <div /> }));
vi.mock("@/lib/achievement-display", () => ({
  buildAchievementDisplayModel: () => ({ families: [], legendary: [] }),
  getEarnedFeaturedOptions: () => [],
  resolveFeaturedAchievements: () => [],
  LEGENDARY_SORT_PRIORITY: 1,
  TIER_SORT_PRIORITY: {},
}));

const { default: PlayerProfilePage } = await import("@/app/players/[id]/page");

function profile(id: string, mode: "own" | "public") {
  return {
    mode,
    profile: {
      id,
      display_name: id === "p1" ? "Own" : "Other",
      username: null,
      telegram_avatar_url: null,
      custom_avatar_url: null,
      team: null,
      featured_achievement_keys: [],
      achievements: [],
      rating: { currentSeason: { rank: 1, points: 10, isOutOfCompetition: false } },
      tournaments_played: 0,
      knockouts: 0,
      recent_form: [],
      ...(mode === "own" ? {
        free_reentries_balance: 0,
        email: "own@example.com",
        nickname_status: "approved",
        pending_display_name: null,
        created_at: "2026-01-01T00:00:00.000Z",
        dealer: null,
        team_state: { pending_invitations: [], pending_outgoing_join_requests: [] },
        upcoming_tournaments: [],
        registration_counts: {},
      } : {}),
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.playerId = "p1";
  mocks.viewer = { id: "p1", is_blocked: false };
  mocks.resolveCurrentPlayer.mockReset().mockResolvedValue(mocks.viewer);
  mocks.detectTelegramMiniAppContext.mockReset().mockResolvedValue(false);
  mocks.fetchAdminJson.mockReset().mockResolvedValue({ pending_invitations: [], pending_outgoing_join_requests: [] });
  mocks.getAdminHeaders.mockReset().mockResolvedValue({});
  mocks.fetchFollowSummary.mockReset().mockResolvedValue({ followers: 0, following: 0, isFollowing: null });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("profile-v2")) return Promise.resolve(Response.json(profile(mocks.playerId, mocks.playerId === "p1" ? "own" : "public")));
    if (url.includes("achievement-visuals")) return Promise.resolve(Response.json({ visuals: [] }));
    return Promise.resolve(Response.json({}));
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage() {
  await act(async () => root.render(<PlayerProfilePage />));
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 10)));
}

describe("profile logout visibility", () => {
  it("shows logout on a directly opened own web profile", async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="logout-open"]')).not.toBeNull();
  });

  it("never shows logout on another player's profile", async () => {
    mocks.playerId = "p2";
    await renderPage();
    expect(container.querySelector('[data-testid="logout-open"]')).toBeNull();
  });

  it("keeps logout hidden when delayed Telegram SDK detection resolves Mini App", async () => {
    mocks.detectTelegramMiniAppContext.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 5)));
    await renderPage();
    expect(container.querySelector('[data-testid="logout-open"]')).toBeNull();
  });
});

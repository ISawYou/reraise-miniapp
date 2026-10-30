import { beforeEach, describe, expect, it, vi } from "vitest";

const getProfileV2 = vi.fn();
const resolveCurrentServerActor = vi.fn();

vi.mock("@/features/profile-v2", () => ({ getProfileV2 }));
vi.mock("@/lib/admin-auth", () => ({ resolveCurrentServerActor }));

const { GET } = await import("@/app/api/players/[id]/profile-v2/route");

describe("GET /api/players/[id]/profile-v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentServerActor.mockResolvedValue(null);
  });

  it("requests a public DTO without a viewer when unauthenticated", async () => {
    getProfileV2.mockResolvedValue({
      mode: "public",
      profile: {
        id: "player-2",
        display_name: "Public Player",
        username: "public",
        telegram_avatar_url: null,
        custom_avatar_url: null,
        team: null,
        featured_achievement_keys: [],
        achievements: [],
        rating: { currentSeason: null, allTime: { points: 0, rank: null } },
        tournaments_played: 0,
        knockouts: 0,
        recent_form: [],
        tournament_history: [],
      },
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "player-2" }),
    });
    const body = await response.json();

    expect(getProfileV2).toHaveBeenCalledWith({ targetPlayerId: "player-2", viewerId: null });
    expect(body.profile.email).toBeUndefined();
    expect(body.profile.dealer).toBeUndefined();
    expect(body.profile.team_state).toBeUndefined();
    expect(body.profile.free_reentries_balance).toBeUndefined();
  });

  it("passes the authenticated canonical viewer to the read model", async () => {
    resolveCurrentServerActor.mockResolvedValue({ id: "player-1" });
    getProfileV2.mockResolvedValue({ mode: "own", profile: { id: "player-1" } });

    await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "player-1" }),
    });

    expect(getProfileV2).toHaveBeenCalledWith({ targetPlayerId: "player-1", viewerId: "player-1" });
  });
});

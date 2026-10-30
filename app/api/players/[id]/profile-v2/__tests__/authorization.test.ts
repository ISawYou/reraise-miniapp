import { createHmac } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => m.headers,
  cookies: async () => ({ get: (key: string) => m.cookies.has(key) ? { value: m.cookies.get(key) } : undefined }),
}));
vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: async (id: string) => ({ id, display_name: "Player", username: "player", free_reentries_balance: 2, email: "private@example.test", created_at: "2025-01-01" }),
    findByTelegramId: async (id: number) => ({ id: `tg-${id}`, telegram_id: id, display_name: "Owner", free_reentries_balance: 2, email: "private@example.test" }),
  },
  resultRepository: { sumHistoryKnockoutsByPlayerId: async () => 0 },
}));
vi.mock("@/features/dealers", () => ({ getPersonalDealerSummary: async () => null }));
vi.mock("@/features/achievements", () => ({ getPlayerAchievements: async () => [] }));
vi.mock("@/features/featured-achievements", () => ({ getFeaturedAchievementKeys: async () => [] }));
vi.mock("@/features/leaderboard", () => ({ getPlayerRatingSummary: async () => ({ currentSeason: null, allTime: { points: 0, rank: null } }) }));
vi.mock("@/features/teams", () => ({ getMyTeamState: async () => ({ pending_invitations: [], pending_outgoing_join_requests: [] }), getPlayerActiveTeamSummary: async () => null }));
vi.mock("@/features/tournaments", () => ({ getPlayerTournamentHistory: async () => [], getPlayedTournamentsCount: async () => 0, getMyTournaments: async () => [], getTournamentRegistrationCounts: async () => ({}) }));

const { GET } = await import("../route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");
const BOT_TOKEN = "123456:profile-readiness-test-token";
beforeEach(() => {
  m.headers = new Headers(); m.cookies.clear();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("SESSION_SECRET", "profile-readiness-test-session-secret");
});
afterEach(() => vi.unstubAllEnvs());

function initData(id: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Player" }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
async function request(id: string) {
  return (await GET(new Request(`http://localhost/api/players/${id}/profile-v2`), { params: Promise.resolve({ id }) })).json();
}

it("returns the owner DTO for a real signed Telegram header without any session cookie", async () => {
  m.headers.set("x-telegram-init-data", initData(777));
  const body = await request("tg-777");
  expect(body.mode).toBe("own");
  expect(body.profile.free_reentries_balance).toBe(2);
  expect(body.profile.email).toBe("private@example.test");
});
it("returns the owner DTO for a valid web session cookie", async () => {
  m.cookies.set(COOKIE_NAME, signSession("owner"));
  const body = await request("owner");
  expect(body.mode).toBe("own");
  expect(body.profile.free_reentries_balance).toBe(2);
});
it("never returns private data to an authenticated different player", async () => {
  m.headers.set("x-telegram-init-data", initData(777));
  const body = await request("other");
  expect(body.mode).toBe("public");
  for (const field of ["email", "free_reentries_balance", "dealer", "team_state", "upcoming_tournaments"]) expect(body.profile).not.toHaveProperty(field);
});
it.each(["absent", "forged"])("keeps the public DTO with %s credentials even if the URL names the owner", async (kind) => {
  if (kind === "forged") m.headers.set("x-telegram-init-data", initData(777).replace("%3A777", "%3A888"));
  const body = await request("tg-777");
  expect(body.mode).toBe("public");
  expect(body.profile).not.toHaveProperty("free_reentries_balance");
  expect(body.profile).not.toHaveProperty("email");
});

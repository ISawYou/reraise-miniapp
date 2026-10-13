import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { NextRequest } from "next/server";

// Academy access tiers against a REAL PostgreSQL database: the participation
// derivation (results / live attendance / seasons) is the core of this
// feature, so it is proven on real rows, the real EXISTS query, the real
// `seasonRepository.findActive()`, the real attendance setter and real signed
// sessions through the real routes. Gated behind a localhost *test* database
// (same convention as no-show-waitlist-policy.postgres.integration.test.ts):
//
//   ACADEMY_ACCESS_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_academy_access_test \
//     npx vitest run features/__tests__/academy-access.postgres.integration.test.ts
const TEST_DATABASE_URL = process.env.ACADEMY_ACCESS_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Academy access integration tests require a localhost test database");
  }
}

// features/tournaments.ts (the real "Пришёл" setter) transitively imports
// these side-effecting integrations; none is exercised here.
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/google-sheets", () => ({
  readSpreadsheetTabValues: vi.fn(),
  batchUpdateSpreadsheetValues: vi.fn(async () => undefined),
  applyNewRosterRowsFormatting: vi.fn(async () => undefined),
}));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: vi.fn(async () => ({ id: "admin", role: "admin" })),
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));

const PREFIX = "94000000-0000-4000-8000-";
const id = (n: number) => `${PREFIX}${String(n).padStart(12, "0")}`;

const SEASON_CURRENT = id(1);
const SEASON_PREVIOUS = id(2);
const T_CURRENT = id(11);
const T_CURRENT_2 = id(12);
const T_PREVIOUS = id(13);

const P = {
  noHistory: id(101),
  registered: id(102),
  waitlisted: id(103),
  noShow: id(104),
  arrives: id(105),
  currentResult: id(107),
  legacyResult: id(108),
  previousResultOnly: id(109),
  previousAttendanceOnly: id(110),
  admin: id(111),
  operator: id(112),
  mergedSource: id(113),
  mergedTarget: id(114),
  arrivedFalseOnly: id(115),
} as const;

const SESSION_SECRET = "academy-access-integration-secret";

describePostgres("Academy access tiers (PostgreSQL, derived from canonical facts)", () => {
  let client: Sql;
  let access: typeof import("@/features/academy-access");
  let tournaments: typeof import("@/features/tournaments");
  let session: typeof import("@/lib/telegram-web-session");
  let accessRoute: typeof import("@/app/api/academy/access/route");
  let mixSessionRoute: typeof import("@/app/api/academy/solver/preflop/mix/session/route");
  let preflopSessionRoute: typeof import("@/app/api/academy/solver/preflop/session/route");

  async function resetRows() {
    await client`DELETE FROM tournaments WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`UPDATE players SET merged_into_player_id = NULL WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM players WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM seasons WHERE id::text LIKE ${PREFIX + "%"}`;
  }

  async function player(playerId: string, role: "player" | "admin" | "operator" = "player") {
    await client`INSERT INTO players (id, display_name, role) VALUES (${playerId}::uuid, ${"Academy " + playerId.slice(-3)}, ${role})`;
  }

  let nextPlace = 1;
  async function result(tournamentId: string, playerId: string, seasonId: string, arrived: boolean | null) {
    await client`
      INSERT INTO results (tournament_id, player_id, season_id, place, rating_points, arrived)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${seasonId}::uuid, ${nextPlace++}, 10, ${arrived})
    `;
  }

  /** At most one active season (seasons_one_active_key): deactivate first, then activate. */
  async function activateSeason(seasonId: string | null) {
    await client`UPDATE seasons SET is_active = false WHERE id::text LIKE ${PREFIX + "%"} AND is_active`;
    if (seasonId) await client`UPDATE seasons SET is_active = true WHERE id = ${seasonId}::uuid`;
  }

  async function register(tournamentId: string, playerId: string, status: string, noShow = false) {
    await client`
      INSERT INTO registrations (player_id, tournament_id, status, no_show_at)
      VALUES (${playerId}::uuid, ${tournamentId}::uuid, ${status}, ${noShow ? new Date() : null})
    `;
  }

  async function tier(playerId: string) {
    const [row] = await client`SELECT id, role FROM players WHERE id = ${playerId}::uuid`;
    return access.getAcademyAccess({ id: row.id as string, role: row.role as "player" });
  }

  function cookieRequest(path: string, playerId: string, init: { method?: string; body?: unknown } = {}) {
    return new NextRequest(`http://localhost${path}`, {
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { "content-type": "application/json", cookie: `reraise_session=${session.signSession(playerId)}` },
    });
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 3 });
    access = await import("@/features/academy-access");
    tournaments = await import("@/features/tournaments");
    session = await import("@/lib/telegram-web-session");
    accessRoute = await import("@/app/api/academy/access/route");
    mixSessionRoute = await import("@/app/api/academy/solver/preflop/mix/session/route");
    preflopSessionRoute = await import("@/app/api/academy/solver/preflop/session/route");

    await resetRows();
    // Exactly one active season in this test database: ours.
    await client`UPDATE seasons SET is_active = false WHERE is_active`;
    await client`
      INSERT INTO seasons (id, title, start_date, end_date, is_active) VALUES
        (${SEASON_CURRENT}::uuid, 'Осень 2026', '2026-09-01', '2026-12-31', true),
        (${SEASON_PREVIOUS}::uuid, 'Весна 2026', '2026-03-01', '2026-08-31', false)
    `;
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, status, kind, season_id) VALUES
        (${T_CURRENT}::uuid, 'Current Cup', ${new Date()}, 40, 'open', 'free', ${SEASON_CURRENT}::uuid),
        (${T_CURRENT_2}::uuid, 'Current Cup 2', ${new Date()}, 40, 'completed', 'free', ${SEASON_CURRENT}::uuid),
        (${T_PREVIOUS}::uuid, 'Spring Cup', ${new Date("2026-05-01T18:00:00Z")}, 40, 'completed', 'free', ${SEASON_PREVIOUS}::uuid)
    `;
    for (const playerId of Object.values(P)) {
      await player(playerId, playerId === P.admin ? "admin" : playerId === P.operator ? "operator" : "player");
    }
  });

  beforeEach(async () => {
    await activateSeason(SEASON_CURRENT);
  });

  afterAll(async () => {
    if (!client) return;
    await resetRows();
    await client.end();
  });

  it("(1) a player with no history → BEGINNER_ONLY (with the active season)", async () => {
    expect(await tier(P.noHistory)).toEqual({ access: "BEGINNER_ONLY", season: { id: SEASON_CURRENT, title: "Осень 2026" } });
  });

  it("(2) registered for a current-season tournament but not arrived → BEGINNER_ONLY", async () => {
    await register(T_CURRENT, P.registered, "registered");
    expect((await tier(P.registered)).access).toBe("BEGINNER_ONLY");
  });

  it("(3) waitlisted → BEGINNER_ONLY", async () => {
    await register(T_CURRENT, P.waitlisted, "waitlist");
    expect((await tier(P.waitlisted)).access).toBe("BEGINNER_ONLY");
  });

  it("(4) a no-show (no_show_at, arrived=false, even a placed result row with arrived=false) → BEGINNER_ONLY", async () => {
    await register(T_CURRENT_2, P.noShow, "cancelled", true);
    await tournaments.setTournamentPlayerAttendance(T_CURRENT_2, P.noShow, false);
    await result(T_CURRENT_2, P.noShow, SEASON_CURRENT, false);
    expect((await tier(P.noShow)).access).toBe("BEGINNER_ONLY");
  });

  it("(4b) an attendance row with arrived=false alone → BEGINNER_ONLY", async () => {
    await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.arrivedFalseOnly, false);
    expect((await tier(P.arrivedFalseOnly)).access).toBe("BEGINNER_ONLY");
  });

  it("(5) current-season 'Пришёл' (real attendance setter) → FULL immediately, before completion; (6) toggled back → BEGINNER_ONLY", async () => {
    await register(T_CURRENT, P.arrives, "registered");
    expect((await tier(P.arrives)).access).toBe("BEGINNER_ONLY");

    await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.arrives, true);
    const [{ status }] = await client`SELECT status FROM tournaments WHERE id = ${T_CURRENT}::uuid`;
    expect(status).toBe("open"); // not completed: no results row exists
    expect((await tier(P.arrives)).access).toBe("FULL");

    await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.arrives, false);
    expect((await tier(P.arrives)).access).toBe("BEGINNER_ONLY");

    // Derived, never a one-way flag: re-arriving unlocks again.
    await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.arrives, true);
    expect((await tier(P.arrives)).access).toBe("FULL");
  });

  it("(7) a current-season results row → FULL (arrived=true snapshot and legacy NULL snapshot)", async () => {
    await result(T_CURRENT_2, P.currentResult, SEASON_CURRENT, true);
    await result(T_CURRENT_2, P.legacyResult, SEASON_CURRENT, null);
    expect((await tier(P.currentResult)).access).toBe("FULL");
    expect((await tier(P.legacyResult)).access).toBe("FULL");
  });

  it("(8) ONLY a previous-season result → BEGINNER_ONLY", async () => {
    await result(T_PREVIOUS, P.previousResultOnly, SEASON_PREVIOUS, true);
    expect((await tier(P.previousResultOnly)).access).toBe("BEGINNER_ONLY");
  });

  it("(9) previous-season attendance (arrived=true) → BEGINNER_ONLY", async () => {
    await tournaments.setTournamentPlayerAttendance(T_PREVIOUS, P.previousAttendanceOnly, true);
    expect((await tier(P.previousAttendanceOnly)).access).toBe("BEGINNER_ONLY");
  });

  it("(10) admin with zero participation → FULL; (11) operator with zero participation → FULL", async () => {
    expect((await tier(P.admin)).access).toBe("FULL");
    expect((await tier(P.operator)).access).toBe("FULL");
  });

  it("(12) no active season: an ordinary player (even with results) → BEGINNER_ONLY; staff → FULL; nothing crashes", async () => {
    await activateSeason(null);
    expect(await tier(P.currentResult)).toEqual({ access: "BEGINNER_ONLY", season: null });
    expect(await tier(P.noHistory)).toEqual({ access: "BEGINNER_ONLY", season: null });
    expect(await tier(P.admin)).toEqual({ access: "FULL", season: null });
    expect(await tier(P.operator)).toEqual({ access: "FULL", season: null });
  });

  it("past participation does NOT carry over when a new season becomes active", async () => {
    await activateSeason(SEASON_PREVIOUS);
    expect((await tier(P.currentResult)).access).toBe("BEGINNER_ONLY");
    expect((await tier(P.previousResultOnly)).access).toBe("FULL");
  });

  describe("through the real routes with real signed sessions", () => {
    it("GET /api/academy/access returns ONLY { access, season } and recomputes per request", async () => {
      const first = await accessRoute.GET(cookieRequest("/api/academy/access", P.noHistory));
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      const body = await first.json() as Record<string, unknown>;
      expect(body).toEqual({ access: "BEGINNER_ONLY", season: { id: SEASON_CURRENT, title: "Осень 2026" } });

      await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.noHistory, true);
      const second = await accessRoute.GET(cookieRequest("/api/academy/access", P.noHistory));
      expect(await second.json()).toEqual({ access: "FULL", season: { id: SEASON_CURRENT, title: "Осень 2026" } });
      await tournaments.setTournamentPlayerAttendance(T_CURRENT, P.noHistory, false);
    });

    it("a stale merged-away session resolves to the CANONICAL target's access (no merge special case)", async () => {
      // The merge engine moves history to the target; the source keeps nothing.
      await result(T_CURRENT_2, P.mergedTarget, SEASON_CURRENT, true);
      await client`UPDATE players SET merged_into_player_id = ${P.mergedTarget}::uuid, merged_at = now() WHERE id = ${P.mergedSource}::uuid`;

      const viaStaleCookie = await accessRoute.GET(cookieRequest("/api/academy/access", P.mergedSource));
      expect((await viaStaleCookie.json() as { access: string }).access).toBe("FULL");
    });

    it("a BEGINNER_ONLY player cannot open Quick Mix by calling the API directly (403, no question data)", async () => {
      const response = await mixSessionRoute.POST(cookieRequest("/api/academy/solver/preflop/mix/session", P.noHistory, {
        method: "POST", body: { attemptId: "22222222-2222-4222-8222-222222222222", questionIndex: 0 },
      }));
      expect(response.status).toBe(403);
      expect(Object.keys(await response.json() as object).sort()).toEqual(["code", "error"]);
    });

    it("the same player CAN train an exact beginner spot, and a FULL player can open Quick Mix", async () => {
      const beginner = await preflopSessionRoute.POST(cookieRequest("/api/academy/solver/preflop/session", P.noHistory, {
        method: "POST",
        body: { datasetId: "external_mtt_preflop_9max_40bb_v1", nodeKey: "FACING_OPEN_BB_VS_BTN", attemptId: "22222222-2222-4222-8222-222222222222", questionIndex: 0 },
      }));
      expect(beginner.status).toBe(200);

      const full = await mixSessionRoute.POST(cookieRequest("/api/academy/solver/preflop/mix/session", P.currentResult, {
        method: "POST", body: { attemptId: "22222222-2222-4222-8222-222222222222", questionIndex: 0 },
      }));
      expect(full.status).toBe(200);
    });
  });
});

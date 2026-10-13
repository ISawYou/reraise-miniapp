import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addRegistration, fake, resetFakeCapacityDb, seatedCount, statusOf } from "./helpers/fake-capacity-db";

// Stale-tab-after-merge through the REAL features/tournaments.ts Server
// Actions and the REAL features/auth-server.ts assertPlayerActive (NOT
// mocked here, unlike no-show-entry-points.test.ts / waitlist.test.ts) over
// the stateful fake capacity db. A tab opened before a merge still holds the
// merged-away SOURCE player id and passes it as the bare playerId argument;
// the action must reject before any registration state is created or changed
// under that dead row. Real-Postgres counterpart:
// lib/__tests__/admin-account-merge.postgres.integration.test.ts.
const mocks = vi.hoisted(() => ({
  players: new Map<string, Record<string, unknown>>(),
  tournament: { id: "t1", max_players: 40, is_final: false, status: "open", kind: "free" },
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));
vi.mock("@/lib/telegram-web-session", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: vi.fn(),
  resolveCurrentServerActor: vi.fn(),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/features/seasons", () => ({ resolveSeasonForTournamentDate: vi.fn() }));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/features/tournament-sheet-sync", () => ({
  syncAdmittedPlayerToSheet: vi.fn(async () => ({ arrivedWritten: true })),
}));

function toRow(row: { id: string; playerId: string; tournamentId: string; status: string; createdAt: Date }) {
  return {
    id: row.id,
    player_id: row.playerId,
    tournament_id: row.tournamentId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

vi.mock("@/lib/repositories", async () => {
  const { fake: f } = await import("./helpers/fake-capacity-db");
  const find = (playerId: string) => f.state.registrations.find((r) => r.playerId === playerId);
  return {
    playerRepository: {
      findById: vi.fn(async (id: string) => mocks.players.get(id) ?? null),
    },
    seasonRepository: {},
    resultRepository: {},
    tournamentRepository: {
      findById: vi.fn(async () => ({ ...mocks.tournament, max_players: f.state.maxPlayers })),
    },
    registrationRepository: {
      findLatestByPlayerAndTournament: vi.fn(async (playerId: string) => {
        const row = find(playerId);
        return row ? [toRow(row)] : [];
      }),
      findActiveOrWaitlistByPlayerAndTournamentOrThrow: vi.fn(async (playerId: string) => {
        const row = find(playerId);
        if (!row || !["registered", "waitlist"].includes(row.status)) throw new Error("not found");
        return toRow(row);
      }),
      updateStatusSilent: vi.fn(async (id: string, status: string) => {
        const row = f.state.registrations.find((r) => r.id === id);
        if (row) row.status = status;
      }),
    },
  };
});

const tournaments = await import("@/features/tournaments");
const { PlayerMergedAwayError, PlayerBlockedError } = await import("@/features/auth-server");

function setPlayer(id: string, overrides: Record<string, unknown> = {}) {
  mocks.players.set(id, {
    id,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  fake.state.startAt = new Date(Date.now() - 3600_000);
  mocks.players.clear();
  setPlayer("target");
  setPlayer("source", { merged_into_player_id: "target" });
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

describe("stale tab holding a merged-away SOURCE player id", () => {
  it("registerPlayerForTournament(source) is rejected and creates NO registration under the source", async () => {
    await expect(tournaments.registerPlayerForTournament("source", "t1")).rejects.toBeInstanceOf(
      PlayerMergedAwayError
    );
    expect(statusOf("source")).toBeUndefined();
    expect(fake.state.registrations).toHaveLength(0);
    expect(seatedCount()).toBe(0);
  });

  it("cancelPlayerRegistration(source) is rejected and leaves every registration untouched", async () => {
    // Even if a stray source-owned row existed, a stale tab must not mutate it.
    addRegistration("source", "registered");
    addRegistration("target", "registered");

    await expect(tournaments.cancelPlayerRegistration("source", "t1")).rejects.toBeInstanceOf(
      PlayerMergedAwayError
    );
    expect(statusOf("source")).toBe("registered");
    expect(statusOf("target")).toBe("registered");
  });

  it("the surviving TARGET registers and cancels exactly as an ordinary player", async () => {
    const result = await tournaments.registerPlayerForTournament("target", "t1");
    expect(result.status).toBe("registered");
    expect(statusOf("target")).toBe("registered");

    await tournaments.cancelPlayerRegistration("target", "t1");
    expect(statusOf("target")).toBe("cancelled");
  });

  it("a blocked (non-merged) player is still rejected with PlayerBlockedError, unchanged", async () => {
    setPlayer("blocked", { is_blocked: true });
    await expect(tournaments.registerPlayerForTournament("blocked", "t1")).rejects.toBeInstanceOf(
      PlayerBlockedError
    );
    expect(statusOf("blocked")).toBeUndefined();
  });
});

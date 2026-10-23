import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  fake,
  resetFakeCapacityDb,
  setPlayer as setFakePlayer,
  statusOf,
} from "./helpers/fake-capacity-db";

// Merged-away (tombstone) entrant guard in admitPlayerToTournament, through
// the REAL capacity module and the REAL features/tournaments.ts Server
// Actions over the stateful fake db. Proves the guard's position (first
// thing after the tournament-row lock, before any read/write -- including
// the promotion of OTHER players), its fail-closed outcome (rollback,
// nothing written), and the two caller-facing shapes (admin: returned
// { ok: false, error }; self-registration: PlayerMergedAwayError). The real
// row-lock interleavings against a concurrent account merge are proven in
// lib/__tests__/merged-away-operational-guard.postgres.integration.test.ts.
const mocks = vi.hoisted(() => ({
  // Player rows as seen by the EARLY (pre-transaction) checks
  // (assertPlayerActive via playerRepository.findById). The in-transaction
  // guard reads the fake db's players map instead, so a test can model a
  // merge committing between the two.
  players: new Map<string, Record<string, unknown>>(),
  tournament: { id: "t1", max_players: 40, is_final: false, status: "open", kind: "free" },
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));
vi.mock("@/lib/telegram-web-session", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: vi.fn(async () => ({ id: "staff", role: "operator" })),
  resolveCurrentServerActor: vi.fn(async () => null),
}));
vi.mock("@/features/achievements", () => ({ syncPlayersAchievementsIfEnabled: vi.fn() }));
vi.mock("@/features/club-activity", () => ({ publishTournamentWinnerEvent: vi.fn() }));
vi.mock("@/features/seasons", () => ({ resolveSeasonForTournamentDate: vi.fn() }));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: vi.fn(async () => true),
  sendTeamsTelegramNotification: vi.fn(),
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
        const row = f.state.registrations.find((r) => r.playerId === playerId);
        return row ? [toRow(row)] : [];
      }),
    },
  };
});

const tournaments = await import("@/features/tournaments");
const capacity = await import("@/features/tournament-waitlist-capacity");
const { PlayerMergedAwayError } = await import("@/features/auth-server");
const { MergedAwayPlayerSelectionError, MERGED_AWAY_PLAYER_SELECTION_MESSAGE } = await import(
  "@/lib/merged-away-player"
);

// Production shape: savinska33 (merged-away source) -> p_73a (canonical).
const P_73A = "p_73a";
const SAVINSKA33 = "savinska33";

function playerRow(id: string, mergedInto: string | null) {
  return {
    id,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: mergedInto,
    merged_at: mergedInto ? "2026-10-01T00:00:00.000Z" : null,
  };
}

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  mocks.players.clear();
  mocks.players.set(P_73A, playerRow(P_73A, null));
  mocks.players.set(SAVINSKA33, playerRow(SAVINSKA33, P_73A));
  setFakePlayer(SAVINSKA33, { mergedIntoPlayerId: P_73A });
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

describe("admitPlayerToTournament -- merged-away entrant guard", () => {
  it("rejects a tombstone entrant right after the tournament lock, before ANY other read/write, and rolls back", async () => {
    // A free seat + an eligible waiter: an admission that got past the guard
    // would promote `waiter` first. The rejected one must not.
    resetFakeCapacityDb({ maxPlayers: 1 });
    setFakePlayer(SAVINSKA33, { mergedIntoPlayerId: P_73A });
    addRegistration("waiter", "waitlist");

    await expect(capacity.admitPlayerToTournament("t1", SAVINSKA33)).rejects.toBeInstanceOf(
      MergedAwayPlayerSelectionError
    );

    expect(fake.state.log).toEqual(["tx:begin", "lock:tournaments", "lock:players", "tx:rollback"]);
    expect(statusOf(SAVINSKA33)).toBeUndefined();
    expect(statusOf("waiter")).toBe("waitlist");
  });

  it("rejects an unknown player id with nothing written", async () => {
    setFakePlayer("ghost", { exists: false });

    await expect(capacity.admitPlayerToTournament("t1", "ghost")).rejects.toThrow("Игрок не найден");

    expect(fake.state.registrations).toEqual([]);
    expect(fake.state.log.at(-1)).toBe("tx:rollback");
  });

  it("a canonical entrant takes tournament lock -> player lock -> player row touch, then the usual capacity flow", async () => {
    const registration = await capacity.admitPlayerToTournament("t1", P_73A);

    expect(registration.status).toBe("registered");
    expect(fake.state.log.slice(0, 5)).toEqual([
      "tx:begin",
      "lock:tournaments",
      "lock:players",
      "update:players",
      "select:tournament_late_registration",
    ]);
  });
});

describe("addExistingPlayerToTournament (admin 'Добавить существующего игрока')", () => {
  it("7 + 8. a direct call with the merged-away id returns the clear error and creates NO registration", async () => {
    const result = await tournaments.addExistingPlayerToTournament("t1", SAVINSKA33);

    expect(result).toEqual({ ok: false, error: MERGED_AWAY_PLAYER_SELECTION_MESSAGE });
    expect(MERGED_AWAY_PLAYER_SELECTION_MESSAGE).toBe(
      "Этот аккаунт уже объединён с другим. Выберите основной аккаунт."
    );
    expect(fake.state.registrations).toEqual([]);
    expect(fake.state.log).not.toContain("insert:registrations");
  });

  it("8. a cancelled pre-merge row on the tombstone is NOT reactivated", async () => {
    addRegistration(SAVINSKA33, "cancelled");

    const result = await tournaments.addExistingPlayerToTournament("t1", SAVINSKA33);

    expect(result.ok).toBe(false);
    expect(statusOf(SAVINSKA33)).toBe("cancelled");
  });

  it("6 + 9. the canonical target is still added exactly as before (never silently redirected)", async () => {
    const result = await tournaments.addExistingPlayerToTournament("t1", P_73A);

    expect(result).toEqual({ ok: true });
    expect(statusOf(P_73A)).toBe("registered");
    expect(statusOf(SAVINSKA33)).toBeUndefined();
  });

  it("9. other failures still throw unchanged (Late Registration closed)", async () => {
    fake.state.lateRegistrationClosed = true;

    await expect(tournaments.addExistingPlayerToTournament("t1", P_73A)).rejects.toThrow(
      "Поздняя регистрация завершена — запись на турнир закрыта"
    );
  });
});

describe("registerPlayerForTournament -- self-registration (regression 15)", () => {
  it("the early assertPlayerActive check still rejects a merged-away player with PlayerMergedAwayError", async () => {
    await expect(tournaments.registerPlayerForTournament(SAVINSKA33, "t1")).rejects.toBeInstanceOf(
      PlayerMergedAwayError
    );
    expect(fake.state.registrations).toEqual([]);
  });

  it("a merge committing AFTER the early check is caught by the in-lock guard, reported with the player-facing error", async () => {
    // Early check sees a canonical row; the locked re-read sees the merge.
    mocks.players.set(SAVINSKA33, playerRow(SAVINSKA33, null));

    const error = await tournaments.registerPlayerForTournament(SAVINSKA33, "t1").catch((e) => e);

    expect(error).toBeInstanceOf(PlayerMergedAwayError);
    expect((error as Error).message).toBe("Аккаунт был объединён. Обновите страницу.");
    expect(fake.state.registrations).toEqual([]);
  });

  it("canonical self-registration is unchanged", async () => {
    const registration = await tournaments.registerPlayerForTournament(P_73A, "t1");
    expect(registration.status).toBe("registered");
  });
});

// Regression guard for the notification recipient lists (unchanged by the
// broadcast-idempotency fix): one entry per telegram_id, first row wins,
// rows without a telegram_id dropped, audience routing unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findNotificationRecipients: vi.fn(),
  listByAccessColumn: vi.fn(),
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
  sendTournamentPromotionTelegramNotification: vi.fn(),
  sendTeamsTelegramNotification: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  registrationRepository: { findNotificationRecipients: mocks.findNotificationRecipients },
  playerRepository: { listByAccessColumn: mocks.listByAccessColumn },
  seasonRepository: {},
  resultRepository: {},
  tournamentRepository: {},
}));

const tournaments = await import("@/features/tournaments");

beforeEach(() => {
  mocks.findNotificationRecipients.mockReset();
  mocks.listByAccessColumn.mockReset();
});

describe("[16][18] getTournamentNotificationRecipients", () => {
  it("dedupes by telegram_id (first row wins) and drops rows without a telegram_id", async () => {
    mocks.findNotificationRecipients.mockResolvedValue([
      { player_id: "p1", status: "registered", players: { telegram_id: 100, display_name: "Alice" } },
      { player_id: "p2", status: "waitlist", players: { telegram_id: 100, display_name: "Alice twin" } },
      { player_id: "p3", status: "registered", players: { telegram_id: null, display_name: "NoTg" } },
      { player_id: "p4", status: "registered", players: null },
      { player_id: "p5", status: "attended", players: { telegram_id: 200, display_name: "Bob" } },
    ]);

    const result = await tournaments.getTournamentNotificationRecipients("t-1");

    expect(mocks.findNotificationRecipients).toHaveBeenCalledWith("t-1", expect.any(Array));
    expect(result.map((r) => [r.player_id, r.telegram_id, r.registration_status])).toEqual([
      ["p1", 100, "registered"],
      ["p5", 200, "attended"],
    ]);
  });
});

describe("[16] getTournamentAccessRecipientsByKind", () => {
  it.each([
    ["paid", "can_access_paid"],
    ["cash", "can_access_cash"],
    ["free", "can_access_free"],
  ] as const)("%s -> %s, deduped by telegram_id", async (kind, column) => {
    mocks.listByAccessColumn.mockResolvedValue([
      { id: "p1", telegram_id: 100, display_name: "Alice" },
      { id: "p2", telegram_id: 100, display_name: "Alice twin" },
      { id: "p3", telegram_id: null, display_name: "NoTg" },
      { id: "p4", telegram_id: 300, display_name: null },
    ]);

    const result = await tournaments.getTournamentAccessRecipientsByKind(kind);

    expect(mocks.listByAccessColumn).toHaveBeenCalledWith(column);
    expect(result).toEqual([
      { player_id: "p1", telegram_id: 100, display_name: "Alice", registration_status: null },
      { player_id: "p4", telegram_id: 300, display_name: "Игрок", registration_status: null },
    ]);
  });
});

describe("[18] getTournamentNotificationRecipientsByAudience routing", () => {
  it("registered -> registration list; access -> access list", async () => {
    mocks.findNotificationRecipients.mockResolvedValue([]);
    mocks.listByAccessColumn.mockResolvedValue([]);

    await tournaments.getTournamentNotificationRecipientsByAudience({
      tournamentId: "t-1",
      tournamentKind: "free",
      audience: "registered",
    });
    expect(mocks.findNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(mocks.listByAccessColumn).not.toHaveBeenCalled();

    await tournaments.getTournamentNotificationRecipientsByAudience({
      tournamentId: "t-1",
      tournamentKind: "paid",
      audience: "access",
    });
    expect(mocks.listByAccessColumn).toHaveBeenCalledWith("can_access_paid");
    expect(mocks.findNotificationRecipients).toHaveBeenCalledTimes(1);
  });
});

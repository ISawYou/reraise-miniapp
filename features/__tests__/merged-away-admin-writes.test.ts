import { beforeEach, describe, expect, it, vi } from "vitest";

// Operational admin write paths fed by the (now canonical-only) player
// directory. A stale picker / direct call submitting a merged-away
// (tombstone) id must be refused server-side with nothing written; the
// canonical player keeps working exactly as before.
const mocks = vi.hoisted(() => ({
  players: new Map<string, Record<string, unknown>>(),
  update: vi.fn(),
  createProfile: vi.fn(),
  createCompletedShift: vi.fn(),
}));

vi.mock("@/lib/repositories", () => {
  class DealerAlreadyOnShiftError extends Error {}
  class AdminShiftAlreadyOnShiftError extends Error {}
  return {
    playerRepository: {
      findById: vi.fn(async (id: string) => mocks.players.get(id) ?? null),
      findByIdOrThrow: vi.fn(async (id: string) => {
        const player = mocks.players.get(id);
        if (!player) throw new Error("Failed to fetch player: no rows returned");
        return player;
      }),
      findReferralFieldsById: vi.fn(async (id: string) =>
        mocks.players.has(id)
          ? { referral_count: 1, free_reentries_balance: 0, yandex_review_bonus_claimed: false }
          : null
      ),
      update: mocks.update,
    },
    dealerRepository: { createProfile: mocks.createProfile },
    adminShiftRepository: {
      createCompletedShift: mocks.createCompletedShift,
      listShiftsByAdminId: vi.fn(async () => []),
    },
    tournamentRepository: { findById: vi.fn(async (id: string) => ({ id, title: "T" })) },
    tournamentLiveStateRepository: {},
    achievementRepository: {},
    resultRepository: {},
    registrationRepository: {},
    DealerAlreadyOnShiftError,
    AdminShiftAlreadyOnShiftError,
  };
});
vi.mock("@/features/achievements", () => ({ syncPlayerAchievements: vi.fn() }));

const admin = await import("@/features/admin");
const dealers = await import("@/features/dealers");
const adminShifts = await import("@/features/admin-shifts");
const { MERGED_AWAY_PLAYER_SELECTION_MESSAGE } = await import("@/lib/merged-away-player");

// Production shape: savinska33 (merged-away) -> p_73a (canonical). Both
// staff-capable so the admin-shift role check can't mask the guard.
const P_73A = "p_73a";
const SAVINSKA33 = "savinska33";

beforeEach(() => {
  mocks.players.clear();
  mocks.players.set(P_73A, { id: P_73A, role: "operator", is_blocked: false, merged_into_player_id: null });
  mocks.players.set(SAVINSKA33, {
    id: SAVINSKA33,
    role: "operator",
    is_blocked: false,
    merged_into_player_id: P_73A,
  });
  mocks.update.mockReset().mockImplementation(async (id: string, patch: object) => ({ id, ...patch }));
  mocks.createProfile.mockReset().mockImplementation(async (playerId: string) => ({ player_id: playerId }));
  mocks.createCompletedShift.mockReset().mockImplementation(async (row: object) => ({ id: "s1", ...row }));
});

const MERGED = MERGED_AWAY_PLAYER_SELECTION_MESSAGE;

describe("moderation catalog actions", () => {
  it("setPlayerBlocked refuses a tombstone, allows the canonical player", async () => {
    await expect(admin.setPlayerBlocked(SAVINSKA33, false)).rejects.toThrow(MERGED);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.players.set(P_73A, { ...mocks.players.get(P_73A), role: "player" });
    await admin.setPlayerBlocked(P_73A, true);
    expect(mocks.update).toHaveBeenCalledWith(P_73A, { is_blocked: true });
  });

  it("setPlayerClubDiscount refuses a tombstone, allows the canonical player", async () => {
    await expect(admin.setPlayerClubDiscount(SAVINSKA33, 10)).rejects.toThrow(MERGED);
    expect(mocks.update).not.toHaveBeenCalled();

    await admin.setPlayerClubDiscount(P_73A, 10);
    expect(mocks.update).toHaveBeenCalledWith(P_73A, { club_discount_percent: 10 });
  });
});

describe("referral page actions", () => {
  it("setPlayerReferralCount refuses a tombstone, allows the canonical player", async () => {
    await expect(admin.setPlayerReferralCount(SAVINSKA33, 3)).rejects.toThrow(MERGED);
    expect(mocks.update).not.toHaveBeenCalled();

    await admin.setPlayerReferralCount(P_73A, 3);
    expect(mocks.update).toHaveBeenCalledWith(P_73A, { referral_count: 3 });
  });

  it("updatePlayerReferralData (legacy bundled actions) refuses a tombstone", async () => {
    await expect(admin.updatePlayerReferralData(SAVINSKA33, "increment_referral")).rejects.toThrow(MERGED);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("dealer association", () => {
  it("activateDealer refuses a tombstone (no dealer profile), allows the canonical player", async () => {
    await expect(dealers.activateDealer(SAVINSKA33)).rejects.toThrow(MERGED);
    expect(mocks.createProfile).not.toHaveBeenCalled();

    await dealers.activateDealer(P_73A);
    expect(mocks.createProfile).toHaveBeenCalledWith(P_73A, expect.any(Number));
  });
});

describe("admin shift historical backfill", () => {
  const input = (adminPlayerId: string) => ({
    adminPlayerId,
    tournamentId: "t1",
    startedAt: "2026-10-01T10:00:00.000Z",
    endedAt: "2026-10-01T18:00:00.000Z",
    amountRub: 1000,
    createdByPlayerId: "super",
  });

  it("createHistoricalAdminShift refuses a staff-role tombstone, allows the canonical staff player", async () => {
    await expect(adminShifts.createHistoricalAdminShift(input(SAVINSKA33))).rejects.toThrow(MERGED);
    expect(mocks.createCompletedShift).not.toHaveBeenCalled();

    await adminShifts.createHistoricalAdminShift(input(P_73A));
    expect(mocks.createCompletedShift).toHaveBeenCalledWith(
      expect.objectContaining({ admin_player_id: P_73A })
    );
  });
});

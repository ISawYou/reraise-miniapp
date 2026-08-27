import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = {
  findReferralFieldsById: vi.fn(),
  update: vi.fn(),
};

const mockAchievementRepository = {
  deleteByPlayerId: vi.fn(),
};

const mockSyncPlayerAchievements = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  tournamentLiveStateRepository: {},
  achievementRepository: mockAchievementRepository,
  resultRepository: {},
  registrationRepository: {},
}));

vi.mock("@/features/achievements", () => ({
  syncPlayerAchievements: mockSyncPlayerAchievements,
}));

// Imported after the mocks so features/admin.ts picks up the fakes, not the
// real Repository Layer or the real Achievement Engine -- same pattern as
// features/__tests__/achievements.test.ts.
const { updatePlayerReferralData } = await import("@/features/admin");

const PLAYER_ID = "player-1";

function referralFields(overrides: Partial<{
  referral_count: number;
  free_reentries_balance: number;
  yandex_review_bonus_claimed: boolean;
}> = {}) {
  return {
    referral_count: 0,
    free_reentries_balance: 0,
    yandex_review_bonus_claimed: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findReferralFieldsById.mockReset();
  mockPlayerRepository.update.mockReset().mockImplementation(
    async (_playerId: string, update: Record<string, unknown>) => ({ id: PLAYER_ID, ...update }),
  );
  mockSyncPlayerAchievements.mockClear().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updatePlayerReferralData — Achievement Engine wiring", () => {
  it("+1 referral resyncs achievements for that player", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 2 }));

    await updatePlayerReferralData(PLAYER_ID, "increment_referral");

    expect(mockPlayerRepository.update).toHaveBeenCalledWith(
      PLAYER_ID,
      expect.objectContaining({ referral_count: 3 }),
    );
    expect(mockSyncPlayerAchievements).toHaveBeenCalledTimes(1);
    expect(mockSyncPlayerAchievements).toHaveBeenCalledWith(PLAYER_ID, { publishActivityEvents: true });
  });

  it("-1 referral resyncs achievements when the count actually changes", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 5 }));

    await updatePlayerReferralData(PLAYER_ID, "decrement_referral");

    expect(mockPlayerRepository.update).toHaveBeenCalledWith(
      PLAYER_ID,
      expect.objectContaining({ referral_count: 4 }),
    );
    expect(mockSyncPlayerAchievements).toHaveBeenCalledTimes(1);
  });

  it("decrementing an already-zero referral count does not resync (nothing changed)", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(
      referralFields({ referral_count: 0, free_reentries_balance: 1 }),
    );

    await updatePlayerReferralData(PLAYER_ID, "decrement_referral");

    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("a free-reentry-only mutation never triggers a referral achievement resync", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 7 }));

    await updatePlayerReferralData(PLAYER_ID, "increment_free_reentries");

    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("a Yandex-review toggle never fakes a referral achievement resync", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 7 }));

    await updatePlayerReferralData(PLAYER_ID, "set_yandex_review", true);

    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("still returns the updated player even if the achievement resync fails", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 1 }));
    mockSyncPlayerAchievements.mockRejectedValueOnce(new Error("engine down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const player = await updatePlayerReferralData(PLAYER_ID, "increment_referral");

    expect(player).toMatchObject({ referral_count: 2 });
  });
});

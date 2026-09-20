import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = {
  findReferralFieldsById: vi.fn(),
  update: vi.fn(),
};

const mockSyncPlayerAchievements = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  tournamentLiveStateRepository: {},
  achievementRepository: {},
  resultRepository: {},
  registrationRepository: {},
}));

vi.mock("@/features/achievements", () => ({
  syncPlayerAchievements: mockSyncPlayerAchievements,
}));

// Imported after the mocks -- same pattern as
// admin-referral-achievement-sync.test.ts.
const { setPlayerReferralCount } = await import("@/features/admin");

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

describe("setPlayerReferralCount -- narrow operator-safe referral mutation", () => {
  it("an ordinary operator-reachable call sets referral_count to the exact given value", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 2 }));

    await setPlayerReferralCount(PLAYER_ID, 7);

    expect(mockPlayerRepository.update).toHaveBeenCalledWith(
      PLAYER_ID,
      { referral_count: 7 },
    );
  });

  it("is idempotent -- setting the same value twice never double-applies or errors", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 5 }));

    await setPlayerReferralCount(PLAYER_ID, 5);

    expect(mockPlayerRepository.update).toHaveBeenCalledWith(PLAYER_ID, { referral_count: 5 });
  });

  it("rejects a negative value before touching the repository", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields());

    await expect(setPlayerReferralCount(PLAYER_ID, -1)).rejects.toThrow(/неотрицательным/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a non-integer value before touching the repository", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields());

    await expect(setPlayerReferralCount(PLAYER_ID, 2.5)).rejects.toThrow(/целым числом/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("never touches free_reentries_balance or yandex_review_bonus_claimed", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(
      referralFields({ referral_count: 2, free_reentries_balance: 3, yandex_review_bonus_claimed: true }),
    );

    await setPlayerReferralCount(PLAYER_ID, 9);

    const update = mockPlayerRepository.update.mock.calls[0][1];
    expect(update).not.toHaveProperty("free_reentries_balance");
    expect(update).not.toHaveProperty("yandex_review_bonus_claimed");
  });

  it("resyncs achievements when the count actually changes", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 2 }));

    await setPlayerReferralCount(PLAYER_ID, 9);

    expect(mockSyncPlayerAchievements).toHaveBeenCalledTimes(1);
    expect(mockSyncPlayerAchievements).toHaveBeenCalledWith(PLAYER_ID, { publishActivityEvents: true });
  });

  it("does not resync when the value is unchanged", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(referralFields({ referral_count: 4 }));

    await setPlayerReferralCount(PLAYER_ID, 4);

    expect(mockSyncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("rejects a non-existent player", async () => {
    mockPlayerRepository.findReferralFieldsById.mockResolvedValue(null);

    await expect(setPlayerReferralCount(PLAYER_ID, 3)).rejects.toThrow(/не найден/);
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVisualRepository = {
  list: vi.fn(),
  upsert: vi.fn(),
};
const mockStorageRepository = {
  upload: vi.fn(),
};

vi.mock("@/lib/repositories", () => ({
  achievementVisualRepository: mockVisualRepository,
  achievementAssetStorageRepository: mockStorageRepository,
}));

const {
  getAchievementVisualConfigs,
  saveAchievementVisualConfig,
} = await import("@/features/achievement-visuals");

describe("achievement visual config", () => {
  beforeEach(() => {
    mockVisualRepository.list.mockReset().mockResolvedValue([]);
    mockVisualRepository.upsert.mockReset().mockResolvedValue(undefined);
  });

  it("returns all 12 central visuals and 4 frames from explicit defaults", async () => {
    const configs = await getAchievementVisualConfigs();
    expect(configs).toHaveLength(16);
    expect(configs.find((item) => item.visualKey === "in_game")?.assetUrl)
      .toBe("/achievement-assets/in-game.png");
    expect(configs.find((item) => item.visualKey === "platinum")?.assetUrl)
      .toBe("/achievement-assets/platinum.png");
  });

  it("saves and reads persistent admin geometry", async () => {
    const saved = {
      visualKey: "terminator" as const,
      assetUrl: "https://www.re-raise.ru/storage/achievement-assets/terminator-v2.png",
      scale: 112,
      offsetX: -4,
      offsetY: 7,
    };
    await saveAchievementVisualConfig(saved);
    expect(mockVisualRepository.upsert).toHaveBeenCalledWith(saved);

    mockVisualRepository.list.mockResolvedValue([saved]);
    expect((await getAchievementVisualConfigs()).find((item) => item.visualKey === "terminator"))
      .toEqual(saved);
  });
});

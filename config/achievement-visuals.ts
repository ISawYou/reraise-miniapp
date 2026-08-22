import {
  ACHIEVEMENT_FRAME_KEY,
  ACHIEVEMENT_VISUAL_KEY,
  type AchievementAssetKey,
} from "@/config/achievements";

export type AchievementVisualConfig = {
  visualKey: AchievementAssetKey;
  assetUrl: string;
  scale: number;
  offsetX: number;
  offsetY: number;
};

// Explicit product mapping. Filenames are storage details, never business keys.
export const DEFAULT_ACHIEVEMENT_VISUALS = {
  [ACHIEVEMENT_VISUAL_KEY.IN_GAME]: "/achievement-assets/in-game.png",
  [ACHIEVEMENT_VISUAL_KEY.TRIUMPHATOR]: "/achievement-assets/triumphator.png",
  [ACHIEVEMENT_VISUAL_KEY.PLAYER_PATH]: "/achievement-assets/player-path.png",
  [ACHIEVEMENT_VISUAL_KEY.ITM]: "/achievement-assets/itm.png",
  [ACHIEVEMENT_VISUAL_KEY.COMMUNITY]: "/achievement-assets/community.png",
  [ACHIEVEMENT_VISUAL_KEY.TERMINATOR]: "/achievement-assets/terminator.png",
  [ACHIEVEMENT_VISUAL_KEY.BOSS_HUNTER]: "/achievement-assets/boss-hunter.png",
  [ACHIEVEMENT_VISUAL_KEY.STREAK]: "/achievement-assets/streak.png",
  [ACHIEVEMENT_VISUAL_KEY.ROYAL_FLUSH]: "/achievement-assets/royal-flush.png",
  [ACHIEVEMENT_VISUAL_KEY.NUMBER_ONE]: "/achievement-assets/number-one.png",
  [ACHIEVEMENT_VISUAL_KEY.HEADHUNTER]: "/achievement-assets/headhunter.png",
  [ACHIEVEMENT_VISUAL_KEY.MARCO_REUS]: "/achievement-assets/marco-reus.png",
  [ACHIEVEMENT_FRAME_KEY.BRONZE]: "/achievement-assets/bronze.png",
  [ACHIEVEMENT_FRAME_KEY.SILVER]: "/achievement-assets/silver.png",
  [ACHIEVEMENT_FRAME_KEY.GOLD]: "/achievement-assets/gold.png",
  [ACHIEVEMENT_FRAME_KEY.PLATINUM]: "/achievement-assets/platinum.png",
} as const satisfies Record<AchievementAssetKey, string>;

export const ACHIEVEMENT_ASSET_KEYS = Object.keys(
  DEFAULT_ACHIEVEMENT_VISUALS,
) as AchievementAssetKey[];

export function isAchievementAssetKey(value: string): value is AchievementAssetKey {
  return value in DEFAULT_ACHIEVEMENT_VISUALS;
}

export function getDefaultAchievementVisual(
  visualKey: AchievementAssetKey,
): AchievementVisualConfig {
  return {
    visualKey,
    assetUrl: DEFAULT_ACHIEVEMENT_VISUALS[visualKey],
    scale: 100,
    offsetX: 0,
    offsetY: 0,
  };
}

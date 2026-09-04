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
//
// PLATINUM tier was publicly rebranded to "Diamond" -- the internal tier
// key/value stays `platinum` (see ACHIEVEMENT_TIER/ACHIEVEMENT_FRAME_KEY in
// config/achievements.ts; player_achievements rows, sortOrder, and every
// achievement_code are untouched), only the artwork and public label
// changed. public/achievement-assets/platinum.png was ALSO overwritten with
// the same new artwork (not deleted) as a defensive alias, in case any
// already-persisted achievement_visual_configs row still points at the old
// literal URL string -- both paths serve the identical PNG.
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
  [ACHIEVEMENT_FRAME_KEY.PLATINUM]: "/achievement-assets/diamond.png",
} as const satisfies Record<AchievementAssetKey, string>;

export const ACHIEVEMENT_ASSET_KEYS = Object.keys(
  DEFAULT_ACHIEVEMENT_VISUALS,
) as AchievementAssetKey[];

export function isAchievementAssetKey(value: string): value is AchievementAssetKey {
  return value in DEFAULT_ACHIEVEMENT_VISUALS;
}

// Small closed set: exactly the built-in local URLs above, each mapped to
// its pre-generated 256x256 thumbnail and 512x512 medium derivative (see
// scripts/generate-achievement-thumbnails.mjs). Deliberately an exact-string
// lookup, not a path-prefix rewrite -- an admin-managed `assetUrl` can point
// anywhere (external URL, uploaded storage path, a future replacement for
// one of these same built-in files), and none of those have a generated
// derivative. Guessing a `/thumb/` or `/medium/` path for an unknown URL
// would produce a broken <img>, so resolveAchievementAssetUrl() below only
// ever substitutes a derivative for a URL it recognizes exactly, and
// returns the original unchanged for everything else.
const ACHIEVEMENT_THUMBNAIL_URLS: ReadonlyMap<string, string> = new Map(
  Object.values(DEFAULT_ACHIEVEMENT_VISUALS).map((assetUrl) => [
    assetUrl,
    assetUrl.replace("/achievement-assets/", "/achievement-assets/thumb/"),
  ]),
);

// Same idea, one size up -- 512x512, for the full Achievements page's
// larger (~112-176px) grid/detail artwork, which the 256px thumbnail would
// visibly under-serve at typical device pixel ratios.
const ACHIEVEMENT_MEDIUM_URLS: ReadonlyMap<string, string> = new Map(
  Object.values(DEFAULT_ACHIEVEMENT_VISUALS).map((assetUrl) => [
    assetUrl,
    assetUrl.replace("/achievement-assets/", "/achievement-assets/medium/"),
  ]),
);

export type AchievementAssetVariant = "original" | "thumbnail" | "medium";

// The one place "which URL does this <img> actually request" gets decided.
// "original" (the default everywhere except Home's small icons and the full
// Achievements page) is a no-op. "thumbnail"/"medium" each substitute their
// matching pre-generated derivative ONLY for a known built-in local asset
// URL; any other URL (external, storage-hosted, or simply not in the
// built-in set) falls through to the original -- never a
// rewritten-but-nonexistent path.
export function resolveAchievementAssetUrl(
  assetUrl: string,
  variant: AchievementAssetVariant,
): string {
  if (variant === "thumbnail") return ACHIEVEMENT_THUMBNAIL_URLS.get(assetUrl) ?? assetUrl;
  if (variant === "medium") return ACHIEVEMENT_MEDIUM_URLS.get(assetUrl) ?? assetUrl;
  return assetUrl;
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

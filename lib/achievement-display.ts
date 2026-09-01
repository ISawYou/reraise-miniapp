import {
  ACHIEVEMENT_CATEGORY,
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_TIER,
  ACHIEVEMENTS_CATALOG,
  type AchievementDefinition,
  type AchievementFamily,
  type AchievementTierLevel,
  type AchievementVisualKey,
} from "@/config/achievements";

export type AchievementProgressRow = {
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
};

export type TieredAchievementCard = {
  family: AchievementFamily;
  name: string;
  visualKey: AchievementVisualKey;
  unit: string;
  description: string;
  currentValue: number;
  currentTier: AchievementTierLevel | null;
  currentTierLabel: string | null;
  nextTier: AchievementTierLevel | null;
  nextTierLabel: string | null;
  nextTarget: number | null;
  maxLevel: boolean;
  tiers: Array<{
    code: string;
    tier: AchievementTierLevel;
    name: string;
    description: string;
    earned: boolean;
    target: number;
    completedAt: string | null;
  }>;
};

export type LegendaryAchievementCard = {
  code: string;
  name: string;
  description: string;
  visualKey: AchievementVisualKey;
  earned: boolean;
  hidden: boolean;
  completedAt: string | null;
};

const TIER_ORDER: AchievementTierLevel[] = [
  ACHIEVEMENT_TIER.BRONZE,
  ACHIEVEMENT_TIER.SILVER,
  ACHIEVEMENT_TIER.GOLD,
  ACHIEVEMENT_TIER.PLATINUM,
];

// Public-facing tier names. Internal tier VALUES (bronze/silver/gold/
// platinum) never change -- see config/achievement-visuals.ts's doc
// comment on the artwork rebrand for why `platinum` stays the internal key
// while its public label is now "Алмаз" (Diamond).
export const TIER_LABELS: Record<AchievementTierLevel, string> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
  platinum: "Алмаз",
};

// Descending prestige order for surfaces that rank achievements across both
// axes at once (tiered families AND category=LEGENDARY, which has no
// `tier` of its own -- see ACHIEVEMENT_TYPE's doc comment in
// config/achievements.ts). Publicly: Легендарная -> Алмаз -> Золото ->
// Серебро -> Бронза. Extracted here (from what used to be an inline object
// literal on the profile page) purely so this ordering is testable in one
// place -- the numbers themselves are unchanged.
export const TIER_SORT_PRIORITY: Record<AchievementTierLevel, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
};
export const LEGENDARY_SORT_PRIORITY = 5;

export function buildAchievementDisplayModel(rows: AchievementProgressRow[]) {
  const progress = new Map(rows.map((row) => [row.achievement_code, row]));

  const families = (Object.keys(ACHIEVEMENT_FAMILIES) as AchievementFamily[]).map(
    (family): TieredAchievementCard => {
      const metadata = ACHIEVEMENT_FAMILIES[family];
      const definitions = (ACHIEVEMENTS_CATALOG as readonly AchievementDefinition[]).filter(
        (definition) => definition.family === family && definition.tier && definition.target,
      ).sort(
        (a, b) => TIER_ORDER.indexOf(a.tier!) - TIER_ORDER.indexOf(b.tier!),
      ) as AchievementDefinition[];

      if (definitions.length !== 4) {
        throw new Error(`Achievement family ${family} must contain exactly four tiers`);
      }

      const earnedDefinitions = definitions.filter(
        (definition) => progress.get(definition.code)?.completed_at != null,
      );
      const currentDefinition = earnedDefinitions.at(-1) ?? null;
      const nextDefinition = definitions.find(
        (definition) => progress.get(definition.code)?.completed_at == null,
      ) ?? null;
      const currentValue = Math.max(
        0,
        ...definitions.map(
          (definition) => progress.get(definition.code)?.current_value ?? 0,
        ),
      );

      return {
        family,
        name: metadata.name,
        visualKey: metadata.visualKey,
        unit: metadata.unit,
        description: metadata.description,
        currentValue,
        currentTier: currentDefinition?.tier ?? null,
        currentTierLabel: currentDefinition
          ? family === "player_path"
            ? currentDefinition.name
            : TIER_LABELS[currentDefinition.tier!]
          : null,
        nextTier: nextDefinition?.tier ?? null,
        nextTierLabel: nextDefinition
          ? family === "player_path"
            ? nextDefinition.name
            : TIER_LABELS[nextDefinition.tier!]
          : null,
        nextTarget: nextDefinition?.target ?? null,
        maxLevel: currentDefinition?.tier === ACHIEVEMENT_TIER.PLATINUM,
        tiers: definitions.map((definition) => ({
          code: definition.code,
          tier: definition.tier!,
          name: definition.name,
          description: definition.description,
          target: definition.target!,
          earned: progress.get(definition.code)?.completed_at != null,
          completedAt: progress.get(definition.code)?.completed_at ?? null,
        })),
      };
    },
  );

  const legendary = (ACHIEVEMENTS_CATALOG as readonly AchievementDefinition[]).filter(
    (definition) => definition.category === ACHIEVEMENT_CATEGORY.LEGENDARY,
  ).map((definition): LegendaryAchievementCard => {
    const earned = progress.get(definition.code)?.completed_at != null;
    return {
      code: definition.code,
      name: definition.hidden && !earned ? "Секретное достижение" : definition.name,
      description:
        definition.hidden && !earned
          ? "Продолжайте играть, чтобы раскрыть условие"
          : definition.description,
      visualKey: definition.visualKey!,
      earned,
      hidden: definition.hidden === true,
      completedAt: progress.get(definition.code)?.completed_at ?? null,
    };
  });

  return { families, legendary };
}

export type FeaturedAchievementKey = AchievementFamily | string;

export function getEarnedFeaturedOptions(rows: AchievementProgressRow[]) {
  const model = buildAchievementDisplayModel(rows);
  return [
    ...model.families.filter((card) => card.currentTier).map((card) => ({
      key: card.family,
      name: card.name,
      visualKey: card.visualKey,
      tier: card.currentTier,
    })),
    ...model.legendary.filter((card) => card.earned).map((card) => ({
      key: card.code,
      name: card.name,
      visualKey: card.visualKey,
      tier: null,
    })),
  ];
}

export function resolveFeaturedAchievements(
  rows: AchievementProgressRow[],
  selectedKeys: string[],
) {
  const earned = new Map(getEarnedFeaturedOptions(rows).map((item) => [item.key, item]));
  return selectedKeys.map((key) => earned.get(key)).filter((item) => item != null);
}

export function validateFeaturedAchievementKeys(
  rows: AchievementProgressRow[],
  selectedKeys: string[],
): string[] {
  const unique = [...new Set(selectedKeys)];
  if (unique.length > 3) throw new Error("Можно выбрать не больше трёх достижений");
  const earnedKeys = new Set(getEarnedFeaturedOptions(rows).map(({ key }) => key));
  if (unique.some((key) => !earnedKeys.has(key))) {
    throw new Error("Можно выбрать только полученные достижения");
  }
  return unique;
}

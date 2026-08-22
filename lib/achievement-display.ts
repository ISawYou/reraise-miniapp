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
  currentValue: number;
  currentTier: AchievementTierLevel | null;
  currentTierLabel: string | null;
  nextTier: AchievementTierLevel | null;
  nextTierLabel: string | null;
  nextTarget: number | null;
  maxLevel: boolean;
  tiers: Array<{ tier: AchievementTierLevel; earned: boolean; target: number }>;
};

export type LegendaryAchievementCard = {
  code: string;
  name: string;
  description: string;
  visualKey: AchievementVisualKey;
  earned: boolean;
  hidden: boolean;
};

const TIER_ORDER: AchievementTierLevel[] = [
  ACHIEVEMENT_TIER.BRONZE,
  ACHIEVEMENT_TIER.SILVER,
  ACHIEVEMENT_TIER.GOLD,
  ACHIEVEMENT_TIER.PLATINUM,
];

export const TIER_LABELS: Record<AchievementTierLevel, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

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
          tier: definition.tier!,
          target: definition.target!,
          earned: progress.get(definition.code)?.completed_at != null,
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
    };
  });

  return { families, legendary };
}

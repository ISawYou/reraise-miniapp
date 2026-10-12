import "server-only";

import type { TrainingPresetCard } from "@/components/academy/training-preset-list";
import { getAcademySpotProgressUnit } from "@/config/academy/spot-progress";
import {
  ACADEMY_TRAINING_PRESETS,
  type AcademyTrainingPreset,
  academyTrainingPresetRoute,
  isAcademyTrainingPresetScored,
} from "@/config/academy/training-presets";
import { AcademyPreflopTrainerSelectionError, requireAcademyPreflopTrainerSpotByStack } from "@/lib/academy/preflop-trainer";
import { AcademyPushFoldSelectionError, requireAcademyPushFoldSpotByStack } from "@/lib/academy/push-fold-trainer";

/**
 * A preset as a card, or null when its node does not resolve through the
 * owning trainer's fail-closed lookup (never a link to an invented spot).
 */
export function resolveTrainingPresetCard(preset: AcademyTrainingPreset): TrainingPresetCard | null {
  try {
    const spot = preset.engine === "PREFLOP_TRAINER"
      ? requireAcademyPreflopTrainerSpotByStack(preset.stackBb, preset.nodeKey).spot
      : requireAcademyPushFoldSpotByStack(preset.stackBb, preset.nodeKey).spot;
    const unit = preset.engine === "PREFLOP_TRAINER" ? getAcademySpotProgressUnit(spot) : null;
    return {
      id: preset.id,
      title: preset.title,
      description: preset.description,
      href: academyTrainingPresetRoute(preset),
      stackBb: spot.stackBb,
      hero: spot.heroPosition,
      ...(spot.villainPosition ? { villain: spot.villainPosition } : {}),
      scored: isAcademyTrainingPresetScored(preset),
      ...(unit ? { progressCode: unit.code } : {}),
    };
  } catch (error) {
    if (error instanceof AcademyPreflopTrainerSelectionError || error instanceof AcademyPushFoldSelectionError) return null;
    throw error;
  }
}

/** Every preset whose node resolves, in landing order. */
export function listTrainingPresetCards(): TrainingPresetCard[] {
  return ACADEMY_TRAINING_PRESETS.flatMap((preset) => resolveTrainingPresetCard(preset) ?? []);
}

import type { PreflopTrainerContext } from "@/components/academy/preflop-trainer";
import { beginnerAfterOpenLessonRoute } from "@/config/academy/beginner-after-open";
import { ACADEMY_ADVANCED_ROUTE, ACADEMY_TRAINERS_ROUTE } from "@/config/academy/navigation-routes";
import { ACADEMY_TRAINING_PRESET_QUERY, getAcademyTrainingPreset } from "@/config/academy/training-presets";

/**
 * Header / back link of a session opened from a preset, a lesson or the
 * advanced section. PRESENTATION ONLY: the node always comes from the route
 * params (fail-closed lookup), the session is server-derived as before, and a
 * preset that does not name THIS node is ignored.
 */
export function resolvePreflopTrainerContext(
  spot: { readonly stackBb: number; readonly nodeKey: string },
  query: Record<string, string | string[] | undefined>,
): PreflopTrainerContext | undefined {
  const from = typeof query.from === "string" ? query.from : undefined;
  const preset = getAcademyTrainingPreset(query[ACADEMY_TRAINING_PRESET_QUERY]);
  if (preset && preset.engine === "PREFLOP_TRAINER" && preset.stackBb === spot.stackBb && preset.nodeKey === spot.nodeKey) {
    return {
      eyebrow: preset.title,
      back: from === "lesson" && preset.lessonSlug
        ? { href: beginnerAfterOpenLessonRoute(preset.lessonSlug), label: "К уроку" }
        : { href: ACADEMY_TRAINERS_ROUTE, label: "Тренажёры" },
    };
  }
  if (from === "advanced") return { back: { href: ACADEMY_ADVANCED_ROUTE, label: "Продвинутым" } };
  return undefined;
}

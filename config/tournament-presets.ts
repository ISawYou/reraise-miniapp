import type { TournamentType } from "@/types/domain";

// "Финал месяца" is a CREATE/EDIT UI preset, not a persisted TournamentType
// (see lib/db/schema/tournaments.ts's isFinal column comment) -- selecting
// it always submits tournament_type="classic" + is_final=true. Every other
// consumer (rating, tournament helpers, Poker Clock, the DB CHECK
// constraint) keeps working with the real, unchanged TournamentType only.
// TournamentPreset exists purely for the admin create/edit type selector.
export type TournamentPreset = TournamentType | "final_month";

export const FINAL_MONTH_PRESET = "final_month" as const;

export const FINAL_MONTH_LABEL = "Финал месяца";

// Intentionally short -- no starting stack / Add-on sentence appended,
// unlike the normal per-type templates below. The final has no separate
// stack configuration; do not merge this with the normal templates'
// stack/Add-on suffix logic.
export const FINAL_MONTH_TEMPLATE = {
  title: "ФИНАЛ МЕСЯЦА",
  description:
    "Финальный турнир месяца РЕРЕЙЗ. В игре встретятся сильнейшие участники месяца, чтобы определить победителя финала. Состав турнира формируется по приглашению.",
};

// Single source of truth for the create/edit auto-fill title+description
// templates -- shared by app/admin/tournaments/create/page.tsx and
// app/admin/tournaments/[id]/edit/page.tsx so the copy can't drift between
// the two screens. Each screen keeps its own TOURNAMENT_TYPE_OPTIONS labels
// (they already differ slightly, e.g. "Classic" vs "Texas Classic") --
// only this template content (title/description actually filled into the
// form) is shared.
export const TOURNAMENT_PRESET_TEMPLATES: Record<
  TournamentPreset,
  { title: string; description: string }
> = {
  [FINAL_MONTH_PRESET]: FINAL_MONTH_TEMPLATE,
  classic: {
    title: "CLASSIC",
    description: "Классический турнир без дополнительных механик. Главная задача - пройти как можно дальше и занять высокое место. Re-entry и Add-on увеличивают общий рейтинговый пул турнира. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  bounty: {
    title: "BOUNTY HUNTERS",
    description: "Турнир, где важны не только итоговое место, но и выбитые соперники. Каждый нокаут приносит +5 рейтинговых очков, поэтому заработать рейтинг можно ещё до финального стола. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  boss_bounty: {
    title: "BOSS BOUNTY",
    description: "Bounty-турнир с дополнительной охотой на Боссов. Обычный нокаут приносит +5 очков, нокаут Босса - +10 очков. Итоговое место также влияет на рейтинг. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  win_the_button: {
    title: "WIN THE BUTTON",
    description: "Турнир с дополнительной борьбой за позицию. Победитель раздачи получает баттон на следующую - выигрывай банки, забирай позицию и используй преимущество за столом. Re-entry и Add-on увеличивают рейтинговый пул. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  deep_stack: {
    title: "DEEP STACK",
    description: "Турнир с увеличенным стартовым стеком и большим пространством для игры. Больше фишек позволяет играть глубже и принимать больше решений без давления короткого стека. Re-entry и Add-on увеличивают рейтинговый пул. Стартовый стек — 50 000 фишек. Add-on — 100 000 фишек.",
  },
  mystery_bounty: {
    title: "MYSTERY BOUNTY",
    description: "Bounty-формат с неизвестной наградой за нокаут. После окончания поздней регистрации формируется отдельный пул рейтинговых очков и конверты с разными наградами. Выбиваешь соперника - узнаёшь, сколько очков было спрятано в твоём конверте. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  phoenix: {
    title: "PHOENIX",
    description: "Особый рейтинговый формат РЕРЕЙЗ с заранее установленным гарантированным пулом очков. Независимо от количества участников в турнире разыгрывается заявленный рейтинговый пул. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
};

// The one true mapping from a UI preset to what actually gets persisted --
// every create/edit write path must go through this instead of hand-rolling
// tournament_type/is_final, so is_final is never accidentally desynced from
// the selected preset.
export function presetToTournamentFields(
  preset: TournamentPreset,
): { tournament_type: TournamentType; is_final: boolean } {
  if (preset === FINAL_MONTH_PRESET) {
    return { tournament_type: "classic", is_final: true };
  }
  return { tournament_type: preset, is_final: false };
}

// Inverse mapping, for loading an existing tournament into the admin edit
// form's preset selector -- is_final is the only signal, never inferred
// from tournament_type/title/description.
export function tournamentToPreset(tournament: {
  tournament_type: TournamentType;
  is_final: boolean;
}): TournamentPreset {
  return tournament.is_final ? FINAL_MONTH_PRESET : tournament.tournament_type;
}

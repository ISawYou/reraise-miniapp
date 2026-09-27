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
  crazy_pineapple: {
    title: "CRAZY PINEAPPLE",
    description: "Динамичный формат Hold’em с дополнительной картой на старте. Каждый игрок получает 3 закрытые карты вместо двух. Префлоп и флоп играются по правилам обычного Texas Hold’em, а после завершения торговли на флопе каждый оставшийся игрок обязан сбросить одну из трёх карманных карт. Терн и ривер проходят уже с двумя картами на руках, а итоговая комбинация составляется из лучших 5 доступных карт. Больше стартовых комбинаций, больше решений и больше экшена. Re-entry и Add-on увеличивают рейтинговый пул. Стартовый стек — 30 000 фишек. Add-on — 60 000 фишек.",
  },
  bomb_pot: {
    title: "BOMB POT",
    description: "Турнир по Texas Hold'em со специальными Bomb Pot раздачами.\n\nРаз в каждый уровень до окончания поздней регистрации проводится одна Bomb Pot раздача. Bomb Pot проводится первой раздачей нового уровня на каждом активном столе.\n\nВ Bomb Pot раздаче каждый игрок, получающий карты, вносит 3 BB. Обычные SB, BB и ante не ставятся, префлоп-торговли нет — после выдачи карманных карт сразу открывается одна доска флопа. Начиная с флопа игра идёт по обычным правилам Texas Hold'em.\n\nЕсли у игрока меньше 3 BB, он выставляет весь оставшийся стек all-in, дальше используются обычные main/side pots.\n\nBomb Pot проводится только пока открыта поздняя регистрация. После закрытия Late Registration специальные раздачи прекращаются.\n\nRe-entry и Add-on продолжают влиять на рейтинговый объём турнира.",
  },
  // Title is the first Boost event's name, not the type name. "x2" in the
  // copy matches DEFAULT_BOOST_PLACEMENT_POINTS_MULTIPLIER; the actual math
  // always uses the tournament's stored placement_points_multiplier.
  boost_rating: {
    title: "RERAISE MAIN EVENT",
    description: "Специальный рейтинговый турнир РЕРЕЙЗ, в котором очки за призовые места умножаются на повышающий коэффициент.\n\nВ текущем турнире коэффициент составляет x2.\n\nБуст применяется только к рейтинговым очкам за занятое место. +2 очка за участие не умножаются.\n\nRe-entry и Add-on продолжают влиять на рейтинговый объём турнира по обычным правилам volume-турниров.\n\nНокаут-бонусов в этом формате нет.",
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

// Boost Rating UI default (create screen, and a tournament switched to
// boost_rating on edit). Mirrors features/tournaments.ts's server-side
// default for API callers that omit the value.
export const DEFAULT_BOOST_PLACEMENT_POINTS_MULTIPLIER = 2;

// Admin form input -> submitted placement_points_multiplier. Every
// non-boost type always submits exactly 1. Returns null for an invalid
// boost value (not positive / more than 2 decimals / out of numeric(5,2)
// range) so the form can show an error instead of submitting.
export function parsePlacementPointsMultiplierInput(
  tournamentType: TournamentType,
  input: string,
): number | null {
  if (tournamentType !== "boost_rating") return 1;
  const trimmed = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value >= 1000) return null;
  return value;
}

// Server-side canonical normalization (features/tournaments.ts create/
// update). Non-boost types are always stored as exactly 1; a boost_rating
// tournament without an explicit value (API callers) gets the default.
// Throws on an invalid explicit value -- never silently coerced.
export function normalizePlacementPointsMultiplier(
  tournamentType: TournamentType,
  value: number | null | undefined,
): number {
  if (tournamentType !== "boost_rating") return 1;
  if (value == null) return DEFAULT_BOOST_PLACEMENT_POINTS_MULTIPLIER;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 1000) {
    throw new Error("Коэффициент буста должен быть положительным числом");
  }
  if (Math.abs(Math.round(numeric * 100) - numeric * 100) > 1e-9) {
    throw new Error("Коэффициент буста: не более двух знаков после запятой");
  }
  return numeric;
}

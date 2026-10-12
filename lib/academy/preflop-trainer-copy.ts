/**
 * Russian, answer-free presentation copy for the configurable preflop
 * trainer (client-safe, pure). Composes spot descriptions from the spot's
 * own fields — no per-combination strings — and localizes the dataset's
 * generic action codes. Never invents sizes: an action shows `amountBb` only
 * when its definition carries one.
 */
import { type AcademyPreflopSizingStep, formatSizingBbLabel } from "@/lib/academy/preflop-sizing";
import type {
  AcademyPreflopTrainerSituation,
  AcademyPreflopTrainerSpot,
  AcademyPreflopTrainerSpotCopy,
  AcademySolverPublicAction,
  AcademyStrategyActionLocalizedCopy,
} from "@/types/academy";

export const ACADEMY_PREFLOP_TRAINER_SITUATION_LABELS: Readonly<Record<AcademyPreflopTrainerSituation, string>> =
  Object.freeze({
    RFI: "Первый вход",
    FACING_OPEN: "Против открытия",
    FACING_3BET: "Против 3-бета",
    FACING_4BET: "Против 4-бета",
    FACING_5BET: "Против 5-бета",
  });

/** Short hint for seats whose code is not self-explanatory to beginners. */
export const ACADEMY_PREFLOP_TRAINER_SEAT_HINTS: Readonly<Record<string, string>> = Object.freeze({
  BTN: "баттон",
  SB: "малый блайнд",
  BB: "большой блайнд",
});

function formatBb(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} BB`;
}

/**
 * "BB против BTN" / "BTN · первый вход" plus an action-history line, e.g.
 * - RFI:          "До тебя все сбросили — ты на BTN"
 * - facing open:  "BTN открыл — ты на BB"
 * - facing 3-bet: "Ты открыл с CO — BTN сделал 3-бет"
 * - facing 4-bet: "CO открыл — ты сделал 3-бет с BTN — CO сделал 4-бет"
 * - facing 5-bet: "Ты открыл с CO — BTN 3-бет — ты 4-бет — BTN сделал 5-бет"
 */
export function describePreflopTrainerSpot(
  spot: Pick<AcademyPreflopTrainerSpot, "situation" | "heroPosition" | "villainPosition">,
): AcademyPreflopTrainerSpotCopy {
  const hero = spot.heroPosition;
  const villain = spot.villainPosition ?? "";
  const situationLabel = ACADEMY_PREFLOP_TRAINER_SITUATION_LABELS[spot.situation];
  switch (spot.situation) {
    case "RFI":
      return { title: `${hero} · первый вход`, history: `До тебя все сбросили — ты на ${hero}`, situationLabel };
    case "FACING_OPEN":
      return { title: `${hero} против ${villain}`, history: `${villain} открыл — ты на ${hero}`, situationLabel };
    case "FACING_3BET":
      return { title: `${hero} против ${villain}`, history: `Ты открыл с ${hero} — ${villain} сделал 3-бет`, situationLabel };
    case "FACING_4BET":
      return {
        title: `${hero} против ${villain}`,
        history: `${villain} открыл — ты сделал 3-бет с ${hero} — ${villain} сделал 4-бет`,
        situationLabel,
      };
    case "FACING_5BET":
      return {
        title: `${hero} против ${villain}`,
        history: `Ты открыл с ${hero} — ${villain} 3-бет — ты 4-бет — ${villain} сделал 5-бет`,
        situationLabel,
      };
  }
}

const LEVEL_NAME: Readonly<Record<AcademyPreflopSizingStep["level"], string>> = {
  OPEN: "открыл",
  THREE_BET: "3-бет",
  FOUR_BET: "4-бет",
  FIVE_BET: "5-бет",
};

/** "открыл до 2.3 BB" / "сделал 3-бет до 9.2 BB" / "пошёл олл-ин 20 BB" (verbFull=false → "3-бет до 9.2 BB"). */
function stepPhrase(step: AcademyPreflopSizingStep, verbFull = true): string {
  if (step.allIn) return `пошёл олл-ин ${formatSizingBbLabel(step.totalBb)}`;
  const size = `до ${formatSizingBbLabel(step.totalBb)}`;
  if (step.level === "OPEN") return `открыл ${size}`;
  return `${verbFull ? "сделал " : ""}${LEVEL_NAME[step.level]} ${size}`;
}

/**
 * The spot's history line with the TRUSTED sizes of the earlier actions
 * (`steps` from `resolvePreflopHandState`), e.g.
 * - "BTN открыл до 2.3 BB — ты на BB"
 * - "Ты открыл до 2 BB с HJ — SB пошёл олл-ин 20 BB"
 * Without steps (no documented sizing) it is exactly the plain history.
 */
export function describePreflopTrainerSpotHistory(
  spot: Pick<AcademyPreflopTrainerSpot, "situation" | "heroPosition" | "villainPosition">,
  steps: readonly AcademyPreflopSizingStep[] | null,
): string {
  const plain = describePreflopTrainerSpot(spot).history;
  if (!steps || steps.length === 0) return plain;
  const hero = spot.heroPosition;
  const villain = spot.villainPosition ?? "";
  const [a, b, c, d] = steps;
  switch (spot.situation) {
    case "FACING_OPEN":
      return `${villain} ${stepPhrase(a)} — ты на ${hero}`;
    case "FACING_3BET":
      return `Ты ${stepPhrase(a)} с ${hero} — ${villain} ${stepPhrase(b)}`;
    case "FACING_4BET":
      return `${villain} ${stepPhrase(a)} — ты ${stepPhrase(b)} с ${hero} — ${villain} ${stepPhrase(c)}`;
    case "FACING_5BET":
      return `Ты ${stepPhrase(a)} с ${hero} — ${villain} ${stepPhrase(b, false)} — ты ${stepPhrase(c, false)} — ${villain} ${stepPhrase(d)}`;
    default:
      return plain;
  }
}

/** Name of the aggressive (RAISE-kind) action in each situation. */
const RAISE_NAME: Readonly<Record<AcademyPreflopTrainerSituation, { button: string; short: string; always: string }>> = {
  RFI: { button: "Рейз", short: "рейз", always: "всегда открываем рейзом" },
  FACING_OPEN: { button: "3-бет", short: "3-бет", always: "всегда делаем 3-бет" },
  FACING_3BET: { button: "4-бет", short: "4-бет", always: "всегда делаем 4-бет" },
  FACING_4BET: { button: "5-бет", short: "5-бет", always: "всегда делаем 5-бет" },
  FACING_5BET: { button: "Рейз", short: "рейз", always: "всегда рейзим" },
};

function copy(button: string, short: string, always: string): AcademyStrategyActionLocalizedCopy {
  return Object.freeze({ button, inline: short, short, always });
}

/**
 * Localized copy for one dataset action in a situation. Keyed by the
 * dataset's real codes (RAISE / ALL_IN / LIMP / CALL / FOLD) and falling back
 * to the generic kind; an unknown code keeps its canonical label.
 */
export function localizePreflopTrainerActionCopy(
  action: Pick<AcademySolverPublicAction, "code" | "kind" | "amountBb">,
  situation: AcademyPreflopTrainerSituation,
): AcademyStrategyActionLocalizedCopy | undefined {
  if (action.code === "LIMP") return copy("Лимп", "лимп", "всегда лимпим");
  switch (action.kind) {
    case "FOLD": return copy("Фолд", "фолд", "всегда сбрасываем");
    case "CHECK": return copy("Чек", "чек", "всегда чекаем");
    case "CALL": return copy("Колл", "колл", "всегда коллируем");
    case "ALL_IN": {
      const button = action.amountBb === undefined ? "Олл-ин" : `Олл-ин ${formatBb(action.amountBb)}`;
      return copy(button, "олл-ин", "всегда идём олл-ин");
    }
    case "RAISE":
    case "BET": {
      const name = action.kind === "BET" ? { button: "Бет", short: "бет", always: "всегда ставим" } : RAISE_NAME[situation];
      const button = action.amountBb === undefined ? name.button : `${name.button} ${formatBb(action.amountBb)}`;
      return copy(button, name.short, name.always);
    }
    default:
      return undefined;
  }
}

/** Public action with situation-aware Russian copy (dataset label/code/kind untouched). */
export function localizePreflopTrainerAction(
  action: AcademySolverPublicAction,
  situation: AcademyPreflopTrainerSituation,
): AcademySolverPublicAction {
  const ru = localizePreflopTrainerActionCopy(action, situation);
  return Object.freeze(ru ? { ...action, ru } : { ...action });
}

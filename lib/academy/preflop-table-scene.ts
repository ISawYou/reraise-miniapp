/**
 * Table scene of a configurable-trainer spot (client-safe, pure).
 *
 * The scene shows only what the node's OWN metadata (situation + hero +
 * villain) logically implies about the action before the decision. Every
 * trainer node is a heads-up decision between hero and villain, so:
 *
 * - RFI: every seat that acts before the hero folded; later seats are still
 *   to act (no label).
 * - FACING_OPEN: seats before the opener and between opener and hero folded;
 *   the opener (villain) made the opening raise; seats after the hero are
 *   still to act.
 * - FACING_3BET / FACING_4BET / FACING_5BET: action came back to the hero
 *   heads-up, so every seat other than hero and villain has folded. The
 *   villain's label is their last aggressive action; the hero's label is the
 *   hero's own previous aggressive action.
 *
 * The aggressive labels themselves ("Рейз" / "3-бет" / "Олл-ин" …) are
 * supplied by the caller from the REAL earlier nodes of the same dataset
 * (see `getPreflopTrainerSpotScene` in lib/academy/preflop-trainer.ts); when
 * one is not available the seat simply carries no label. Sizes are never
 * shown — the datasets do not reliably carry them for the earlier actions.
 */
import { localizePreflopTrainerActionCopy } from "@/lib/academy/preflop-trainer-copy";
import { ACADEMY_PREFLOP_TRAINER_SEAT_ORDER } from "@/lib/academy/preflop-trainer-selection";
import type {
  AcademyPreflopTableScene,
  AcademyPreflopTableSceneSeat,
  AcademyPreflopTrainerSpot,
} from "@/types/academy";

export type PreflopTablePriorActionLabels = {
  /** Villain's last (aggressive) action that created the hero's decision. */
  readonly villain?: string;
  /** Hero's own previous aggressive action (facing a 3-/4-/5-bet only). */
  readonly hero?: string;
};

/** "Фолд" — from the trainer's shared action copy, not a second string table. */
export const PREFLOP_TABLE_FOLD_LABEL = localizePreflopTrainerActionCopy({ code: "FOLD", kind: "FOLD" }, "RFI")!.button;

function seatIndex(seat: string): number {
  const index = (ACADEMY_PREFLOP_TRAINER_SEAT_ORDER as readonly string[]).indexOf(seat);
  if (index === -1) throw new Error(`Unknown trainer seat: ${seat}`);
  return index;
}

export function buildPreflopTableScene(
  spot: Pick<AcademyPreflopTrainerSpot, "situation" | "heroPosition" | "villainPosition">,
  labels: PreflopTablePriorActionLabels = {},
): AcademyPreflopTableScene {
  const hero = seatIndex(spot.heroPosition);
  const villain = spot.villainPosition === undefined ? -1 : seatIndex(spot.villainPosition);
  if ((spot.situation === "RFI") !== (villain === -1) || villain === hero) {
    throw new Error(`Inconsistent trainer spot seats: ${spot.situation} ${spot.heroPosition} vs ${spot.villainPosition}`);
  }
  if (spot.situation === "FACING_OPEN" && villain > hero) {
    throw new Error(`Opener must act before the hero: ${spot.villainPosition} → ${spot.heroPosition}`);
  }
  const headsUpRest = spot.situation !== "RFI" && spot.situation !== "FACING_OPEN";

  const seats = ACADEMY_PREFLOP_TRAINER_SEAT_ORDER.map((seat, index): AcademyPreflopTableSceneSeat => {
    if (index === hero) {
      return labels.hero && headsUpRest ? { seat, role: "hero", actionLabel: labels.hero } : { seat, role: "hero" };
    }
    if (index === villain) {
      return labels.villain ? { seat, role: "villain", actionLabel: labels.villain } : { seat, role: "villain" };
    }
    const folded = headsUpRest || index < hero;
    return folded ? { seat, role: "folded", actionLabel: PREFLOP_TABLE_FOLD_LABEL } : { seat, role: "waiting" };
  });

  return Object.freeze({
    heroSeat: spot.heroPosition,
    ...(spot.villainPosition !== undefined ? { villainSeat: spot.villainPosition } : {}),
    seats: Object.freeze(seats),
  });
}

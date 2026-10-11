/**
 * Table scene of a Push/Fold spot (client-safe, pure) — the same
 * `AcademyPreflopTableScene` shape the shared `PokerPositionTable`
 * TRAINING_SCENE mode renders for the MTT trainer, derived with the same
 * rule as `buildPreflopTableScene` (lib/academy/preflop-table-scene.ts): show
 * only what the node's OWN semantics logically imply.
 *
 * - FIRST_IN_SHOVE (hero): this is hero's first-in decision, so every seat
 *   that acts before hero folded ("Фолд"); later seats are still to act (no label).
 * - CALL_VS_SHOVE (hero vs villain): villain's first-in shove created the
 *   decision, so every seat before villain folded, villain went all-in
 *   (`shoveLabel`, "Олл-ин"), every seat between villain and hero folded;
 *   seats after hero are still to act (no label).
 *
 * No sizes, no other actions. The shove label is supplied by the caller from
 * the shover's REAL first-in node of the same dataset (see
 * `getPushFoldSpotScene`); without it the villain seat carries no label.
 */
import { PREFLOP_TABLE_FOLD_LABEL } from "@/lib/academy/preflop-table-scene";
import { ACADEMY_PUSH_FOLD_SEAT_ORDER } from "@/lib/academy/push-fold-selection";
import type {
  AcademyPreflopTableScene,
  AcademyPreflopTableSceneSeat,
  AcademyPushFoldSpot,
} from "@/types/academy";

function seatIndex(seat: string): number {
  const index = (ACADEMY_PUSH_FOLD_SEAT_ORDER as readonly string[]).indexOf(seat);
  if (index === -1) throw new Error(`Unknown Push/Fold seat: ${seat}`);
  return index;
}

export function buildPushFoldTableScene(
  spot: Pick<AcademyPushFoldSpot, "situation" | "heroPosition" | "villainPosition">,
  shoveLabel?: string,
): AcademyPreflopTableScene {
  const hero = seatIndex(spot.heroPosition);
  const villain = spot.villainPosition === undefined ? -1 : seatIndex(spot.villainPosition);
  if ((spot.situation === "FIRST_IN_SHOVE") !== (villain === -1)) {
    throw new Error(`Inconsistent Push/Fold spot seats: ${spot.situation} ${spot.heroPosition} vs ${spot.villainPosition}`);
  }
  if (villain !== -1 && villain >= hero) {
    throw new Error(`The shover must act before the hero: ${spot.villainPosition} → ${spot.heroPosition}`);
  }

  const seats = ACADEMY_PUSH_FOLD_SEAT_ORDER.map((seat, index): AcademyPreflopTableSceneSeat => {
    if (index === hero) return { seat, role: "hero" };
    if (index === villain) return shoveLabel ? { seat, role: "villain", actionLabel: shoveLabel } : { seat, role: "villain" };
    return index < hero
      ? { seat, role: "folded", actionLabel: PREFLOP_TABLE_FOLD_LABEL }
      : { seat, role: "waiting" };
  });

  return Object.freeze({
    heroSeat: spot.heroPosition,
    ...(spot.villainPosition !== undefined ? { villainSeat: spot.villainPosition } : {}),
    seats: Object.freeze(seats),
  });
}

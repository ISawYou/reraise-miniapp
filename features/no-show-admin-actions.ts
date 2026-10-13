"use server";

// Server Actions for the global "Неявки игроков" admin page
// (app/admin/no-shows/page.tsx). A Server Action bypasses middleware.ts's
// /api/admin/:path* matcher, so each action authorizes itself with the SAME
// staff guard as the tournament roster actions (lib/admin-auth.ts's
// assertServerActorRole, staff = admin|operator). A player can never reach
// either of these.
//
// Deliberately a separate, typed action -- NOT an overload of "Допустить в
// игру":
//   - "Допустить в игру"          = THIS tournament, player physically here
//                                   (features/tournament-roster-actions.ts);
//   - "Разрешить обычную запись"  = FUTURE registration policy only (below).
import { assertServerActorRole } from "@/lib/admin-auth";
import {
  clearPlayerOnlineRegistrationRestriction,
  listNoShowPlayerSummaries,
  type NoShowPlayerSummary,
} from "@/features/tournament-no-show";

export async function getAdminNoShowPlayers(): Promise<NoShowPlayerSummary[]> {
  await assertServerActorRole(["admin", "operator"]);
  return listNoShowPlayerSummaries();
}

export type AllowOrdinaryRegistrationResult =
  | { ok: true; cleared: boolean }
  | { ok: false; error: string };

// "Разрешить обычную запись": clears ONLY
// players.online_registration_restricted_at. No-show history
// (registrations.no_show_at), results and current-tournament quarantine are
// untouched -- see clearPlayerOnlineRegistrationRestriction.
export async function allowPlayerOrdinaryRegistration(
  playerId: string
): Promise<AllowOrdinaryRegistrationResult> {
  await assertServerActorRole(["admin", "operator"]);

  if (typeof playerId !== "string" || playerId.trim() === "") {
    return { ok: false, error: "Игрок не найден" };
  }

  const result = await clearPlayerOnlineRegistrationRestriction(playerId);
  return { ok: true, cleared: result.cleared };
}

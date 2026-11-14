"use server";

// Server Actions for the no-show waitlist policy, invoked directly from
// app/admin/tournaments/[id]/edit/page.tsx. A Server Action
// bypasses middleware.ts's /api/admin/:path* matcher, so each admin action
// authorizes itself with the SAME guard as every other tournament-admin
// mutation (lib/admin-auth.ts's assertServerActorRole, staff =
// admin|operator). A player can never reach any of these mutations.
//
// Every top-level export here is an async function (a "use server" file
// requirement). Expected business rejections are RETURNED as
// { ok: false, error } instead of thrown, so the exact Russian message
// reaches the admin UI in production builds.
import { assertServerActorRole } from "@/lib/admin-auth";
import {
  admitWaitlistedRegistrationWithinCapacity,
  markRegistrationNoShowWithinCapacity,
  TournamentRosterActionError,
} from "@/features/tournament-waitlist-capacity";

export type RosterActionResult =
  | { ok: true; promotedCount: number; warning?: string }
  | { ok: false; error: string };

function toRejection(error: unknown): { ok: false; error: string } {
  if (error instanceof TournamentRosterActionError) {
    return { ok: false, error: error.message };
  }
  throw error;
}

// "Не пришёл" -- see markRegistrationNoShowWithinCapacity for the exact
// atomic semantics. Distinct from removeAdminTournamentParticipant
// ("Удалить"), which stays a penalty-free technical correction.
//
// Postgres is authoritative and commits FIRST. Only then, best-effort, the
// operational roster is pushed to the linked Google Sheet so the no-show
// row disappears promptly (and a just-promoted player's row appears). A
// Sheets failure never rolls back the no-show; it is returned as a warning,
// and the periodic sheet reconciler removes the row on its next pass.
export async function markTournamentPlayerNoShow(
  tournamentId: string,
  registrationId: string
): Promise<RosterActionResult> {
  await assertServerActorRole(["admin", "operator"]);

  let promotedCount: number;
  try {
    const result = await markRegistrationNoShowWithinCapacity(tournamentId, registrationId);
    promotedCount = result.promoted.promotedPlayerIds.length;
  } catch (error) {
    return toRejection(error);
  }

  return { ok: true, promotedCount };
}

// "Допустить в игру" -- see admitWaitlistedRegistrationWithinCapacity
// (incl. the documented staff-override-vs-FIFO exception). After the
// Postgres admission commits, the linked Google Sheet is brought in line
// (Статус регистрации = registered, Пришел = TRUE). A sheet failure never
// undoes the admission; it is surfaced as a warning instead.
export async function admitTournamentPlayerFromWaitlist(
  tournamentId: string,
  registrationId: string
): Promise<RosterActionResult> {
  await assertServerActorRole(["admin", "operator"]);

  try {
    await admitWaitlistedRegistrationWithinCapacity(tournamentId, registrationId);
  } catch (error) {
    return toRejection(error);
  }

  return { ok: true, promotedCount: 0 };
}

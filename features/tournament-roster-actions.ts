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
import {
  syncAdmittedPlayerToSheet,
  syncOperationalRosterToSheet,
} from "@/features/tournament-sheet-sync";

export type RosterActionResult =
  | { ok: true; promotedCount: number; warning?: string }
  | { ok: false; error: string };

function toRejection(error: unknown): { ok: false; error: string } {
  if (error instanceof TournamentRosterActionError) {
    return { ok: false, error: error.message };
  }
  throw error;
}

const NO_SHOW_SHEET_WARNING =
  "Игрок отмечен как «Не пришёл», но Google Таблицу обновить не удалось — строка будет удалена при следующей синхронизации";

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

  try {
    await syncOperationalRosterToSheet(tournamentId);
  } catch (error) {
    console.error(
      "[markTournamentPlayerNoShow] Google Sheet cleanup failed (no-show kept):",
      error instanceof Error ? error.name : "unknown error"
    );
    return { ok: true, promotedCount, warning: NO_SHOW_SHEET_WARNING };
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

  let playerId: string;
  try {
    const result = await admitWaitlistedRegistrationWithinCapacity(tournamentId, registrationId);
    playerId = result.playerId;
  } catch (error) {
    return toRejection(error);
  }

  try {
    await syncAdmittedPlayerToSheet(tournamentId, playerId);
  } catch (error) {
    console.error(
      "[admitTournamentPlayerFromWaitlist] Google Sheet update failed (admission kept):",
      error instanceof Error ? error.name : "unknown error"
    );
    return {
      ok: true,
      promotedCount: 0,
      warning:
        "Игрок допущен, но Google Таблицу обновить не удалось — отметьте «Пришел» в таблице вручную",
    };
  }

  return { ok: true, promotedCount: 0 };
}

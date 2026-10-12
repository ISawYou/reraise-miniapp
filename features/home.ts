"use server";

import {
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  getVisibleOpenTournamentsForPlayer,
} from "@/features/tournaments";

// Home's critical, above-the-fold tournament state in ONE Server Action.
//
// Next.js dispatches client Server Action calls one at a time, so Home's
// former `Promise.all([getPlayerRegistrations(), getVisibleOpenTournaments…(),
// getTournamentRegistrationCounts()])` was really three back-to-back POST
// round trips (measured: ~430 ms of serialized action time at 100 ms RTT).
// Here the exact same three reads run in parallel on the server behind a
// single round trip. No new data, no new logic: each value is precisely what
// the corresponding existing action returns.
export async function getHomeTournamentSnapshot(player: {
  id: string;
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}) {
  const [registrations, tournaments, counts] = await Promise.all([
    getPlayerRegistrations(player.id),
    getVisibleOpenTournamentsForPlayer(player),
    getTournamentRegistrationCounts(),
  ]);
  return { registrations, tournaments, counts };
}

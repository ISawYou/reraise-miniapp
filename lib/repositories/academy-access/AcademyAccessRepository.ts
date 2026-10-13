/**
 * Read-only boundary for Academy eligibility: answers ONE question —
 * "did this (canonical) player actually take part in a game of this season?"
 * — from existing canonical facts. It never stores an entitlement, flag or
 * cache: access is re-derived on every read (features/academy-access.ts).
 *
 * Participation evidence (either is enough):
 * - (A) a `results` row of the player with `results.season_id = seasonId`,
 *   unless that row's frozen `results.arrived` snapshot is explicitly
 *   `false` (completion writes a row for every roster entry, so a no-show
 *   still in the roster gets a placed row with arrived=false; legacy rows
 *   written before the snapshot existed carry NULL and still count);
 * - (B) a live `tournament_attendance` row of the player with
 *   `arrived = true` on a tournament whose `tournaments.season_id = seasonId`
 *   (unlocks at the first real check-in, before completion; toggling it
 *   back to false removes this evidence on the next read).
 * Never: registration / waitlist / payment alone, a previous season, a
 * no-show, or `arrived = false`.
 */
export interface AcademyAccessRepository {
  hasPlayerParticipatedInSeason(playerId: string, seasonId: string): Promise<boolean>;
}

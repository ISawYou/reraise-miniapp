// Pure computation for the "max_tournament_streak" achievement metric:
// the longest run of consecutive completed club tournaments a player
// actually attended, out of ALL club tournaments in chronological order
// (not calendar weeks -- see docs/ACHIEVEMENT_SYSTEM.md). Missing a
// tournament breaks the current run but never erases an already-reached
// maximum -- this returns the max, not the current streak.
//
// Callers are responsible for producing `orderedTournamentIds` as a
// deterministic sequence (chronological, with a stable tie-breaker) and
// `attendedTournamentIds` from the single source of truth for
// participation: results.arrived = true (see
// ResultRepository.findArrivedTournamentIdsByPlayerId /
// features/achievements.ts) -- this function has no opinion on ordering or
// participation semantics, only on the streak arithmetic itself.
export function computeMaxTournamentStreak(
  orderedTournamentIds: readonly string[],
  attendedTournamentIds: ReadonlySet<string> | readonly string[]
): number {
  const attended =
    attendedTournamentIds instanceof Set
      ? attendedTournamentIds
      : new Set(attendedTournamentIds);

  let currentStreak = 0;
  let maxStreak = 0;

  for (const tournamentId of orderedTournamentIds) {
    if (attended.has(tournamentId)) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

// "Подписки" view of the current-season leaderboard: a client-side FILTER of
// the already computed official standings (GET /api/leaderboard) down to
// "me + the players I follow". Pure -- no rating logic lives here; nothing is
// recalculated, re-sorted or re-ranked.
//
// OFFICIAL RANK IS PRESERVED. The ranked rows arrive sorted and already
// partitioned (app/leaderboard/page.tsx renders the normal "Все" view from
// that very array, using array position + 1 as the place). The rank is
// therefore attached BEFORE filtering, so a player who is #7 in "Все" is #7
// here too -- never renumbered inside the followed subset. "Вне зачёта"
// players have no rank at all and stay rank-less.

export type RankedStanding<T> = {
  row: T;
  // The player's place in the normal current-season view (1-based).
  rank: number;
};

export type FollowingStandings<T> = {
  // Original order, official ranks (gaps are expected).
  ranked: RankedStanding<T>[];
  // "Вне зачёта" rows of the viewer / followed players, original order, no rank.
  outOfCompetition: T[];
};

export function filterFollowingStandings<T extends { player_id: string }>(
  rows: readonly T[],
  outOfCompetition: readonly T[],
  currentPlayerId: string | null,
  followingIds: ReadonlySet<string> | readonly string[]
): FollowingStandings<T> {
  const followed: ReadonlySet<string> = followingIds instanceof Set ? followingIds : new Set(followingIds);

  // The viewer is always part of their own "Подписки" view, whether or not
  // they follow themselves (they can't).
  const isIncluded = (playerId: string) =>
    (currentPlayerId !== null && playerId === currentPlayerId) || followed.has(playerId);

  return {
    // map FIRST (rank = position in the full official list), filter second.
    ranked: rows
      .map((row, index): RankedStanding<T> => ({ row, rank: index + 1 }))
      .filter(({ row }) => isIncluded(row.player_id)),
    outOfCompetition: outOfCompetition.filter((row) => isIncluded(row.player_id)),
  };
}

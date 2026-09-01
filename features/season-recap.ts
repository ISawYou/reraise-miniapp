import { resultRepository, seasonRepository } from "@/lib/repositories";
import { getOfficialSeasonLeaderboard } from "@/features/leaderboard";
import type { SeasonRecapResultRow } from "@/lib/repositories/result/ResultRepository";
import type { TournamentType } from "@/types/domain";

// Read-only, Super-Admin-only season report (see
// app/api/admin/seasons/[id]/recap/route.ts). Built EXCLUSIVELY from:
// - results whose PERSISTED season_id matches the requested season (never
//   reinterpreted by date -- see lib/season-resolver.ts's own doc comment
//   on why that distinction matters), and
// - only for tournaments whose status is 'completed'.
// Never recalculates rating_points, never writes anything, never touches
// season_rating_exclusions except by delegating official winner/finalists
// to the exact same getOfficialSeasonLeaderboard the archived rating
// screen uses -- not a second calculation.
//
// Deliberately excludes results.addons/results.free_reentries from every
// aggregate (see lib/db/schema/results.ts: both are honest 0 placeholders
// on pre-existing rows, not verified historical facts -- publishing a
// "record" built from them would misrepresent history).

export type SeasonRecapPlayer = { playerId: string; displayName: string };

// Every aggregate record supports ties -- see this module's `topBy` helper.
// value===0 is never a real accomplishment (e.g. "most Boss knockouts: 0"
// when nobody got one) -- meaningful:false signals the UI to say so
// instead of crowning an arbitrary/degenerate "winner".
export type SeasonRecapRecord = {
  value: number;
  leaders: SeasonRecapPlayer[];
  meaningful: boolean;
};

export type SeasonRecapSingleEventRecord = {
  value: number;
  leaders: Array<SeasonRecapPlayer & { tournamentId: string; tournamentTitle: string; startAt: string }>;
  meaningful: boolean;
};

export type SeasonRecapTournamentRecord = {
  value: number;
  tournaments: Array<{ tournamentId: string; tournamentTitle: string; startAt: string }>;
  meaningful: boolean;
};

export type SeasonRecap = {
  season: { id: string; title: string };
  summary: {
    completedTournaments: number;
    uniquePlayers: number;
    totalParticipations: number;
    totalReentries: number;
    totalRatingPointsAwarded: number;
    totalKnockouts: number;
    totalBossKnockouts: number;
    averageFieldSize: number;
    largestField: { tournamentId: string; tournamentTitle: string; startAt: string; playerCount: number } | null;
    tournamentTypeBreakdown: Record<TournamentType, number>;
  };
  official: {
    winner: (SeasonRecapPlayer & { rating: number; officialRank: 1 }) | null;
    finalists: Array<SeasonRecapPlayer & { rating: number; officialRank: number }>;
    pointsGapFirstToSecond: number | null;
    officialPlayersCount: number;
    outOfCompetitionPlayersCount: number;
  };
  records: {
    mostTournaments: SeasonRecapRecord;
    mostWins: SeasonRecapRecord;
    mostPodiums: SeasonRecapRecord;
    mostTopNine: SeasonRecapRecord;
    mostKnockouts: SeasonRecapRecord;
    mostBossKnockouts: SeasonRecapRecord;
    mostMysteryBounty: SeasonRecapRecord;
    bestSingleTournamentRating: SeasonRecapSingleEventRecord;
    mostKnockoutsSingleTournament: SeasonRecapSingleEventRecord;
    longestParticipationStreak: SeasonRecapRecord;
  };
  tournamentRecords: {
    largestField: SeasonRecapTournamentRecord;
    highestRatingPool: SeasonRecapTournamentRecord;
    highestKnockouts: SeasonRecapTournamentRecord;
    distinctFormatsPlayed: number;
  };
};

const TOURNAMENT_TYPES: TournamentType[] = [
  "classic",
  "phoenix",
  "deep_stack",
  "bounty",
  "boss_bounty",
  "win_the_button",
  "mystery_bounty",
];

function ruSort(a: string, b: string): number {
  return a.localeCompare(b, "ru");
}

// Generic tie-aware "who has the most of X" over a per-player aggregate
// map -- the ONE place that decides "0 is not a record" and that ties are
// never silently broken.
function topBy<T>(
  values: Iterable<T>,
  valueOf: (item: T) => number,
  toLeader: (item: T) => SeasonRecapPlayer
): SeasonRecapRecord {
  // Materialize once -- `values` is often a Map iterator (playerAgg.values()
  // etc.), which is single-use; iterating it twice (once for max, once to
  // filter) would silently return zero leaders on the second pass.
  const items = Array.from(values);
  let max = 0;
  for (const item of items) {
    const v = valueOf(item);
    if (v > max) max = v;
  }
  if (max === 0) {
    return { value: 0, leaders: [], meaningful: false };
  }
  const leaders = items
    .filter((item) => valueOf(item) === max)
    .map(toLeader)
    .sort((a, b) => ruSort(a.displayName, b.displayName));
  return { value: max, leaders, meaningful: true };
}

function topSingleEvent(
  rows: readonly SeasonRecapResultRow[],
  valueOf: (row: SeasonRecapResultRow) => number
): SeasonRecapSingleEventRecord {
  let max = 0;
  for (const row of rows) {
    const v = valueOf(row);
    if (v > max) max = v;
  }
  if (max === 0) {
    return { value: 0, leaders: [], meaningful: false };
  }
  const leaders = rows
    .filter((row) => valueOf(row) === max)
    .map((row) => ({
      playerId: row.player_id,
      displayName: row.display_name,
      tournamentId: row.tournament_id,
      tournamentTitle: row.tournament_title,
      startAt: row.tournament_start_at,
    }))
    .sort((a, b) => ruSort(a.displayName, b.displayName) || ruSort(a.tournamentTitle, b.tournamentTitle));
  return { value: max, leaders, meaningful: true };
}

type TournamentAgg = {
  tournamentId: string;
  tournamentTitle: string;
  startAt: string;
  playerCount: number;
  ratingPool: number;
  totalKnockouts: number;
};

function topTournament(
  tournaments: Iterable<TournamentAgg>,
  valueOf: (t: TournamentAgg) => number
): SeasonRecapTournamentRecord {
  // Same single-use-iterator caveat as topBy above.
  const items = Array.from(tournaments);
  let max = 0;
  for (const t of items) {
    const v = valueOf(t);
    if (v > max) max = v;
  }
  if (max === 0) {
    return { value: 0, tournaments: [], meaningful: false };
  }
  const tied = items
    .filter((t) => valueOf(t) === max)
    .map((t) => ({ tournamentId: t.tournamentId, tournamentTitle: t.tournamentTitle, startAt: t.startAt }))
    .sort((a, b) => ruSort(a.tournamentTitle, b.tournamentTitle));
  return { value: max, tournaments: tied, meaningful: true };
}

export async function getSeasonRecap(seasonId: string): Promise<SeasonRecap> {
  const [seasons, rows, official] = await Promise.all([
    seasonRepository.listAll(),
    resultRepository.findSeasonRecapRows(seasonId),
    getOfficialSeasonLeaderboard(seasonId),
  ]);

  const season = seasons.find((s) => s.id === seasonId);
  if (!season) {
    throw new Error(`Сезон "${seasonId}" не найден`);
  }

  // ---- per-player aggregates (one pass over the season's result rows) ----
  type PlayerAgg = {
    playerId: string;
    displayName: string;
    tournamentsPlayed: number;
    wins: number;
    podiums: number;
    topNineFinishes: number;
    knockouts: number;
    bossKnockouts: number;
    mysteryBountyPoints: number;
    playedTournamentIds: Set<string>;
  };
  const playerAgg = new Map<string, PlayerAgg>();
  const tournamentAgg = new Map<string, TournamentAgg>();
  const tournamentTypeByTournament = new Map<string, string>();

  for (const row of rows) {
    let player = playerAgg.get(row.player_id);
    if (!player) {
      player = {
        playerId: row.player_id,
        displayName: row.display_name,
        tournamentsPlayed: 0,
        wins: 0,
        podiums: 0,
        topNineFinishes: 0,
        knockouts: 0,
        bossKnockouts: 0,
        mysteryBountyPoints: 0,
        playedTournamentIds: new Set(),
      };
      playerAgg.set(row.player_id, player);
    }
    player.tournamentsPlayed += 1;
    if (row.place === 1) player.wins += 1;
    if (row.place <= 3) player.podiums += 1;
    if (row.place <= 9) player.topNineFinishes += 1;
    player.knockouts += row.knockouts;
    player.bossKnockouts += row.boss_knockouts;
    player.mysteryBountyPoints += row.mystery_bounty_points;
    player.playedTournamentIds.add(row.tournament_id);

    let tournament = tournamentAgg.get(row.tournament_id);
    if (!tournament) {
      tournament = {
        tournamentId: row.tournament_id,
        tournamentTitle: row.tournament_title,
        startAt: row.tournament_start_at,
        playerCount: 0,
        ratingPool: 0,
        totalKnockouts: 0,
      };
      tournamentAgg.set(row.tournament_id, tournament);
    }
    tournament.playerCount += 1;
    tournament.ratingPool += row.rating_points;
    tournament.totalKnockouts += row.knockouts;

    tournamentTypeByTournament.set(row.tournament_id, row.tournament_type);
  }

  // ---- longest consecutive participation streak ----
  const tournamentsChronological = Array.from(tournamentAgg.values()).sort((a, b) =>
    a.startAt.localeCompare(b.startAt)
  );
  function longestRun(playedIds: Set<string>): number {
    let max = 0;
    let current = 0;
    for (const t of tournamentsChronological) {
      if (playedIds.has(t.tournamentId)) {
        current += 1;
        max = Math.max(max, current);
      } else {
        current = 0;
      }
    }
    return max;
  }
  const streakByPlayer = new Map<string, number>();
  for (const player of playerAgg.values()) {
    streakByPlayer.set(player.playerId, longestRun(player.playedTournamentIds));
  }
  const longestParticipationStreak = topBy(
    streakByPlayer.entries(),
    ([, streak]) => streak,
    ([playerId]) => ({
      playerId,
      displayName: playerAgg.get(playerId)?.displayName ?? "Игрок",
    })
  );

  // ---- summary ----
  const completedTournaments = tournamentAgg.size;
  const totalParticipations = rows.length;
  const totalReentries = rows.reduce((sum, row) => sum + row.reentries, 0);
  const totalRatingPointsAwarded = rows.reduce((sum, row) => sum + row.rating_points, 0);
  const totalKnockouts = rows.reduce((sum, row) => sum + row.knockouts, 0);
  const totalBossKnockouts = rows.reduce((sum, row) => sum + row.boss_knockouts, 0);
  const averageFieldSize = completedTournaments > 0 ? totalParticipations / completedTournaments : 0;

  const tournamentTypeBreakdown = Object.fromEntries(
    TOURNAMENT_TYPES.map((type) => [type, 0])
  ) as Record<TournamentType, number>;
  for (const type of tournamentTypeByTournament.values()) {
    if ((TOURNAMENT_TYPES as string[]).includes(type)) {
      tournamentTypeBreakdown[type as TournamentType] += 1;
    }
  }

  const largestFieldRecord = topTournament(tournamentAgg.values(), (t) => t.playerCount);
  const highestRatingPoolRecord = topTournament(tournamentAgg.values(), (t) => t.ratingPool);
  const highestKnockoutsRecord = topTournament(tournamentAgg.values(), (t) => t.totalKnockouts);

  const largestField =
    largestFieldRecord.tournaments.length > 0
      ? {
          tournamentId: largestFieldRecord.tournaments[0].tournamentId,
          tournamentTitle: largestFieldRecord.tournaments[0].tournamentTitle,
          startAt: largestFieldRecord.tournaments[0].startAt,
          playerCount: largestFieldRecord.value,
        }
      : null;

  // ---- official winner/finalists -- reused as-is, never re-derived ----
  const winner = official.leaderboard[0]
    ? {
        playerId: official.leaderboard[0].player_id,
        displayName: official.leaderboard[0].display_name,
        rating: official.leaderboard[0].rating,
        officialRank: 1 as const,
      }
    : null;
  const finalists = official.leaderboard.slice(0, 9).map((entry) => ({
    playerId: entry.player_id,
    displayName: entry.display_name,
    rating: entry.rating,
    officialRank: entry.officialRank,
  }));
  const pointsGapFirstToSecond =
    official.leaderboard.length >= 2
      ? official.leaderboard[0].rating - official.leaderboard[1].rating
      : null;

  return {
    season: { id: season.id, title: season.title },
    summary: {
      completedTournaments,
      uniquePlayers: playerAgg.size,
      totalParticipations,
      totalReentries,
      totalRatingPointsAwarded,
      totalKnockouts,
      totalBossKnockouts,
      averageFieldSize,
      largestField,
      tournamentTypeBreakdown,
    },
    official: {
      winner,
      finalists,
      pointsGapFirstToSecond,
      officialPlayersCount: official.leaderboard.length,
      outOfCompetitionPlayersCount: official.outOfCompetition.length,
    },
    records: {
      mostTournaments: topBy(
        playerAgg.values(),
        (p) => p.tournamentsPlayed,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostWins: topBy(
        playerAgg.values(),
        (p) => p.wins,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostPodiums: topBy(
        playerAgg.values(),
        (p) => p.podiums,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostTopNine: topBy(
        playerAgg.values(),
        (p) => p.topNineFinishes,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostKnockouts: topBy(
        playerAgg.values(),
        (p) => p.knockouts,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostBossKnockouts: topBy(
        playerAgg.values(),
        (p) => p.bossKnockouts,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      mostMysteryBounty: topBy(
        playerAgg.values(),
        (p) => p.mysteryBountyPoints,
        (p) => ({ playerId: p.playerId, displayName: p.displayName })
      ),
      bestSingleTournamentRating: topSingleEvent(rows, (row) => row.rating_points),
      mostKnockoutsSingleTournament: topSingleEvent(rows, (row) => row.knockouts),
      longestParticipationStreak,
    },
    tournamentRecords: {
      largestField: largestFieldRecord,
      highestRatingPool: highestRatingPoolRecord,
      highestKnockouts: highestKnockoutsRecord,
      distinctFormatsPlayed: new Set(tournamentTypeByTournament.values()).size,
    },
  };
}

import {
  resultRepository,
  seasonRatingExclusionRepository,
  seasonRepository,
  tournamentRepository,
} from "@/lib/repositories";
import { resolvePlayerStanding } from "@/lib/leaderboard-display";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";

export type LeaderboardEntry = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
};

export type OfficialLeaderboardEntry = LeaderboardEntry & { officialRank: number };

export type OfficialSeasonLeaderboard = {
  // Eligible players only, ranked 1..N -- what "ТОП-9" / Number One /
  // official standings mean. Excluded ("Вне зачёта") players never consume
  // a rank number here, even though their rating_points are unchanged.
  leaderboard: OfficialLeaderboardEntry[];
  // Excluded players, same descending rating order, but deliberately
  // WITHOUT an official rank -- "убрать из рейтинга, но не убрать
  // рейтинг": their points stay visible/transparent, just outside
  // qualification.
  outOfCompetition: LeaderboardEntry[];
};

// Canonical leaderboard calculation for one season -- the single source of
// truth both app/api/leaderboard/route.ts (current/active season display)
// and features/seasons.ts::closeSeason (permanent Number One grant) read
// from. Extracted from the route unchanged (byte-identical SUM(rating_points)
// GROUP BY player_id, sorted descending) -- not a second formula, and the
// rating formula itself (Rating Engine v1/v2) is untouched.
//
// No deterministic tie-breaker for equal `rating` totals: neither
// PostgresResultRepository nor SupabaseResultRepository's
// findWithPlayerBySeasonId orders its rows, so the position of tied players
// in the returned array is not guaranteed stable across calls. Harmless for
// display (leaderboard.tsx just renders a list), but callers that need to
// pick a single winner (season finalization) MUST detect a tie at the rank
// that matters and refuse to guess -- see closeSeason.
// Shared by getSeasonLeaderboard/getAllTimeLeaderboard below AND
// getOfficialSeasonLeaderboardWithMovement's "previous" snapshot (a
// filtered subset of the exact same row shape) -- the ONE place that turns
// a list of result rows into per-player accumulated totals, so there is
// never a second accumulation rule to keep in sync.
function aggregateRatingByPlayer(
  rows: readonly {
    player_id: string;
    rating_points: number | null;
    username: string | null;
    display_name: string;
    telegram_avatar_url: string | null;
    custom_avatar_url: string | null;
  }[]
): LeaderboardEntry[] {
  const leaderboardMap = new Map<string, LeaderboardEntry>();

  for (const row of rows) {
    const existing = leaderboardMap.get(row.player_id);
    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: row.username,
        display_name: row.display_name,
        telegram_avatar_url: row.telegram_avatar_url,
        custom_avatar_url: row.custom_avatar_url,
        rating: row.rating_points ?? 0,
      });
    }
  }

  return Array.from(leaderboardMap.values()).sort((a, b) => b.rating - a.rating);
}

// Shared by getOfficialSeasonLeaderboard AND
// getOfficialSeasonLeaderboardWithMovement's "previous" snapshot -- the ONE
// "Вне зачёта" partition rule (raw descending order -> exclude ->
// sequential rank), so official rank always means the same thing whichever
// snapshot it's computed for.
function partitionOfficial(
  raw: readonly LeaderboardEntry[],
  excludedPlayerIds: ReadonlySet<string>
): OfficialSeasonLeaderboard {
  const leaderboard: OfficialLeaderboardEntry[] = [];
  const outOfCompetition: LeaderboardEntry[] = [];

  for (const entry of raw) {
    if (excludedPlayerIds.has(entry.player_id)) {
      outOfCompetition.push(entry);
    } else {
      leaderboard.push({ ...entry, officialRank: leaderboard.length + 1 });
    }
  }

  return { leaderboard, outOfCompetition };
}

export async function getSeasonLeaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
  const results = await resultRepository.findWithPlayerBySeasonId(seasonId);
  return aggregateRatingByPlayer(results);
}

// "Вне зачёта" applied ON TOP of the raw calculation above -- reuses
// getSeasonLeaderboard unchanged (one underlying accumulation, not a second
// rating formula) and only partitions the already-sorted result by
// season_rating_exclusions. This is the canonical entry point for anything
// that means "official season standing": the public leaderboard route AND
// season finalization (features/seasons.ts::closeSeason) both read from
// here, so TOP-9/Number One/pagination all agree on the exact same rule.
export async function getOfficialSeasonLeaderboard(seasonId: string): Promise<OfficialSeasonLeaderboard> {
  const [raw, exclusions] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    seasonRatingExclusionRepository.listBySeasonId(seasonId),
  ]);

  const excludedPlayerIds = new Set(exclusions.map((row) => row.player_id));

  return partitionOfficial(raw, excludedPlayerIds);
}

// Rank movement -- "how did this player's OFFICIAL current-season position
// change as a result of the most recent completed tournament in this same
// season". Purely derived/read-only presentation data: no rating is
// recalculated, nothing is written, and results.rating_points is read
// exactly as already persisted (see aggregateRatingByPlayer above -- the
// SAME accumulation rule, just fed a filtered row set for "previous").
export type RankMovement =
  | { type: "new" }
  | { type: "up"; places: number }
  | { type: "down"; places: number }
  | { type: "same" }
  // A player's exact current OR previous sequential rank is ambiguous
  // because they share the exact same rating total with another eligible
  // ranked player at that snapshot -- getOfficialSeasonLeaderboard's own
  // doc comment already documents that equal-rating ordering is not
  // guaranteed stable, so movement must never claim a fake ↑/↓ built on
  // that arbitrary order. Rendered as a neutral "—", same as "same".
  | { type: "unavailable" };

export type OfficialLeaderboardEntryWithMovement = OfficialLeaderboardEntry & {
  rankMovement: RankMovement;
};

export type OfficialSeasonLeaderboardWithMovement = {
  leaderboard: OfficialLeaderboardEntryWithMovement[];
  // Same OOC rows as getOfficialSeasonLeaderboard, deliberately WITHOUT a
  // rankMovement field at all -- "Вне зачёта" players never had an official
  // rank to move from/to (see this module's OfficialSeasonLeaderboard doc
  // comment), so there is nothing to attach.
  outOfCompetition: LeaderboardEntry[];
};

// Canonical tournament chronology: status === "completed", most recent
// start_at first -- the exact order tournamentRepository.listCompleted()
// already returns rows in (see PostgresTournamentRepository/
// SupabaseTournamentRepository). Re-sorted defensively here (start_at desc,
// tournament id desc as the deterministic tiebreak for two tournaments
// sharing the exact same start_at) rather than trusting array order alone,
// so "most recent" never depends on incidental DB/array ordering.
function pickMostRecentCompletedTournament<T extends { id: string; start_at: string }>(
  tournaments: readonly T[]
): T | null {
  if (tournaments.length === 0) return null;

  return [...tournaments].sort((a, b) => {
    if (a.start_at !== b.start_at) return a.start_at < b.start_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  })[0];
}

// Every rating value that at least two DIFFERENT ranked (non-OOC) players
// share at this snapshot -- see RankMovement's "unavailable" doc comment.
// OOC rows are irrelevant here: they never have a sequential rank to be
// ambiguous about.
function findAmbiguousRatings(leaderboard: readonly OfficialLeaderboardEntry[]): Set<number> {
  const counts = new Map<number, number>();
  for (const entry of leaderboard) {
    counts.set(entry.rating, (counts.get(entry.rating) ?? 0) + 1);
  }

  const ambiguous = new Set<number>();
  for (const [rating, count] of counts) {
    if (count > 1) ambiguous.add(rating);
  }
  return ambiguous;
}

// The CURRENT snapshot is exactly getOfficialSeasonLeaderboard(seasonId) --
// unchanged, not a second algorithm. The PREVIOUS snapshot reuses the exact
// same two building blocks (aggregateRatingByPlayer, partitionOfficial)
// against the same season's result rows, minus every row belonging to the
// most recent completed tournament (canonical chronology, see
// pickMostRecentCompletedTournament) -- never a recalculation from place/
// KO/entries/addons/Rating Engine v1 or v2, only re-aggregating the already
// frozen results.rating_points. "Вне зачёта" exclusions are the CURRENT
// exclusion list applied identically to both snapshots (there is no
// historical exclusion timeline to reconstruct -- see this module's Task E
// note in the PR description).
//
// One season-scoped query each for results/exclusions/tournaments -- never
// one query per player (see this function's own callers for the season-
// level cost, not O(players)).
export async function getOfficialSeasonLeaderboardWithMovement(
  seasonId: string
): Promise<OfficialSeasonLeaderboardWithMovement> {
  const [current, rows, exclusions, completedTournaments] = await Promise.all([
    getOfficialSeasonLeaderboard(seasonId),
    resultRepository.findWithPlayerBySeasonId(seasonId),
    seasonRatingExclusionRepository.listBySeasonId(seasonId),
    tournamentRepository.listCompleted(),
  ]);

  if (current.leaderboard.length === 0) {
    // Existing empty state, unchanged -- see LeaderboardBody's emptyMessage
    // in app/leaderboard/page.tsx. Nothing ranked yet, nothing to attach
    // movement to.
    return { leaderboard: [], outOfCompetition: current.outOfCompetition };
  }

  // tournamentRepository.listCompleted() already guarantees status ===
  // "completed" by its own contract -- the explicit re-check here is
  // defense-in-depth, not a trust issue with that method, so a draft/open/
  // closed tournament (or one from a different season) can never become
  // the comparison tournament even if that contract is ever violated
  // upstream. isRatingEligibleTournament excludes a completed Final Month
  // (is_final) -- it always persists rating_points=0 for every result, so
  // treating it as "the most recent tournament" would flatten every
  // player's movement to a meaningless "—"/"same" the moment it completes.
  // "Most recent" here means most recent RATING-relevant tournament, not
  // most recent completed tournament in general.
  const seasonCompleted = completedTournaments.filter(
    (t) => t.season_id === seasonId && t.status === "completed" && isRatingEligibleTournament(t)
  );
  const latest = pickMostRecentCompletedTournament(seasonCompleted);

  if (!latest) {
    // Defensive fallback only -- current.leaderboard is non-empty (checked
    // above), which in a consistent database means results.season_id rows
    // exist here, which in turn requires a completed tournament with this
    // season_id (see saveTournamentResults). If this branch is ever
    // reached anyway, there is no valid tournament to exclude for
    // "previous", so every ranked player is treated the same as the first
    // completed tournament of the season -- never a guessed ↑/↓.
    return {
      leaderboard: current.leaderboard.map((entry) => ({
        ...entry,
        rankMovement: { type: "new" as const },
      })),
      outOfCompetition: current.outOfCompetition,
    };
  }

  const excludedPlayerIds = new Set(exclusions.map((row) => row.player_id));
  const previousRows = rows.filter((row) => row.tournament_id !== latest.id);
  const previousRaw = aggregateRatingByPlayer(previousRows);
  const previousOfficial = partitionOfficial(previousRaw, excludedPlayerIds);

  const previousRankByPlayer = new Map(
    previousOfficial.leaderboard.map((entry) => [entry.player_id, entry.officialRank])
  );
  const previousRatingByPlayer = new Map(
    previousOfficial.leaderboard.map((entry) => [entry.player_id, entry.rating])
  );
  const ambiguousCurrentRatings = findAmbiguousRatings(current.leaderboard);
  const ambiguousPreviousRatings = findAmbiguousRatings(previousOfficial.leaderboard);

  const leaderboard = current.leaderboard.map((entry) => {
    const previousRank = previousRankByPlayer.get(entry.player_id) ?? null;
    const previousRating = previousRatingByPlayer.get(entry.player_id);

    const isAmbiguous =
      ambiguousCurrentRatings.has(entry.rating) ||
      (previousRating !== undefined && ambiguousPreviousRatings.has(previousRating));

    let rankMovement: RankMovement;
    if (isAmbiguous) {
      rankMovement = { type: "unavailable" };
    } else if (previousRank === null) {
      // No previous row at all for this player -- their only season rows
      // so far all belong to the just-excluded latest tournament (their
      // first tournament of the season, or the season's very first
      // completed tournament for everyone).
      rankMovement = { type: "new" };
    } else if (previousRank > entry.officialRank) {
      rankMovement = { type: "up", places: previousRank - entry.officialRank };
    } else if (previousRank < entry.officialRank) {
      rankMovement = { type: "down", places: entry.officialRank - previousRank };
    } else {
      rankMovement = { type: "same" };
    }

    return { ...entry, rankMovement };
  });

  return { leaderboard, outOfCompetition: current.outOfCompetition };
}

// All-time: cumulative RAW rating_points across every completed result ever
// recorded, regardless of season. Deliberately NOT season-filtered and
// deliberately NOT aware of season_rating_exclusions -- "Вне зачёта" is a
// season-specific official-standings exclusion (features/leaderboard.ts's
// getOfficialSeasonLeaderboard doc comment), not a historical erasure. A
// player excluded from one season's official ranks keeps every point they
// earned in this total. No second rating formula: this sums the exact same
// frozen result.rating_points the season leaderboards already sum, just
// without a season_id filter.
export async function getAllTimeLeaderboard(): Promise<LeaderboardEntry[]> {
  const results = await resultRepository.findAllTimeWithPlayer();

  const leaderboardMap = new Map<string, LeaderboardEntry>();

  for (const row of results) {
    const existing = leaderboardMap.get(row.player_id);
    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: row.username,
        display_name: row.display_name,
        telegram_avatar_url: row.telegram_avatar_url,
        custom_avatar_url: row.custom_avatar_url,
        rating: row.rating_points ?? 0,
      });
    }
  }

  return Array.from(leaderboardMap.values()).sort((a, b) => b.rating - a.rating);
}

// Player-safe rating summary for a profile view (own or someone else's) --
// current-season standing + all-time career total, in ONE call so a
// profile never has to download and re-derive rank from the full
// leaderboards itself. No PII beyond what the profile already shows, no
// season dates, no second rating formula: this reuses
// getOfficialSeasonLeaderboard / getAllTimeLeaderboard exactly as the
// leaderboard screen does and just extracts one player's row via the same
// canonical resolvePlayerStanding used there.
export type PlayerRatingSummary = {
  currentSeason: {
    id: string;
    title: string;
    points: number;
    rank: number | null;
    isOutOfCompetition: boolean;
  } | null; // null only if there is currently no active season at all
  allTime: {
    points: number;
    rank: number | null;
  };
};

export async function getPlayerRatingSummary(playerId: string): Promise<PlayerRatingSummary> {
  const [activeSeason, allTime] = await Promise.all([
    seasonRepository.findActive(),
    getAllTimeLeaderboard(),
  ]);

  const allTimeRanked = allTime.map((entry, index) => ({
    player_id: entry.player_id,
    officialRank: index + 1,
    rating: entry.rating,
  }));
  const allTimeStanding = resolvePlayerStanding(allTimeRanked, [], playerId);

  let currentSeason: PlayerRatingSummary["currentSeason"] = null;
  if (activeSeason) {
    const { leaderboard, outOfCompetition } = await getOfficialSeasonLeaderboard(activeSeason.id);
    const standing = resolvePlayerStanding(leaderboard, outOfCompetition, playerId);
    currentSeason = {
      id: activeSeason.id,
      title: activeSeason.title,
      points: standing.points,
      rank: standing.rank,
      isOutOfCompetition: standing.isOutOfCompetition,
    };
  }

  return {
    currentSeason,
    allTime: { points: allTimeStanding.points, rank: allTimeStanding.rank },
  };
}

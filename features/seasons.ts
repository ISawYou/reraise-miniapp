import { seasonRepository } from "@/lib/repositories";
import { getSeasonLeaderboard } from "@/features/leaderboard";
import { grantEventAutomaticAchievement } from "@/features/achievements";

const NUMBER_ONE_CODE = "number_one";

export type CloseSeasonResult =
  | {
      status: "closed";
      seasonId: string;
      winnerPlayerId: string;
      winnerRating: number;
    }
  | { status: "no_results"; seasonId: string }
  | { status: "tie"; seasonId: string; tiedPlayerIds: string[]; rating: number };

// Season finalization — an explicit, one-time, admin-triggered event (see
// app/api/admin/seasons/[id]/close/route.ts), NOT a cron job, NOT
// Date.now() > end_date, NOT tied to the ordinary achievement resync.
// "Season closed" in this codebase has no existing signal beyond
// `seasons.is_active` (seasons have no write path through the app at all
// today outside this function and the one-time backfill script's
// `create` — see SeasonRepository's module comment) -- this function IS
// that signal from now on: it flips `is_active` to false itself, once,
// as the last step of a successful finalization.
//
// Winner determination reuses the exact same canonical calculation the
// public leaderboard uses (features/leaderboard.ts::getSeasonLeaderboard)
// -- not a second formula, and the rating formula itself
// (features/rating.ts / features/rating-v2.ts) is untouched.
//
// Tie handling: getSeasonLeaderboard has no deterministic tie-breaker for
// equal totals (see its own doc comment -- neither ResultRepository
// implementation orders findWithPlayerBySeasonId). Picking an arbitrary
// winner from an unordered tie would be exactly the kind of heuristic
// substitution explicitly ruled out for this feature -- so a tie for rank
// 1 aborts with status: "tie" instead: nothing is granted, the season is
// NOT closed, and every tied player_id is reported so a human can decide.
export async function closeSeason(seasonId: string): Promise<CloseSeasonResult> {
  const seasons = await seasonRepository.listAll();
  const season = seasons.find((s) => s.id === seasonId);

  if (!season) {
    throw new Error(`Сезон "${seasonId}" не найден`);
  }

  // Finalization is a one-time event, not idempotently re-triggerable --
  // an already-closed season (is_active = false) refuses a second close
  // rather than silently recomputing (and potentially re-granting a
  // DIFFERENT winner if results were edited after the first closure,
  // which would contradict "permanent" -- upsertGrantedAchievement would
  // still preserve the ORIGINAL winner's completed_at, but a second
  // winner could newly receive the achievement, which is not "permanent,
  // decided once" semantics). Explicit re-opening (is_active back to
  // true) is not supported by this function -- that would be a deliberate
  // separate admin decision, not something to infer here.
  if (!season.is_active) {
    throw new Error(
      `Сезон "${season.title}" уже закрыт (is_active = false) — повторное закрытие запрещено`
    );
  }

  const leaderboard = await getSeasonLeaderboard(seasonId);

  if (leaderboard.length === 0) {
    // No results at all -- nothing to award, but still a legitimate
    // "close" (e.g. a season that never had a completed tournament).
    await seasonRepository.setActive(seasonId, false);
    return { status: "no_results", seasonId };
  }

  const [first, second] = leaderboard;

  if (second && second.rating === first.rating) {
    const tiedPlayerIds = leaderboard
      .filter((entry) => entry.rating === first.rating)
      .map((entry) => entry.player_id);

    return { status: "tie", seasonId, tiedPlayerIds, rating: first.rating };
  }

  // Grant BEFORE marking the season closed: if setActive then fails, the
  // season stays active and this whole function is safe to retry
  // (grantEventAutomaticAchievement is idempotent -- see
  // features/achievements.ts). Marking closed first, then failing the
  // grant, would leave a closed season with no recorded winner instead.
  await grantEventAutomaticAchievement(first.player_id, NUMBER_ONE_CODE);
  await seasonRepository.setActive(seasonId, false);

  return {
    status: "closed",
    seasonId,
    winnerPlayerId: first.player_id,
    winnerRating: first.rating,
  };
}

// Super-Admin-only management of "Вне зачёта" (season rating exclusions).
// Deliberately separate from features/leaderboard.ts, which stays the
// read-only calculation both the public leaderboard and season close read
// from -- this module is the only WRITE path for exclusions, and never
// infers exclusion from players.role or dealer_profiles (an explicit,
// per-player, per-season Super Admin decision every time).
import { playerRepository, seasonRatingExclusionRepository } from "@/lib/repositories";
import { getSeasonLeaderboard } from "@/features/leaderboard";

export type RatingEligibilityPlayerRow = {
  playerId: string;
  displayName: string;
  username: string | null;
  points: number;
  excluded: boolean;
  reason: string | null;
};

// Lists every player (not just those with results this season) so a
// business decision like "exclude the owner in advance" can be made before
// they've played a single tournament this season -- points default to 0
// for anyone absent from the raw leaderboard.
export async function listRatingEligibility(seasonId: string): Promise<RatingEligibilityPlayerRow[]> {
  const [players, raw, exclusions] = await Promise.all([
    playerRepository.listOrderedByCreatedAtDesc(),
    getSeasonLeaderboard(seasonId),
    seasonRatingExclusionRepository.listBySeasonId(seasonId),
  ]);

  const pointsByPlayerId = new Map(raw.map((entry) => [entry.player_id, entry.rating]));
  const exclusionByPlayerId = new Map(exclusions.map((row) => [row.player_id, row]));

  return players.map((player) => {
    const exclusion = exclusionByPlayerId.get(player.id);
    return {
      playerId: player.id,
      displayName: player.admin_display_name || player.display_name,
      username: player.username,
      points: pointsByPlayerId.get(player.id) ?? 0,
      excluded: exclusion !== undefined,
      reason: exclusion?.reason ?? null,
    };
  });
}

// actorPlayerId is the AUTHENTICATED caller's own id, resolved server-side
// by the route (never client-supplied) -- recorded only as admin-only
// metadata (created_by_player_id), never shown to players.
export async function setRatingEligibility(
  seasonId: string,
  playerId: string,
  excluded: boolean,
  reason: string | null,
  actorPlayerId: string
): Promise<void> {
  await playerRepository.findByIdOrThrow(playerId);

  if (excluded) {
    await seasonRatingExclusionRepository.create({
      season_id: seasonId,
      player_id: playerId,
      created_by_player_id: actorPlayerId,
      reason: reason?.trim() || null,
    });
  } else {
    await seasonRatingExclusionRepository.remove(seasonId, playerId);
  }
}

import "server-only";

import { getPersonalDealerSummary } from "@/features/dealers";
import { getPlayerAchievements } from "@/features/achievements";
import { getPlayerRatingSummary, type PlayerRatingSummary } from "@/features/leaderboard";
import { getMyTeamState, getPlayerActiveTeamSummary } from "@/features/teams";
import {
  getMyTournaments,
  getPlayedTournamentsCount,
  getPlayerTournamentHistory,
  getTournamentRegistrationCounts,
} from "@/features/tournaments";
import { getFeaturedAchievementKeys } from "@/features/featured-achievements";
import { resolveCanonicalPlayer } from "@/lib/canonical-player";
import { playerRepository, resultRepository } from "@/lib/repositories";
import type { Player, Tournament, TournamentResult } from "@/types/domain";

export type ProfileV2HistoryItem = {
  tournament: Tournament;
  result: TournamentResult;
};

export type ProfileV2Public = {
  id: string;
  display_name: string;
  username: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  team: Awaited<ReturnType<typeof getPlayerActiveTeamSummary>>;
  featured_achievement_keys: string[];
  achievements: Awaited<ReturnType<typeof getPlayerAchievements>>;
  rating: PlayerRatingSummary;
  tournaments_played: number;
  knockouts: number;
  recent_form: ProfileV2HistoryItem[];
};

export type ProfileV2Own = ProfileV2Public & {
  free_reentries_balance: number;
  email: string | null;
  nickname_status: Player["nickname_status"];
  pending_display_name: string | null;
  created_at: string;
  dealer: Awaited<ReturnType<typeof getPersonalDealerSummary>> | null;
  team_state: Awaited<ReturnType<typeof getMyTeamState>>;
  upcoming_tournaments: Awaited<ReturnType<typeof getMyTournaments>>;
  registration_counts: Record<string, number>;
};

export type ProfileV2Response = {
  mode: "own" | "public";
  profile: ProfileV2Public | ProfileV2Own;
};

function toPublicPlayer(player: Player) {
  return {
    id: player.id,
    display_name: player.display_name,
    username: player.username,
    telegram_avatar_url: player.telegram_avatar_url ?? null,
    custom_avatar_url: player.custom_avatar_url ?? null,
  };
}

export async function getProfileV2({
  targetPlayerId,
  viewerId,
}: {
  targetPlayerId: string;
  viewerId?: string | null;
}): Promise<ProfileV2Response> {
  const rawTarget = await playerRepository.findById(targetPlayerId);
  const target = await resolveCanonicalPlayer(rawTarget);
  if (!target) throw new Error("Игрок не найден");

  const isOwnProfile = viewerId != null && viewerId === target.id;
  const [rating, played, history, achievements, featuredKeys, team, knockouts] = await Promise.all([
    getPlayerRatingSummary(target.id),
    getPlayedTournamentsCount(target.id),
    getPlayerTournamentHistory(target.id, { limit: 6, offset: 0 }),
    getPlayerAchievements(target.id),
    getFeaturedAchievementKeys(target.id),
    getPlayerActiveTeamSummary(target.id),
    resultRepository.sumHistoryKnockoutsByPlayerId(target.id),
  ]);

  const base: ProfileV2Public = {
    ...toPublicPlayer(target),
    team,
    featured_achievement_keys: featuredKeys,
    achievements,
    rating,
    tournaments_played: played,
    knockouts,
    recent_form: history.slice(0, 6),
  };

  if (!isOwnProfile) {
    return { mode: "public", profile: base };
  }

  const [dealer, teamState, upcoming, registrationCounts] = await Promise.all([
    getPersonalDealerSummary(target.id).catch(() => null),
    getMyTeamState(target.id),
    getMyTournaments(target.id),
    getTournamentRegistrationCounts(),
  ]);

  return {
    mode: "own",
    profile: {
      ...base,
      free_reentries_balance: target.free_reentries_balance ?? 0,
      email: target.email ?? null,
      nickname_status: target.nickname_status,
      pending_display_name: target.pending_display_name ?? null,
      created_at: target.created_at,
      dealer,
      team_state: teamState,
      upcoming_tournaments: upcoming,
      registration_counts: registrationCounts,
    },
  };
}

export const PROFILE_RESULTS_PAGE_SIZE = 20;

export type ProfileResultsPage = {
  player: { id: string; display_name: string };
  items: ProfileV2HistoryItem[];
  next_offset: number | null;
};

export async function getProfileResults(targetPlayerId: string, offset = 0): Promise<ProfileResultsPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new Error("Некорректная страница");
  const player = await resolveCanonicalPlayer(await playerRepository.findById(targetPlayerId));
  if (!player) throw new Error("Игрок не найден");
  // Fetch one extra row to detect the next page, never the full history.
  const rows = await getPlayerTournamentHistory(player.id, { limit: PROFILE_RESULTS_PAGE_SIZE + 1, offset });
  return {
    player: { id: player.id, display_name: player.display_name },
    items: rows.slice(0, PROFILE_RESULTS_PAGE_SIZE),
    next_offset: rows.length > PROFILE_RESULTS_PAGE_SIZE ? offset + PROFILE_RESULTS_PAGE_SIZE : null,
  };
}

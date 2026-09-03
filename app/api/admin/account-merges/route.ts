import { NextResponse } from "next/server";
import { playerMergeIntentRepository, playerRepository } from "@/lib/repositories";
import { computeTournamentOverlap } from "@/lib/player-merge";
import type { Player } from "@/types/domain";

// Protected by middleware.ts's /api/admin/:path* matcher -- same dual
// header/cookie auth path as every other admin route, not re-implemented
// here. Deliberately absent from lib/admin-permissions.ts's operator
// allowlist -- account merges are Super-Admin-only, same as Sterling's
// equivalent route.
export async function GET() {
  try {
    const conflicts = await playerMergeIntentRepository.listConflicts();

    const details = await Promise.all(
      conflicts.map(async (intent) => {
        const [target, source, overlap] = await Promise.all([
          playerRepository.findById(intent.target_player_id),
          playerRepository.findById(intent.source_player_id),
          computeTournamentOverlap(intent.target_player_id, intent.source_player_id),
        ]);

        return {
          intent,
          target: target ? summarize(target) : null,
          source: source ? summarize(source) : null,
          overlappingTournamentIds: overlap.overlappingTournamentIds,
          sourceTournamentCount: overlap.sourceTournamentIds.size,
          targetTournamentCount: overlap.targetTournamentIds.size,
        };
      })
    );

    return NextResponse.json({ conflicts: details });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list merge conflicts" },
      { status: 500 }
    );
  }
}

// Full comparison payload per the admin-review checklist: identity, role,
// access flags, referrals/free-reentries, profile/terms/avatar/nickname
// state. Tournament-level detail (registrations/results/live entries/
// eliminations/attendance/rebuy state, achievements) is intentionally left
// to a future drill-down rather than inlined here -- this endpoint is the
// queue list, not the per-conflict detail view.
function summarize(player: Player) {
  return {
    id: player.id,
    telegram_id: player.telegram_id,
    email: player.email ?? null,
    display_name: player.display_name,
    username: player.username,
    role: player.role,
    can_access_free: player.can_access_free ?? true,
    can_access_paid: player.can_access_paid ?? false,
    can_access_cash: player.can_access_cash ?? false,
    referral_count: player.referral_count ?? 0,
    free_reentries_balance: player.free_reentries_balance ?? 0,
    yandex_review_bonus_claimed: player.yandex_review_bonus_claimed ?? false,
    accepted_terms_at: player.accepted_terms_at ?? null,
    profile_completed_at: player.profile_completed_at ?? null,
    nickname_status: player.nickname_status ?? null,
    telegram_avatar_url: player.telegram_avatar_url ?? null,
    custom_avatar_url: player.custom_avatar_url ?? null,
    merged_into_player_id: player.merged_into_player_id ?? null,
    created_at: player.created_at,
  };
}

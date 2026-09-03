"use client";

import Link from "next/link";
import {
  describeRankMovement,
  getPodiumOrder,
  type RankMovementDisplay,
} from "@/lib/leaderboard-display";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import type { RankMovement } from "@/features/leaderboard";

// Shared TOP-3 podium presentation -- the ONE implementation for both the
// full /leaderboard page (variant="full") and the Home "Рейтинг сезона"
// card (variant="compact"). Structural shape only: any row/player object
// with these fields works, whether it also carries `username` (the full
// leaderboard's LeaderboardRow) or not (Home's).
export type PodiumPlayer = {
  player_id: string;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
  // Current-mode leaderboard rows only -- see
  // features/leaderboard.ts::getOfficialSeasonLeaderboardWithMovement.
  // Always the server-computed value, never recalculated client-side.
  rankMovement?: RankMovement;
};

const RANK_MOVEMENT_TONE_CLASS: Record<RankMovementDisplay["tone"], string> = {
  up: "text-emerald-400",
  down: "text-red-400/80",
  same: "text-white/35",
  new: "text-[#f0d38a]",
};

// Compact "↑3 / ↓2 / — / NEW" badge -- secondary to rank/name/points, never
// rendered at all when there is nothing to show (OOC rows, archive/all-time
// mode). Same tone-to-color mapping everywhere it appears (RankRow, Podium,
// YourPositionCard in app/leaderboard/page.tsx, and Home's compact podium).
export function RankMovementBadge({ movement }: { movement: RankMovement | undefined }) {
  const display = describeRankMovement(movement);
  if (!display) return null;

  return (
    <span className={`text-[11px] font-semibold tabular-nums ${RANK_MOVEMENT_TONE_CLASS[display.tone]}`}>
      {display.label}
    </span>
  );
}

export function LeaderboardAvatar({ player, size }: { player: PodiumPlayer; size: number }) {
  const url = getPlayerAvatarUrl(player);
  const style = { width: size, height: size };
  if (url) {
    return (
      <img
        src={url}
        alt={player.display_name}
        style={style}
        className="shrink-0 rounded-full border border-white/10 object-cover"
      />
    );
  }
  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-semibold text-white/80"
    >
      {getPlayerAvatarFallback(player)}
    </div>
  );
}

export type PodiumVariant = "full" | "compact";

// Only sizing/spacing differs between variants -- structure (grid-cols-3,
// slot order, badge overlay, name/points/movement stack) is identical, so
// Home and /leaderboard can never visually diverge into two systems.
// "compact" is deliberately smaller across the board, not just the
// avatars, so the Home card stays short. Every size here is a literal
// pixel/rem value, not a viewport breakpoint -- the grid itself is
// width-driven (grid-cols-3 of the parent's own width), so both variants
// scale safely with the card's actual width instead of assuming any one
// screen size.
const VARIANT_CONFIG: Record<
  PodiumVariant,
  {
    gap: string;
    cardPadding: string;
    primaryAvatarSize: number;
    secondaryAvatarSize: number;
    badgeClass: string;
    namePrimaryClass: string;
    nameSecondaryClass: string;
    pointsPrimaryClass: string;
    pointsSecondaryClass: string;
  }
> = {
  full: {
    gap: "gap-2",
    cardPadding: "px-2 py-3.5",
    primaryAvatarSize: 68,
    secondaryAvatarSize: 56,
    badgeClass: "h-5 w-5 text-[11px]",
    namePrimaryClass: "mt-2.5 text-xs",
    nameSecondaryClass: "mt-2.5 text-xs",
    pointsPrimaryClass: "mt-1 text-lg",
    pointsSecondaryClass: "mt-1 text-sm",
  },
  compact: {
    gap: "gap-1.5",
    cardPadding: "px-1.5 py-2.5",
    primaryAvatarSize: 52,
    secondaryAvatarSize: 42,
    badgeClass: "h-4 w-4 text-[9px]",
    namePrimaryClass: "mt-1.5 text-[11px]",
    nameSecondaryClass: "mt-1.5 text-[11px]",
    pointsPrimaryClass: "mt-0.5 text-sm",
    pointsSecondaryClass: "mt-0.5 text-xs",
  },
};

// TOP-3 podium: #2 left, #1 center (strongest emphasis), #3 right -- see
// lib/leaderboard-display.ts::getPodiumOrder for the pure ordering logic
// this renders. Works with fewer than 3 entries (empty slots render
// nothing, never a placeholder for a nonexistent player) and with missing
// avatars (LeaderboardAvatar's own fallback).
export function Podium({
  topThree,
  currentPlayerId,
  variant = "full",
}: {
  topThree: readonly PodiumPlayer[];
  currentPlayerId: string | null;
  variant?: PodiumVariant;
}) {
  const [second, first, third] = getPodiumOrder(topThree);
  const slots: Array<{ player: PodiumPlayer | null; place: number; emphasis: "primary" | "secondary" }> = [
    { player: second, place: 2, emphasis: "secondary" },
    { player: first, place: 1, emphasis: "primary" },
    { player: third, place: 3, emphasis: "secondary" },
  ];

  if (slots.every((slot) => slot.player === null)) return null;

  const cfg = VARIANT_CONFIG[variant];
  const badgeTone = (place: number) =>
    place === 1
      ? "bg-[#f0d38a] text-black"
      : place === 2
        ? "bg-slate-200 text-black"
        : "bg-orange-300 text-black";

  return (
    <div className={`grid grid-cols-3 items-end ${cfg.gap}`}>
      {slots.map(({ player, place, emphasis }) => {
        if (!player) return <div key={place} />;
        const isPrimary = emphasis === "primary";
        const isCurrentPlayer = player.player_id === currentPlayerId;
        const avatarSize = isPrimary ? cfg.primaryAvatarSize : cfg.secondaryAvatarSize;
        return (
          <Link
            key={player.player_id}
            href={`/players/${player.player_id}`}
            className={`flex min-w-0 flex-col items-center rounded-2xl border ${cfg.cardPadding} text-center transition active:scale-[0.98] ${
              isPrimary
                ? "border-[#d7b55a]/35 bg-[linear-gradient(180deg,rgba(215,181,90,0.14),rgba(215,181,90,0.02))]"
                : "border-white/10 bg-white/[0.04]"
            } ${isCurrentPlayer ? "ring-1 ring-inset ring-[#d7b55a]/40" : ""}`}
          >
            <div className="relative">
              <LeaderboardAvatar player={player} size={avatarSize} />
              <span
                className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full font-bold ${cfg.badgeClass} ${badgeTone(place)}`}
              >
                {place}
              </span>
            </div>
            <p
              className={`w-full truncate font-semibold ${isPrimary ? cfg.namePrimaryClass : cfg.nameSecondaryClass} ${
                isPrimary ? "text-white" : "text-white/85"
              }`}
            >
              {player.display_name}
            </p>
            <p
              className={`font-bold tabular-nums ${
                isPrimary ? `${cfg.pointsPrimaryClass} text-[#f0d38a]` : `${cfg.pointsSecondaryClass} text-white/75`
              }`}
            >
              {player.rating}
            </p>
            {player.rankMovement ? (
              <div className="mt-0.5">
                <RankMovementBadge movement={player.rankMovement} />
              </div>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

"use client";

// Shared presentation pieces for the Teams v1 UI (Home block, /teams,
// /teams/[id], profile Team card) -- ONE place for the avatar rendering
// (reuses the existing lib/player-avatar.ts helpers unchanged, no new
// avatar-resolution logic) and the "official rank vs no rank yet" copy, so
// every surface agrees on the exact same wording and slot layout.
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";

export type PlayerSafeView = {
  player_id: string;
  display_name: string;
  username: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

export const MAX_TEAM_SLOTS = 5;

export function Avatar({
  player,
  className = "h-10 w-10",
}: {
  player: PlayerSafeView;
  className?: string;
}) {
  const url = getPlayerAvatarUrl({
    display_name: player.display_name,
    custom_avatar_url: player.custom_avatar_url,
    telegram_avatar_url: player.telegram_avatar_url,
  });
  if (url) {
    return (
      <img
        src={url}
        alt={player.display_name}
        className={`${className} shrink-0 rounded-full border border-white/10 object-cover`}
      />
    );
  }
  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80`}
    >
      {getPlayerAvatarFallback({ display_name: player.display_name })}
    </div>
  );
}

export type TeamIdentityLike = { emblem: string; avatar_url?: string | null };

// THE one shared way to render a team's visual identity -- a captain-
// uploaded photo (avatar_url) when present, else the emoji emblem exactly
// as before. Every existing emblem render site (leaderboard cards, "Моя
// команда", the team hero, the player-profile Team card, invitation/
// join-request compact rows, the Home top-3 block) must go through this
// component so none of them can drift out of sync with each other once a
// team sets/clears a photo. `className` controls sizing/font-size exactly
// like Avatar above -- callers pass the same size classes they used to put
// on their own emblem circle.
export function TeamIdentity({
  team,
  className = "h-10 w-10 text-lg",
}: {
  team: TeamIdentityLike;
  className?: string;
}) {
  if (team.avatar_url) {
    return (
      <img
        src={team.avatar_url}
        alt=""
        className={`${className} shrink-0 rounded-full border border-white/10 object-cover`}
      />
    );
  }
  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]`}
    >
      {team.emblem}
    </div>
  );
}

// A team only ever consumes an OFFICIAL ranking position once it has > 0
// points in the selected scope (see features/teams.ts::getTeamLeaderboard)
// -- these two helpers are the ONE place that turns `rank`/`points`/status
// into display copy, so the list, the hero, and "Моя команда" can never
// phrase a zero-point team differently from each other.

// Compact form for a list row's rank column -- "#2" or "—" (never "#1"
// for a team that hasn't scored yet).
export function formatRankBadge(rank: number | null): string {
  return rank == null ? "—" : `#${rank}`;
}

// Full line for a hero/summary card: "#2 в рейтинге · 820 очков",
// "Пока без рейтинга · 0 очков", or "Распущена" for a disbanded team
// (its historical points are still shown separately wherever that
// surface already renders `points`).
export function formatStandingLine(
  status: "active" | "disbanded",
  rank: number | null,
  points: number
): string {
  if (status === "disbanded") return "Распущена";
  if (rank == null) return `Пока без рейтинга · ${points} очков`;
  return `#${rank} в рейтинге · ${points} очков`;
}

type RosterSlotMember = PlayerSafeView & { is_captain?: boolean };

// Renders exactly MAX_TEAM_SLOTS (5) slots, always -- a squad's visual
// identity is "how full is this team", not just a member list. Filled
// slots show the member's avatar (captain gets a small crown marker);
// empty slots show a neutral dashed placeholder. If `onInviteSlotClick` is
// given, the FIRST empty slot becomes a "+ Пригласить" affordance instead
// (only ever passed by the caller for the current user's own team while
// they are captain and the team isn't already full -- this component
// itself has no authorization logic, it just renders what it's given).
export function RosterSlots({
  members,
  size = "h-10 w-10",
  onInviteSlotClick,
}: {
  members: readonly RosterSlotMember[];
  size?: string;
  onInviteSlotClick?: () => void;
}) {
  const slots: (RosterSlotMember | null)[] = Array.from(
    { length: MAX_TEAM_SLOTS },
    (_, i) => members[i] ?? null
  );
  let inviteSlotRendered = false;

  return (
    <div className="flex items-center gap-2" data-testid="roster-slots">
      {slots.map((member, index) => {
        if (member) {
          return (
            <div key={member.player_id} className="relative" data-testid="roster-slot" data-slot-state="filled">
              <Avatar player={member} className={size} />
              {member.is_captain ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 text-[11px] leading-none"
                >
                  👑
                </span>
              ) : null}
            </div>
          );
        }

        if (onInviteSlotClick && !inviteSlotRendered) {
          inviteSlotRendered = true;
          return (
            <button
              key="invite-slot"
              type="button"
              onClick={onInviteSlotClick}
              data-testid="roster-slot"
              data-slot-state="invite"
              className={`${size} flex shrink-0 flex-col items-center justify-center rounded-full border border-dashed border-[#d5b867]/50 text-[9px] font-medium leading-tight text-[#d5b867]`}
            >
              <span aria-hidden="true" className="text-sm leading-none">
                +
              </span>
              <span>Пригласить</span>
            </button>
          );
        }

        return (
          <div
            key={`empty-${index}`}
            data-testid="roster-slot"
            data-slot-state="empty"
            className={`${size} shrink-0 rounded-full border border-dashed border-white/15`}
          />
        );
      })}
    </div>
  );
}

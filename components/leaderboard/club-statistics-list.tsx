"use client";

import Link from "next/link";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";

export type ClubStatisticTopPlayer = {
  playerId: string;
  displayName: string;
  username: string | null;
  telegramAvatarUrl: string | null;
  customAvatarUrl: string | null;
  value: number;
  rank: number;
};

function RowAvatar({
  displayName,
  telegramAvatarUrl,
  customAvatarUrl,
  size,
}: {
  displayName: string;
  telegramAvatarUrl: string | null;
  customAvatarUrl: string | null;
  size: number;
}) {
  const source = { display_name: displayName, telegram_avatar_url: telegramAvatarUrl, custom_avatar_url: customAvatarUrl };
  const url = getPlayerAvatarUrl(source);
  const style = { width: size, height: size };

  if (url) {
    return (
      <img
        src={url}
        alt={displayName}
        style={style}
        className="shrink-0 rounded-full border border-white/10 object-cover"
      />
    );
  }

  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/80"
    >
      {getPlayerAvatarFallback(source)}
    </div>
  );
}

// Shared TOP-10 ranked-metric list -- reused identically by Rating ->
// Статистика (app/leaderboard/page.tsx) and achievement-detail "Лучшие
// результаты клуба" (app/players/[id]/achievements/page.tsx), same
// row/avatar/profile-navigation conventions as the rest of the leaderboard
// UI (see RankRow in app/leaderboard/page.tsx).
export function ClubStatisticsRankedList({
  topPlayers,
  currentPlayerId,
  emptyMessage = "Пока нет данных",
}: {
  topPlayers: readonly ClubStatisticTopPlayer[];
  currentPlayerId?: string | null;
  emptyMessage?: string;
}) {
  if (topPlayers.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
        <p className="text-sm text-white/60">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      {topPlayers.map((row) => {
        const isCurrentPlayer = row.playerId === currentPlayerId;
        return (
          <Link
            key={row.playerId}
            href={`/players/${row.playerId}`}
            className={`flex items-center gap-3 border-b border-white/5 px-3.5 py-3 last:border-b-0 sm:px-4 ${
              isCurrentPlayer ? "bg-[#d7b55a]/[0.08]" : ""
            }`}
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold tabular-nums text-white/55">
              {row.rank}
            </div>
            <RowAvatar
              displayName={row.displayName}
              telegramAvatarUrl={row.telegramAvatarUrl}
              customAvatarUrl={row.customAvatarUrl}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{row.displayName}</p>
              {isCurrentPlayer ? <p className="mt-0.5 text-xs text-[#f0d38a]">Это вы</p> : null}
            </div>
            <p
              className={`shrink-0 text-sm font-semibold tabular-nums ${
                isCurrentPlayer ? "text-[#f0d38a]" : "text-white/80"
              }`}
            >
              {row.value}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

export type AchievementHolder = {
  playerId: string;
  displayName: string;
  username: string | null;
  telegramAvatarUrl: string | null;
  customAvatarUrl: string | null;
  completedAt: string;
};

// Simple "Обладатели" ownership list for a MANUAL/event-based achievement
// (Royal Flush, Number One) -- no rank/value, since none exists for these.
export function AchievementHoldersList({
  holders,
  emptyMessage = "Пока нет обладателей",
}: {
  holders: readonly AchievementHolder[];
  emptyMessage?: string;
}) {
  if (holders.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
        <p className="text-sm text-white/60">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      {holders.map((holder) => (
        <Link
          key={holder.playerId}
          href={`/players/${holder.playerId}`}
          className="flex items-center gap-3 border-b border-white/5 px-3.5 py-3 last:border-b-0 sm:px-4"
        >
          <RowAvatar
            displayName={holder.displayName}
            telegramAvatarUrl={holder.telegramAvatarUrl}
            customAvatarUrl={holder.customAvatarUrl}
            size={36}
          />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{holder.displayName}</p>
        </Link>
      ))}
    </div>
  );
}

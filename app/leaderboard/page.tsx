"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { RatingIcon } from "@/components/icons/rating-icon";
import { useEffect, useState } from "react";
import {
  describeRankMovement,
  filterArchivableSeasons,
  getLeaderboardPlaceTone,
  getPodiumOrder,
  resolvePlayerStanding,
  type RankMovementDisplay,
} from "@/lib/leaderboard-display";
import { logEvent } from "@/lib/activity-client";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import type { RankMovement } from "@/features/leaderboard";

type LeaderboardRow = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
  // Current-mode leaderboard rows only -- see
  // features/leaderboard.ts::getOfficialSeasonLeaderboardWithMovement.
  // Absent for archive/all-time rows and for "Вне зачёта" rows -- callers
  // never render movement for either.
  rankMovement?: RankMovement;
};

// Compact "↑3 / ↓2 / — / NEW" badge -- secondary to rank/name/points,
// never rendered at all when there is nothing to show (OOC rows,
// archive/all-time mode). Same tone-to-color mapping everywhere it appears
// (RankRow, Podium, YourPositionCard).
function RankMovementBadge({ movement }: { movement: RankMovement | undefined }) {
  const display = describeRankMovement(movement);
  if (!display) return null;

  const toneClass: Record<RankMovementDisplay["tone"], string> = {
    up: "text-emerald-400",
    down: "text-red-400/80",
    same: "text-white/35",
    new: "text-[#f0d38a]",
  };

  return (
    <span className={`text-[11px] font-semibold tabular-nums ${toneClass[display.tone]}`}>
      {display.label}
    </span>
  );
}

type PublicSeason = { id: string; title: string; isActive: boolean };

type Mode = "current" | "archive" | "all-time";

const MODE_LABEL: Record<Mode, string> = {
  current: "Текущий",
  archive: "Архив",
  "all-time": "За всё время",
};

function Avatar({ row, size }: { row: LeaderboardRow; size: number }) {
  const url = getPlayerAvatarUrl(row);
  const style = { width: size, height: size };
  if (url) {
    return (
      <img
        src={url}
        alt={row.display_name}
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
      {getPlayerAvatarFallback(row)}
    </div>
  );
}

// TOP-3 podium: #2 left, #1 center (strongest emphasis), #3 right -- see
// lib/leaderboard-display.ts::getPodiumOrder for the pure ordering logic
// this renders. Works with fewer than 3 entries (empty slots render
// nothing, never a placeholder for a nonexistent player) and with missing
// avatars (Avatar's own fallback).
function Podium({ topThree, currentPlayerId }: { topThree: LeaderboardRow[]; currentPlayerId: string | null }) {
  const [second, first, third] = getPodiumOrder(topThree);
  const slots: Array<{ row: LeaderboardRow | null; place: number; emphasis: "primary" | "secondary" }> = [
    { row: second, place: 2, emphasis: "secondary" },
    { row: first, place: 1, emphasis: "primary" },
    { row: third, place: 3, emphasis: "secondary" },
  ];

  if (slots.every((slot) => slot.row === null)) return null;

  const badgeTone = (place: number) =>
    place === 1
      ? "bg-[#f0d38a] text-black"
      : place === 2
        ? "bg-slate-200 text-black"
        : "bg-orange-300 text-black";

  return (
    <div className="grid grid-cols-3 items-end gap-2">
      {slots.map(({ row, place, emphasis }) => {
        if (!row) return <div key={place} />;
        const isPrimary = emphasis === "primary";
        const isCurrentPlayer = row.player_id === currentPlayerId;
        const avatarSize = isPrimary ? 68 : 56;
        return (
          <Link
            key={row.player_id}
            href={`/players/${row.player_id}`}
            className={`flex min-w-0 flex-col items-center rounded-2xl border px-2 py-3.5 text-center transition active:scale-[0.98] ${
              isPrimary
                ? "border-[#d7b55a]/35 bg-[linear-gradient(180deg,rgba(215,181,90,0.14),rgba(215,181,90,0.02))]"
                : "border-white/10 bg-white/[0.04]"
            } ${isCurrentPlayer ? "ring-1 ring-inset ring-[#d7b55a]/40" : ""}`}
          >
            <div className="relative">
              <Avatar row={row} size={avatarSize} />
              <span
                className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${badgeTone(place)}`}
              >
                {place}
              </span>
            </div>
            <p
              className={`mt-2.5 w-full truncate text-xs font-semibold ${isPrimary ? "text-white" : "text-white/85"}`}
            >
              {row.display_name}
            </p>
            <p className={`mt-1 font-bold tabular-nums ${isPrimary ? "text-lg text-[#f0d38a]" : "text-sm text-white/75"}`}>
              {row.rating}
            </p>
            {row.rankMovement ? (
              <div className="mt-0.5">
                <RankMovementBadge movement={row.rankMovement} />
              </div>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function RankRow({
  row,
  rank,
  currentPlayerId,
  dimmed = false,
}: {
  row: LeaderboardRow;
  rank: number | null;
  currentPlayerId: string | null;
  dimmed?: boolean;
}) {
  const isCurrentPlayer = row.player_id === currentPlayerId;
  const tone = rank ? getLeaderboardPlaceTone(rank, isCurrentPlayer) : isCurrentPlayer ? "current" : "default";
  const rowClass = isCurrentPlayer
    ? "border-[#d7b55a]/35 bg-[#d7b55a]/[0.1]"
    : tone === "finalist"
      ? "border-[#8fa8ff]/15 bg-[#5968bd]/[0.08]"
      : "border-white/5";

  return (
    <Link
      href={`/players/${row.player_id}`}
      className={`flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0 sm:px-4 ${rowClass} ${dimmed ? "opacity-80" : ""}`}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold tabular-nums text-white/55">
        {rank ?? "—"}
      </div>
      <Avatar row={row} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{row.display_name}</p>
        {isCurrentPlayer ? <p className="mt-0.5 text-xs text-[#f0d38a]">Это вы</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold tabular-nums ${isCurrentPlayer ? "text-[#f0d38a]" : "text-white/80"}`}>
          {row.rating}
        </p>
        {row.rankMovement ? (
          <div className="mt-0.5">
            <RankMovementBadge movement={row.rankMovement} />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function YourPositionCard({
  standing,
  isAllTime = false,
  rankMovement,
}: {
  standing: { rank: number | null; points: number; isOutOfCompetition: boolean };
  isAllTime?: boolean;
  // Current mode only -- reuses the same movement already computed for
  // this player's leaderboard row (see LeaderboardPage below); never
  // recalculated here. Omitted entirely for archive/all-time, and for an
  // OOC player there is simply no row to have carried one.
  rankMovement?: RankMovement;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-[#d7b55a]/25 bg-[#d7b55a]/[0.06] px-4 py-3.5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">Ваша позиция</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-lg font-bold text-white">
            {standing.isOutOfCompetition ? "Вне зачёта" : standing.rank ? `#${standing.rank}` : "Пока без позиции"}
          </p>
          {!isAllTime && !standing.isOutOfCompetition ? (
            <RankMovementBadge movement={rankMovement} />
          ) : null}
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">
          {isAllTime ? "Очков за всё время" : "Очки"}
        </p>
        <p className="mt-1 text-lg font-bold text-[#f0d38a] tabular-nums">{standing.points}</p>
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
      <p className="text-sm text-white/60">{title}</p>
    </div>
  );
}

// Shared body -- TOP-3 podium, remaining ranked rows, OOC section, "Вне
// зачёта"/ТОП-9 meaning preserved -- reused identically by current,
// archive, and all-time modes so the ranking visual system never diverges
// per mode.
function LeaderboardBody({
  rows,
  outOfCompetition,
  currentPlayerId,
  showTopNine,
  emptyMessage,
}: {
  rows: LeaderboardRow[];
  outOfCompetition: LeaderboardRow[];
  currentPlayerId: string | null;
  showTopNine: boolean;
  emptyMessage: string;
}) {
  if (rows.length === 0 && outOfCompetition.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  const topThree = rows.slice(0, 3);
  const rest = rows.slice(3);
  const currentPlayerIsOOC = outOfCompetition.some((row) => row.player_id === currentPlayerId);

  return (
    <>
      {topThree.length > 0 ? <Podium topThree={topThree} currentPlayerId={currentPlayerId} /> : null}

      {showTopNine && rows.length > 0 ? (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#8fa8ff]/20 bg-[#667eea]/10 px-3 py-1.5 text-xs font-medium text-[#bdc9ff]">
          ТОП-9 → Финал месяца
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {rest.map((row, index) => (
            <RankRow key={row.player_id} row={row} rank={index + 4} currentPlayerId={currentPlayerId} />
          ))}
        </div>
      ) : null}

      {outOfCompetition.length > 0 ? (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/35">Вне зачёта</p>
          {currentPlayerIsOOC ? (
            <p className="mb-2 text-xs text-white/50">Вы участвуете вне зачёта этого сезона</p>
          ) : null}
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015]">
            {outOfCompetition.map((row) => (
              <RankRow key={row.player_id} row={row} rank={null} currentPlayerId={currentPlayerId} dimmed />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function LeaderboardPage() {
  const [mode, setMode] = useState<Mode>("current");
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);

  const [seasonTitle, setSeasonTitle] = useState("");
  const [currentRows, setCurrentRows] = useState<LeaderboardRow[]>([]);
  const [currentOOC, setCurrentOOC] = useState<LeaderboardRow[]>([]);
  const [currentLoading, setCurrentLoading] = useState(true);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const [archiveSeasons, setArchiveSeasons] = useState<PublicSeason[] | null>(null);
  const [archiveSeasonsLoading, setArchiveSeasonsLoading] = useState(false);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [archiveTitle, setArchiveTitle] = useState("");
  const [archiveRows, setArchiveRows] = useState<LeaderboardRow[]>([]);
  const [archiveOOC, setArchiveOOC] = useState<LeaderboardRow[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [allTimeRows, setAllTimeRows] = useState<LeaderboardRow[]>([]);
  const [allTimeLoading, setAllTimeLoading] = useState(false);
  const [allTimeError, setAllTimeError] = useState<string | null>(null);
  const [allTimeLoaded, setAllTimeLoaded] = useState(false);

  useEffect(() => {
    logEvent("rating_opened");
    resolveCurrentPlayer()
      .then((p) => setCurrentPlayerId(p.id))
      .catch(() => setCurrentPlayerId(null));
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/leaderboard");
        if (!response.ok) throw new Error("Ошибка загрузки рейтинга");
        const data = (await response.json()) as {
          season: { id: string; title: string };
          leaderboard: LeaderboardRow[];
          outOfCompetition?: LeaderboardRow[];
        };
        setSeasonTitle(data.season?.title?.trim() || "Активный сезон");
        setCurrentRows(data.leaderboard ?? []);
        setCurrentOOC(data.outOfCompetition ?? []);
      } catch (err) {
        setCurrentError(err instanceof Error ? err.message : "Ошибка загрузки рейтинга");
      } finally {
        setCurrentLoading(false);
      }
    }
    load();
  }, []);

  // Archive season list -- loaded once, lazily, the first time the mode is
  // opened. Non-active seasons only: the currently active season is
  // "Текущий", never an archive option.
  useEffect(() => {
    if (mode !== "archive" || archiveSeasons !== null || archiveSeasonsLoading) return;
    async function load() {
      setArchiveSeasonsLoading(true);
      try {
        const response = await fetch("/api/leaderboard/seasons");
        if (!response.ok) throw new Error("Ошибка загрузки сезонов");
        const data = (await response.json()) as { seasons: PublicSeason[] };
        const nonActive = filterArchivableSeasons(data.seasons ?? []);
        setArchiveSeasons(nonActive);
        if (nonActive.length > 0) setSelectedArchiveId(nonActive[0].id);
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : "Ошибка загрузки сезонов");
        setArchiveSeasons([]);
      } finally {
        setArchiveSeasonsLoading(false);
      }
    }
    load();
  }, [mode, archiveSeasons, archiveSeasonsLoading]);

  useEffect(() => {
    if (!selectedArchiveId) return;
    async function load() {
      setArchiveLoading(true);
      setArchiveError(null);
      try {
        const response = await fetch(`/api/leaderboard/archive/${selectedArchiveId}`);
        if (!response.ok) throw new Error("Ошибка загрузки архивного сезона");
        const data = (await response.json()) as {
          season: { id: string; title: string };
          leaderboard: LeaderboardRow[];
          outOfCompetition?: LeaderboardRow[];
        };
        setArchiveTitle(data.season?.title?.trim() || "Сезон");
        setArchiveRows(data.leaderboard ?? []);
        setArchiveOOC(data.outOfCompetition ?? []);
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : "Ошибка загрузки архивного сезона");
      } finally {
        setArchiveLoading(false);
      }
    }
    load();
  }, [selectedArchiveId]);

  useEffect(() => {
    if (mode !== "all-time" || allTimeLoaded || allTimeLoading) return;
    async function load() {
      setAllTimeLoading(true);
      try {
        const response = await fetch("/api/leaderboard/all-time");
        if (!response.ok) throw new Error("Ошибка загрузки рейтинга за всё время");
        const data = (await response.json()) as { leaderboard: LeaderboardRow[] };
        setAllTimeRows(data.leaderboard ?? []);
        setAllTimeLoaded(true);
      } catch (err) {
        setAllTimeError(err instanceof Error ? err.message : "Ошибка загрузки рейтинга за всё время");
      } finally {
        setAllTimeLoading(false);
      }
    }
    load();
  }, [mode, allTimeLoaded, allTimeLoading]);

  const currentStanding = resolvePlayerStanding(
    currentRows.map((row, index) => ({ player_id: row.player_id, officialRank: index + 1, rating: row.rating })),
    currentOOC,
    currentPlayerId
  );
  const archiveStanding = resolvePlayerStanding(
    archiveRows.map((row, index) => ({ player_id: row.player_id, officialRank: index + 1, rating: row.rating })),
    archiveOOC,
    currentPlayerId
  );
  const allTimeStanding = resolvePlayerStanding(
    allTimeRows.map((row, index) => ({ player_id: row.player_id, officialRank: index + 1, rating: row.rating })),
    [],
    currentPlayerId
  );
  // Same movement the API already computed for this exact row -- never
  // recalculated client-side (task: reuse the same movement data already
  // returned for leaderboard rows). Undefined for an OOC/unranked player,
  // same as any other row without a rankMovement field.
  const currentPlayerRankMovement = currentRows.find(
    (row) => row.player_id === currentPlayerId
  )?.rankMovement;

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href="/" className="mb-4" />

        <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d7b55a]/25 bg-[#d7b55a]/10 text-[#f0d38a]">
              <RatingIcon className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold">Рейтинг</h1>
          </div>

          <Link
            href="/faq?tab=rating-rules"
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55"
          >
            Регламент
          </Link>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {(Object.keys(MODE_LABEL) as Mode[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`rounded-full py-2 text-xs font-semibold transition ${
                mode === key ? "bg-[#d7b55a] text-black" : "text-white/60"
              }`}
            >
              {MODE_LABEL[key]}
            </button>
          ))}
        </div>

        {mode === "current" ? (
          <>
            <p className="mb-3 text-sm font-medium text-white/70">{currentLoading ? "Загружаем..." : seasonTitle}</p>
            {currentError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{currentError}</div>
            ) : currentLoading ? (
              <p className="text-sm text-white/60">Загружаем рейтинг...</p>
            ) : (
              <>
                <LeaderboardBody
                  rows={currentRows}
                  outOfCompetition={currentOOC}
                  currentPlayerId={currentPlayerId}
                  showTopNine
                  emptyMessage="Рейтинг сезона начнётся после первого завершённого турнира"
                />
                {currentPlayerId ? (
                  <YourPositionCard standing={currentStanding} rankMovement={currentPlayerRankMovement} />
                ) : null}
              </>
            )}
          </>
        ) : null}

        {mode === "archive" ? (
          <>
            {archiveSeasonsLoading || archiveSeasons === null ? (
              <p className="text-sm text-white/60">Загружаем сезоны...</p>
            ) : archiveSeasons.length === 0 ? (
              <EmptyState title="Архивных сезонов пока нет" />
            ) : (
              <>
                {archiveSeasons.length > 1 ? (
                  <select
                    value={selectedArchiveId ?? ""}
                    onChange={(e) => setSelectedArchiveId(e.target.value)}
                    className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none"
                  >
                    {archiveSeasons.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mb-3 text-sm font-medium text-white/70">{archiveTitle || archiveSeasons[0].title}</p>
                )}

                {archiveError ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{archiveError}</div>
                ) : archiveLoading ? (
                  <p className="text-sm text-white/60">Загружаем архив...</p>
                ) : (
                  <>
                    <LeaderboardBody
                      rows={archiveRows}
                      outOfCompetition={archiveOOC}
                      currentPlayerId={currentPlayerId}
                      showTopNine
                      emptyMessage="В этом сезоне нет данных рейтинга"
                    />
                    {currentPlayerId ? <YourPositionCard standing={archiveStanding} /> : null}
                  </>
                )}
              </>
            )}
          </>
        ) : null}

        {mode === "all-time" ? (
          <>
            {allTimeError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{allTimeError}</div>
            ) : allTimeLoading && !allTimeLoaded ? (
              <p className="text-sm text-white/60">Загружаем рейтинг за всё время...</p>
            ) : (
              <>
                <LeaderboardBody
                  rows={allTimeRows}
                  outOfCompetition={[]}
                  currentPlayerId={currentPlayerId}
                  showTopNine={false}
                  emptyMessage="Пока нет турниров с рейтинговыми очками"
                />
                {currentPlayerId ? <YourPositionCard standing={allTimeStanding} isAllTime /> : null}
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}

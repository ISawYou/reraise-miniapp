"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { RatingIcon } from "@/components/icons/rating-icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getLeaderboardPlaceTone,
  resolvePlayerStanding,
} from "@/lib/leaderboard-display";
import { logEvent } from "@/lib/activity-client";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchFollowingIds } from "@/lib/follows-client";
import { filterFollowingStandings } from "@/lib/leaderboard-following";
import { LeaderboardAvatar, Podium, RankMovementBadge } from "@/components/leaderboard/podium";
import { ClubStatisticsRankedList, type ClubStatisticTopPlayer } from "@/components/leaderboard/club-statistics-list";
import { CLUB_STATISTIC_METRIC, type ClubStatisticMetric } from "@/lib/club-statistics-metrics";
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
  // Absent for all-time rows and for "Вне зачёта" rows -- callers never
  // render movement for either.
  rankMovement?: RankMovement;
};

// Archive was removed from this player-facing screen only (RELEASE C1) --
// the season backend (/api/leaderboard/seasons, /api/leaderboard/archive/
// [seasonId]) and admin season management are untouched and still fully
// functional; nothing else in the app was found to depend on the player
// Archive tab specifically.
type Mode = "current" | "all-time" | "statistics";

const MODE_LABEL: Record<Mode, string> = {
  current: "Текущий сезон",
  "all-time": "Всё время",
  statistics: "Статистика",
};

// Selector order/labels exactly as specified for RELEASE C1 -- Streak and
// Bubble Boy are intentionally not in CLUB_STATISTIC_METRIC yet, so they
// cannot appear here either.
const STATISTIC_METRIC_OPTIONS: { metric: ClubStatisticMetric; label: string }[] = [
  { metric: CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED, label: "Турниры" },
  { metric: CLUB_STATISTIC_METRIC.WINS, label: "Победы" },
  { metric: CLUB_STATISTIC_METRIC.LIFETIME_RATING, label: "Рейтинг за всё время" },
  { metric: CLUB_STATISTIC_METRIC.ITM, label: "ITM" },
  { metric: CLUB_STATISTIC_METRIC.REFERRALS, label: "Друзья" },
  { metric: CLUB_STATISTIC_METRIC.KNOCKOUTS, label: "Нокауты" },
  { metric: CLUB_STATISTIC_METRIC.BOSS_KNOCKOUTS, label: "Boss KO" },
  { metric: CLUB_STATISTIC_METRIC.HEADHUNTER, label: "Лучший результат KO" },
];

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
      <LeaderboardAvatar player={row} size={36} />
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
  // recalculated here. Omitted entirely for all-time, and for an OOC
  // player there is simply no row to have carried one.
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

// "Вне зачёта" block -- shared by the full season view (LeaderboardBody) and
// the "Подписки" view, so both show out-of-competition players identically:
// dimmed rows, never a rank number.
function OutOfCompetitionSection({
  rows,
  currentPlayerId,
}: {
  rows: LeaderboardRow[];
  currentPlayerId: string | null;
}) {
  if (rows.length === 0) return null;

  const currentPlayerIsOOC = rows.some((row) => row.player_id === currentPlayerId);

  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/35">Вне зачёта</p>
      {currentPlayerIsOOC ? (
        <p className="mb-2 text-xs text-white/50">Вы участвуете вне зачёта этого сезона</p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015]">
        {rows.map((row) => (
          <RankRow key={row.player_id} row={row} rank={null} currentPlayerId={currentPlayerId} dimmed />
        ))}
      </div>
    </div>
  );
}

// Shared body -- TOP-3 podium, remaining ranked rows, OOC section, "Вне
// зачёта"/ТОП-9 meaning preserved -- reused identically by current and
// all-time modes so the ranking visual system never diverges per mode.
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
  return (
    <>
      {topThree.length > 0 ? (
        <Podium topThree={topThree} currentPlayerId={currentPlayerId} variant="full" />
      ) : null}

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

      <OutOfCompetitionSection rows={outOfCompetition} currentPlayerId={currentPlayerId} />
    </>
  );
}

// "Подписки" body (current season): the viewer + the players they follow, as
// a FLAT list. It is deliberately not a mini leaderboard -- no podium, no
// gold/silver/bronze, no "ТОП-9" chip: every row carries its TRUE official
// season rank (gaps like #2, #7 are expected), and "Вне зачёта" players stay
// rank-less. "Ваша позиция" is never recomputed for the subset; it is the
// normal global card, shown only when the viewer's own row is NOT already in
// this list (otherwise it would just repeat that row).
function FollowingView({
  rows,
  outOfCompetition,
  currentPlayerId,
  playerResolved,
  followingIds,
  error,
  onRetry,
  standing,
  rankMovement,
}: {
  rows: LeaderboardRow[];
  outOfCompetition: LeaderboardRow[];
  currentPlayerId: string | null;
  // false until resolveCurrentPlayer() has settled -- "not known yet" must
  // never be mistaken for "anonymous".
  playerResolved: boolean;
  followingIds: ReadonlySet<string> | null;
  error: string | null;
  onRetry: () => void;
  standing: { rank: number | null; points: number; isOutOfCompetition: boolean };
  rankMovement?: RankMovement;
}) {
  let body: ReactNode;
  let showYourPosition = false;

  if (!playerResolved) {
    body = <p className="text-sm text-white/60">Загружаем...</p>;
  } else if (!currentPlayerId) {
    // Signed out: nobody to look up, and nothing to log in for -- just the
    // empty state, no request was made.
    body = <EmptyState title="Вы пока ни на кого не подписаны" />;
  } else if (error) {
    body = (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        <p>{error}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-red-100 underline">
          Повторить
        </button>
      </div>
    );
  } else if (!followingIds) {
    body = <p className="text-sm text-white/60">Загружаем...</p>;
  } else if (followingIds.size === 0) {
    body = <EmptyState title="Вы пока ни на кого не подписаны" />;
    showYourPosition = true;
  } else {
    const filtered = filterFollowingStandings(rows, outOfCompetition, currentPlayerId, followingIds);
    if (filtered.ranked.length === 0 && filtered.outOfCompetition.length === 0) {
      body = <EmptyState title="У ваших подписок пока нет результатов в этом сезоне" />;
      showYourPosition = true;
    } else {
      const viewerListed =
        filtered.ranked.some(({ row }) => row.player_id === currentPlayerId) ||
        filtered.outOfCompetition.some((row) => row.player_id === currentPlayerId);
      showYourPosition = !viewerListed;
      // The viewer's own row always counts as "listed"; if it is the ONLY one,
      // none of the followed players has a season result. Keep the row (true
      // official rank) and say so, instead of leaving a lone row unexplained.
      const followedWithResults =
        filtered.ranked.filter(({ row }) => row.player_id !== currentPlayerId).length +
        filtered.outOfCompetition.filter((row) => row.player_id !== currentPlayerId).length;
      body = (
        <>
          {filtered.ranked.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {filtered.ranked.map(({ row, rank }) => (
                <RankRow key={row.player_id} row={row} rank={rank} currentPlayerId={currentPlayerId} />
              ))}
            </div>
          ) : null}
          <OutOfCompetitionSection rows={filtered.outOfCompetition} currentPlayerId={currentPlayerId} />
          {followedWithResults === 0 ? (
            <p className="mt-3 text-center text-sm text-white/60" data-testid="following-no-results">
              У ваших подписок пока нет результатов в этом сезоне
            </p>
          ) : null}
        </>
      );
    }
  }

  return (
    <>
      {body}
      {showYourPosition && currentPlayerId ? <YourPositionCard standing={standing} rankMovement={rankMovement} /> : null}
    </>
  );
}

export default function LeaderboardPage() {
  const [mode, setMode] = useState<Mode>("current");
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  // Becomes true once resolveCurrentPlayer() has settled either way, so the
  // "Подписки" view can tell "still resolving" from "signed out".
  const [playerResolved, setPlayerResolved] = useState(false);

  // Secondary selector INSIDE "Текущий сезон" (not a fourth top-level tab).
  // "Все" is the default and stays so; the choice simply lives in component
  // state like the statistics metric does (no persistence).
  const [currentView, setCurrentView] = useState<"all" | "following">("all");
  // Every id the viewer follows (GET /api/players/:id/following/ids -- the
  // unbounded endpoint, NOT the paginated list). Fetched the first time
  // "Подписки" is opened, cached for the life of the page, tagged with the
  // player it belongs to.
  const [followingIds, setFollowingIds] = useState<{ playerId: string; ids: Set<string> } | null>(null);
  const [followingError, setFollowingError] = useState<{ playerId: string; message: string } | null>(null);
  const followingRequestRef = useRef<string | null>(null);

  const [seasonTitle, setSeasonTitle] = useState("");
  const [currentRows, setCurrentRows] = useState<LeaderboardRow[]>([]);
  const [currentOOC, setCurrentOOC] = useState<LeaderboardRow[]>([]);
  const [currentLoading, setCurrentLoading] = useState(true);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const [allTimeRows, setAllTimeRows] = useState<LeaderboardRow[]>([]);
  const [allTimeLoading, setAllTimeLoading] = useState(false);
  const [allTimeError, setAllTimeError] = useState<string | null>(null);
  const [allTimeLoaded, setAllTimeLoaded] = useState(false);

  // Statistics -- one metric selected at a time (never all leaderboards at
  // once), cached per metric so re-selecting an already-fetched metric is
  // instant and never re-fetches.
  const [statisticMetric, setStatisticMetric] = useState<ClubStatisticMetric>(
    CLUB_STATISTIC_METRIC.TOURNAMENTS_PLAYED
  );
  const [statisticsCache, setStatisticsCache] = useState<
    Partial<Record<ClubStatisticMetric, ClubStatisticTopPlayer[]>>
  >({});
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);

  useEffect(() => {
    logEvent("rating_opened");
    resolveCurrentPlayer()
      .then((p) => setCurrentPlayerId(p.id))
      .catch(() => setCurrentPlayerId(null))
      .finally(() => setPlayerResolved(true));
  }, []);

  // Lazy: nothing is requested until "Подписки" is selected, never for a
  // signed-out viewer, and never twice for the same player. A response that
  // arrives after the user went back to "Все" (or to another mode) is still
  // cached -- it only ever feeds the "Подписки" view, so it can't disturb what
  // is currently shown. A failure stays in followingError (local to the view);
  // retrying is explicit.
  useEffect(() => {
    if (mode !== "current" || currentView !== "following") return;
    if (!playerResolved || !currentPlayerId) return;
    if (followingIds?.playerId === currentPlayerId) return;
    if (followingError?.playerId === currentPlayerId) return;
    if (followingRequestRef.current === currentPlayerId) return;

    const requestedFor = currentPlayerId;
    followingRequestRef.current = requestedFor;

    fetchFollowingIds(requestedFor)
      .then((ids) => setFollowingIds({ playerId: requestedFor, ids: new Set(ids) }))
      .catch((err: unknown) =>
        setFollowingError({
          playerId: requestedFor,
          message: err instanceof Error && err.message ? err.message : "Не удалось загрузить подписки. Попробуйте ещё раз.",
        })
      )
      .finally(() => {
        if (followingRequestRef.current === requestedFor) followingRequestRef.current = null;
      });
  }, [mode, currentView, playerResolved, currentPlayerId, followingIds, followingError]);

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

  useEffect(() => {
    if (mode !== "statistics" || statisticsCache[statisticMetric]) return;
    async function load() {
      setStatisticsLoading(true);
      setStatisticsError(null);
      try {
        const response = await fetch(`/api/leaderboard/statistics?metric=${statisticMetric}`);
        if (!response.ok) throw new Error("Ошибка загрузки статистики");
        const data = (await response.json()) as { topPlayers: ClubStatisticTopPlayer[] };
        setStatisticsCache((prev) => ({ ...prev, [statisticMetric]: data.topPlayers ?? [] }));
      } catch (err) {
        setStatisticsError(err instanceof Error ? err.message : "Ошибка загрузки статистики");
      } finally {
        setStatisticsLoading(false);
      }
    }
    load();
  }, [mode, statisticMetric, statisticsCache]);

  const currentStanding = resolvePlayerStanding(
    currentRows.map((row, index) => ({ player_id: row.player_id, officialRank: index + 1, rating: row.rating })),
    currentOOC,
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

  const statisticRows = statisticsCache[statisticMetric] ?? [];

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
            <div className="mb-4 flex gap-2" role="group" aria-label="Фильтр рейтинга сезона">
              {(
                [
                  { view: "all", label: "Все" },
                  { view: "following", label: "Подписки" },
                ] as const
              ).map((option) => (
                <button
                  key={option.view}
                  type="button"
                  aria-pressed={currentView === option.view}
                  onClick={() => setCurrentView(option.view)}
                  className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition ${
                    currentView === option.view
                      ? "border-[#d7b55a] bg-[#d7b55a]/15 text-[#f0d38a]"
                      : "border-white/10 bg-white/[0.03] text-white/60"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-sm font-medium text-white/70">{currentLoading ? "Загружаем..." : seasonTitle}</p>
            {currentView === "following" ? (
              <p className="-mt-1 mb-3 text-xs text-white/50">Игроки, на которых вы подписаны</p>
            ) : null}
            {currentError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{currentError}</div>
            ) : currentLoading ? (
              <p className="text-sm text-white/60">Загружаем рейтинг...</p>
            ) : currentView === "following" ? (
              <FollowingView
                rows={currentRows}
                outOfCompetition={currentOOC}
                currentPlayerId={currentPlayerId}
                playerResolved={playerResolved}
                followingIds={followingIds && followingIds.playerId === currentPlayerId ? followingIds.ids : null}
                error={followingError && followingError.playerId === currentPlayerId ? followingError.message : null}
                onRetry={() => setFollowingError(null)}
                standing={currentStanding}
                rankMovement={currentPlayerRankMovement}
              />
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

        {mode === "statistics" ? (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {STATISTIC_METRIC_OPTIONS.map((option) => (
                <button
                  key={option.metric}
                  type="button"
                  onClick={() => setStatisticMetric(option.metric)}
                  className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition ${
                    statisticMetric === option.metric
                      ? "border-[#d7b55a] bg-[#d7b55a]/15 text-[#f0d38a]"
                      : "border-white/10 bg-white/[0.03] text-white/60"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {statisticsError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                {statisticsError}
              </div>
            ) : statisticsLoading && statisticRows.length === 0 ? (
              <p className="text-sm text-white/60">Загружаем статистику...</p>
            ) : (
              <ClubStatisticsRankedList
                topPlayers={statisticRows}
                currentPlayerId={currentPlayerId}
                emptyMessage="Пока нет данных для этой статистики"
              />
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}

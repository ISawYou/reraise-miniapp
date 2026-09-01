"use client";

import { useParams } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import { buildSeasonRecapCopyText } from "@/lib/season-recap-copy";
import type { Player } from "@/types/domain";
import type {
  SeasonRecap,
  SeasonRecapRecord,
  SeasonRecapSingleEventRecord,
  SeasonRecapTournamentRecord,
} from "@/features/season-recap";

const TOURNAMENT_TYPE_LABEL: Record<string, string> = {
  classic: "Classic",
  phoenix: "Phoenix",
  deep_stack: "Deep Stack",
  bounty: "Bounty Hunters",
  boss_bounty: "Boss Bounty",
  win_the_button: "Win The Button",
  mystery_bounty: "Mystery Bounty",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center">
      <p className="text-lg font-bold text-white tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-white/55">{label}</p>
    </div>
  );
}

function RecordRow({ label, record }: { label: string; record: SeasonRecapRecord }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-b-0">
      <p className="text-sm text-white/70">{label}</p>
      {record.meaningful ? (
        <p className="text-right text-sm font-semibold text-white">
          {record.leaders.map((l) => l.displayName).join(", ")}{" "}
          <span className="text-[#f0d38a]">— {record.value}</span>
        </p>
      ) : (
        <p className="text-sm text-white/35">—</p>
      )}
    </div>
  );
}

function SingleEventRow({ label, record }: { label: string; record: SeasonRecapSingleEventRecord }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-b-0">
      <p className="text-sm text-white/70">{label}</p>
      {record.meaningful ? (
        <p className="text-right text-sm font-semibold text-white">
          {record.leaders.map((l) => `${l.displayName} (${l.tournamentTitle})`).join(", ")}{" "}
          <span className="text-[#f0d38a]">— {record.value}</span>
        </p>
      ) : (
        <p className="text-sm text-white/35">—</p>
      )}
    </div>
  );
}

function TournamentRecordRow({ label, record }: { label: string; record: SeasonRecapTournamentRecord }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-b-0">
      <p className="text-sm text-white/70">{label}</p>
      {record.meaningful ? (
        <p className="text-right text-sm font-semibold text-white">
          {record.tournaments.map((t) => t.tournamentTitle).join(", ")}{" "}
          <span className="text-[#f0d38a]">— {record.value}</span>
        </p>
      ) : (
        <p className="text-sm text-white/35">—</p>
      )}
    </div>
  );
}

export default function SeasonRecapPage() {
  const params = useParams<{ id: string }>();
  const seasonId = params?.id;

  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [recap, setRecap] = useState<SeasonRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);
        if (ensuredPlayer.role === "admin" && seasonId) {
          const data = await fetchAdminJson<SeasonRecap>(`/api/admin/seasons/${seasonId}/recap`);
          setRecap(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить итоги сезона");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }
    load();
  }, [seasonId]);

  async function handleCopy() {
    if (!recap) return;
    try {
      await navigator.clipboard.writeText(buildSeasonRecapCopyText(recap));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать");
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-white/70">Загружаем итоги сезона...</p>
        </div>
      </main>
    );
  }

  if (!isSuperAdmin(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-2xl">
          <BackButton href="/admin/seasons" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Итоги сезона доступны только Супер-администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !recap) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-2xl">
          <BackButton href="/admin/seasons" className="mb-4" />
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Не удалось загрузить итоги сезона"}
          </div>
        </div>
      </main>
    );
  }

  const { season, summary, official, records, tournamentRecords } = recap;
  const typeBreakdownEntries = Object.entries(summary.tournamentTypeBreakdown).filter(([, count]) => count > 0);

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-2xl">
        <BackButton href="/admin/seasons" className="mb-4" />

        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">Итоги — {season.title}</h1>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-full border border-[#d7b55a]/30 bg-[#d7b55a]/10 px-3.5 py-2 text-xs font-semibold text-[#f0d38a]"
          >
            {copied ? "Скопировано" : "Скопировать данные для поста"}
          </button>
        </div>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/45">О сезоне</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Турниров" value={summary.completedTournaments} />
            <Stat label="Игроков" value={summary.uniquePlayers} />
            <Stat label="Участий" value={summary.totalParticipations} />
            <Stat label="Очков" value={summary.totalRatingPointsAwarded} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Re-entry" value={summary.totalReentries} />
            <Stat label="KO" value={summary.totalKnockouts} />
            <Stat label="Среднее поле" value={summary.averageFieldSize.toFixed(1)} />
            <Stat
              label="Самое большое поле"
              value={summary.largestField ? summary.largestField.playerCount : "—"}
            />
          </div>
          {summary.largestField ? (
            <p className="mt-2 text-xs text-white/45">
              Самое большое поле: {summary.largestField.tournamentTitle} — {summary.largestField.playerCount}
            </p>
          ) : null}
          {typeBreakdownEntries.length > 0 ? (
            <p className="mt-2 text-xs text-white/45">
              {typeBreakdownEntries
                .map(([type, count]) => `${TOURNAMENT_TYPE_LABEL[type] ?? type}: ${count}`)
                .join(" · ")}
            </p>
          ) : null}
        </section>

        <section className="mt-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/45">ТОП-9 сезона</h2>
          {official.finalists.length === 0 ? (
            <p className="text-sm text-white/50">Нет официальных результатов</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {official.finalists.map((f) => (
                <div
                  key={f.playerId}
                  className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0"
                >
                  <p className="text-sm text-white">
                    <span className="mr-2 text-white/40 tabular-nums">{f.officialRank}.</span>
                    {f.displayName}
                  </p>
                  <p className="text-sm font-semibold text-[#f0d38a] tabular-nums">{f.rating}</p>
                </div>
              ))}
            </div>
          )}
          {official.pointsGapFirstToSecond !== null ? (
            <p className="mt-2 text-xs text-white/45">Отрыв 1 от 2 места: {official.pointsGapFirstToSecond}</p>
          ) : null}
          {official.outOfCompetitionPlayersCount > 0 ? (
            <p className="mt-1 text-xs text-white/35">
              Вне зачёта: {official.outOfCompetitionPlayersCount} игрок(ов)
            </p>
          ) : null}
        </section>

        <section className="mt-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/45">Рекорды сезона</h2>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4">
            <RecordRow label="Больше всех турниров" record={records.mostTournaments} />
            <RecordRow label="Больше всех побед" record={records.mostWins} />
            <RecordRow label="Больше всех подиумов" record={records.mostPodiums} />
            <RecordRow label="Больше всех TOP-9" record={records.mostTopNine} />
            <RecordRow label="Больше всех KO" record={records.mostKnockouts} />
            <RecordRow label="Boss KO" record={records.mostBossKnockouts} />
            <RecordRow label="Mystery Bounty" record={records.mostMysteryBounty} />
            <SingleEventRow label="Лучший результат за один турнир" record={records.bestSingleTournamentRating} />
            <SingleEventRow label="Максимум KO за один турнир" record={records.mostKnockoutsSingleTournament} />
            <RecordRow label="Самая длинная серия участий подряд" record={records.longestParticipationStreak} />
          </div>
        </section>

        <section className="mt-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/45">Турниры-рекордсмены</h2>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4">
            <TournamentRecordRow label="Самое большое поле" record={tournamentRecords.largestField} />
            <TournamentRecordRow label="Самый большой пул рейтинговых очков" record={tournamentRecords.highestRatingPool} />
            <TournamentRecordRow label="Больше всего KO" record={tournamentRecords.highestKnockouts} />
          </div>
          <p className="mt-2 text-xs text-white/40">
            Форматов сыграно: {tournamentRecords.distinctFormatsPlayed}
          </p>
        </section>
      </div>
    </main>
  );
}

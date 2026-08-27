"use client";

import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

type DealerStatsPeriod = "month" | "all";

type DealerStatsSummary = {
  completedShiftCount: number;
  uniqueTournamentCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

type DealerStatsByDealer = {
  dealerPlayerId: string;
  dealerDisplayName: string;
  tournamentCount: number;
  shiftCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

type DealerStatsByTournament = {
  tournamentId: string | null;
  tournamentTitle: string;
  tournamentDate: string | null;
  dealerCount: number;
  shiftCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
};

type DealerPayrollStats = {
  period: DealerStatsPeriod;
  summary: DealerStatsSummary;
  byDealer: DealerStatsByDealer[];
  byTournament: DealerStatsByTournament[];
};

function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

export default function AdminDealerStatsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<DealerStatsPeriod>("month");
  const [stats, setStats] = useState<DealerPayrollStats | null>(null);

  async function loadStats(nextPeriod: DealerStatsPeriod) {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminJson<DealerPayrollStats>(
        `/api/admin/dealers/stats?period=${nextPeriod}`
      );
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить статистику");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const currentPlayer = await resolveCurrentPlayer();
        setPlayer(currentPlayer);
        if (isSuperAdmin(currentPlayer?.role)) {
          await loadStats(period);
        }
      } catch {
        // resolveCurrentPlayer failure -> access gate below shows "not admin".
      } finally {
        setAccessChecked(true);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePeriodChange(nextPeriod: DealerStatsPeriod) {
    setPeriod(nextPeriod);
    loadStats(nextPeriod);
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (!isSuperAdmin(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/admin" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только Супер-администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-16 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Статистика дилеров</h1>

        <div className="mt-4 inline-flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
          <button
            type="button"
            onClick={() => handlePeriodChange("month")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              period === "month"
                ? "bg-yellow-500 text-black"
                : "text-white/65 hover:bg-white/8 hover:text-white"
            }`}
          >
            Текущий месяц
          </button>
          <button
            type="button"
            onClick={() => handlePeriodChange("all")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              period === "all"
                ? "bg-yellow-500 text-black"
                : "text-white/65 hover:bg-white/8 hover:text-white"
            }`}
          >
            Всё время
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading || !stats ? (
          <p className="mt-6 text-sm text-white/70">Загружаем...</p>
        ) : (
          <>
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-white/45">Смен</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {stats.summary.completedShiftCount}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-white/45">Турниров</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {stats.summary.uniqueTournamentCount}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-white/45">Отработано</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatDurationMinutes(stats.summary.workedMinutes)}
                </p>
              </div>
              <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                <p className="text-xs text-yellow-200/70">Выплаты</p>
                <p className="mt-1 text-lg font-bold text-yellow-400">
                  {formatRub(stats.summary.amountRub)}
                </p>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">
                ПО ДИЛЕРАМ
              </h2>
              {stats.byDealer.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Нет данных за выбранный период
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.byDealer
                    .slice()
                    .sort((a, b) => b.amountRub - a.amountRub)
                    .map((row) => (
                      <div
                        key={row.dealerPlayerId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {row.dealerDisplayName}
                          </p>
                          <p className="mt-0.5 text-xs text-white/45">
                            {row.shiftCount} смен · {row.tournamentCount} турниров ·{" "}
                            {formatDurationMinutes(row.workedMinutes)}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-white">
                          {formatRub(row.amountRub)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">
                ПО ТУРНИРАМ
              </h2>
              {stats.byTournament.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Нет данных за выбранный период
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.byTournament.map((row) => (
                    <div
                      key={row.tournamentId ?? "__none__"}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {row.tournamentTitle}
                        </p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {row.dealerCount} дилеров · {row.shiftCount} смен ·{" "}
                          {formatDurationMinutes(row.workedMinutes)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-white">
                        {formatRub(row.amountRub)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

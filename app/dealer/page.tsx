"use client";

import { useEffect, useMemo, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { fetchAdminJson } from "@/lib/client-request";

type PersonalDealerTournamentInfo = {
  tournamentId: string | null;
  tournamentTitle: string | null;
  tournamentDate: string | null;
};

type PersonalDealerOpenShift = PersonalDealerTournamentInfo & {
  startedAt: string;
  taxiAllowanceRub: number;
};

type PersonalDealerMonthSummary = {
  completedShiftCount: number;
  uniqueTournamentCount: number;
  workedMinutes: number;
  paidHours: number;
  amountRub: number;
  taxiAllowanceRub: number;
  payoutRub: number;
};

type PersonalDealerShift = PersonalDealerTournamentInfo & {
  id: string;
  startedAt: string;
  endedAt: string | null;
  workedMinutes: number | null;
  paidHours: number | null;
  amountRub: number | null;
  taxiAllowanceRub: number;
  payoutRub: number | null;
};

type PersonalDealerSummary = {
  dealer: { isActive: boolean } | null;
  openShift: PersonalDealerOpenShift | null;
  monthSummary: PersonalDealerMonthSummary;
  history: PersonalDealerShift[];
};

function formatHM(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatTournamentDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

function formatElapsedSince(startedAtIso: string, nowMs: number) {
  const startMs = new Date(startedAtIso).getTime();
  const totalMinutes = Math.max(0, Math.floor((nowMs - startMs) / 60000));
  return formatDurationMinutes(totalMinutes);
}

function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function monthGroupKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function monthGroupLabel(iso: string, nowYear: number) {
  const d = new Date(iso);
  const label = d.toLocaleDateString("ru-RU", { month: "long" });
  const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
  return d.getFullYear() === nowYear ? capitalized : `${capitalized} ${d.getFullYear()}`;
}

function tournamentLabel(info: PersonalDealerTournamentInfo) {
  if (!info.tournamentTitle) {
    return "Без турнира";
  }
  return info.tournamentDate
    ? `${info.tournamentTitle} · ${formatTournamentDate(info.tournamentDate)}`
    : info.tournamentTitle;
}

export default function DealerPersonalPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PersonalDealerSummary | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAdminJson<PersonalDealerSummary>("/api/dealer/me");
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    // Local-only elapsed-time refresh for an open shift -- no server
    // polling, just a once-a-minute re-render.
    const interval = window.setInterval(() => setNowTick(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const historyGroups = useMemo(() => {
    if (!summary) return [];
    const groups: { key: string; label: string; shifts: PersonalDealerShift[] }[] = [];
    const nowYear = new Date().getFullYear();
    const byKey = new Map<string, { key: string; label: string; shifts: PersonalDealerShift[] }>();

    for (const shift of summary.history) {
      const key = monthGroupKey(shift.startedAt);
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: monthGroupLabel(shift.startedAt, nowYear), shifts: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.shifts.push(shift);
    }

    return groups;
  }, [summary]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/" className="mb-4" />
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        </div>
      </main>
    );
  }

  if (!summary?.dealer) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            У вас нет истории работы дилера
          </div>
        </div>
      </main>
    );
  }

  const { openShift, monthSummary } = summary;
  const currentMonthLabel =
    monthGroupLabel(new Date().toISOString(), new Date().getFullYear());

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-16 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/" className="mb-4" />

        <h1 className="text-2xl font-bold">Моя работа</h1>

        {openShift ? (
          <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Смена идёт</span>
            </div>

            <p className="mt-3 text-sm text-white/70">
              Турнир: {tournamentLabel(openShift)}
            </p>
            <p className="mt-1 text-sm text-white/70">
              Начало: {formatHM(openShift.startedAt)}
            </p>
            <p className="mt-1 text-sm text-emerald-100/80">
              Прошло: {formatElapsedSince(openShift.startedAt, nowTick)}
            </p>
            {openShift.taxiAllowanceRub > 0 ? (
              <p className="mt-2 text-sm font-medium text-amber-300">
                Чай +{openShift.taxiAllowanceRub} ₽
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xs font-semibold tracking-widest text-white/40">
            {currentMonthLabel.toUpperCase()}
          </h2>

          {monthSummary.completedShiftCount === 0 ? (
            <p className="mt-3 text-sm text-white/60">В этом месяце завершённых смен ещё нет</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-lg font-semibold text-white">{monthSummary.completedShiftCount}</p>
                <p className="mt-0.5 text-xs text-white/45">смен</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{monthSummary.uniqueTournamentCount}</p>
                <p className="mt-0.5 text-xs text-white/45">турниров</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">
                  {formatDurationMinutes(monthSummary.workedMinutes)}
                </p>
                <p className="mt-0.5 text-xs text-white/45">фактически отработано</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">{monthSummary.paidHours} ч</p>
                <p className="mt-0.5 text-xs text-white/45">оплачиваемых часов</p>
              </div>
              <div>
                <p className="text-lg font-bold text-yellow-400">{formatRub(monthSummary.payoutRub)}</p>
                <p className="mt-0.5 text-xs text-white/45">заработано</p>
                {monthSummary.taxiAllowanceRub > 0 ? (
                  <p className="mt-0.5 text-[11px] text-amber-300/80">
                    включая чай {formatRub(monthSummary.taxiAllowanceRub)}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">ИСТОРИЯ СМЕН</h2>

          {historyGroups.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              История пуста
            </div>
          ) : (
            <div className="space-y-6">
              {historyGroups.map((group) => (
                <div key={group.key}>
                  <p className="mb-2 text-xs font-medium text-white/40">{group.label}</p>
                  <div className="space-y-2">
                    {group.shifts.map((shift) => (
                      <div
                        key={shift.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">
                              {tournamentLabel(shift)}
                            </p>
                            <p className="mt-0.5 text-xs text-white/50">
                              {formatHM(shift.startedAt)}
                              {" — "}
                              {shift.endedAt ? formatHM(shift.endedAt) : "—"}
                            </p>
                            {shift.workedMinutes != null ? (
                              <p className="mt-0.5 text-xs text-white/40">
                                {formatDurationMinutes(shift.workedMinutes)}
                                {shift.paidHours != null ? ` · ${shift.paidHours} оплачиваемых часов` : ""}
                              </p>
                            ) : null}
                          </div>
                          {shift.taxiAllowanceRub > 0 && shift.amountRub != null ? (
                            <div className="shrink-0 text-right text-xs">
                              <p className="text-white/50">Смена: {formatRub(shift.amountRub)}</p>
                              <p className="mt-0.5 text-amber-300/90">
                                Чай: +{formatRub(shift.taxiAllowanceRub)}
                              </p>
                              <p className="mt-0.5 text-sm font-semibold text-white">
                                Итого: {formatRub(shift.payoutRub ?? shift.amountRub)}
                              </p>
                            </div>
                          ) : (
                            <span className="shrink-0 text-sm font-semibold text-white">
                              {shift.amountRub != null ? formatRub(shift.amountRub) : "—"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

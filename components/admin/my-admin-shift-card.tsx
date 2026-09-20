"use client";

import { useEffect, useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { filterStartableTournaments } from "@/lib/dealer-tournament-select";
import type { Tournament } from "@/types/domain";

const NO_TOURNAMENT_VALUE = "";

type MyAdminOpenShift = {
  id: string;
  startedAt: string;
  amountRub: number;
  tournamentId: string | null;
  tournamentTitle: string | null;
};

type MyAdminShiftHistoryEntry = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  amountRub: number;
  tournamentId: string | null;
  tournamentTitle: string | null;
};

type MyAdminShiftSummary = {
  openShift: MyAdminOpenShift | null;
  history: MyAdminShiftHistoryEntry[];
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateTimeLocalValue(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocalValue(value: string) {
  return new Date(value).toISOString();
}

function formatHM(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

// Self-service "Моя смена администратора" -- available to both staff roles
// (operator and Super Admin, see lib/roles.ts). Flat payout only: the
// stored amount is shown, never computed here, and this widget never
// offers an amount input at all -- editing the payout is exclusively a
// Super Admin capability via /admin/admin-shifts (see
// app/api/admin/admin-shifts/[shiftId]/route.ts).
export function MyAdminShiftCard() {
  const [summary, setSummary] = useState<MyAdminShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showStart, setShowStart] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [startTournamentId, setStartTournamentId] = useState(NO_TOURNAMENT_VALUE);
  const [starting, setStarting] = useState(false);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [tournamentsLoaded, setTournamentsLoaded] = useState(false);

  const [showEnd, setShowEnd] = useState(false);
  const [endAt, setEndAt] = useState("");
  const [ending, setEnding] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminJson<MyAdminShiftSummary>("/api/admin-shift/me");
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить смену");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function ensureTournamentsLoaded() {
    if (tournamentsLoaded) return;
    try {
      setTournamentsLoading(true);
      const data = await fetchAdminJson<{ tournaments: Tournament[] }>(
        "/api/admin/tournaments?scope=manage"
      );
      setTournaments(data.tournaments);
      setTournamentsLoaded(true);
    } catch {
      // Falls back to "Без турнира" only -- not fatal.
    } finally {
      setTournamentsLoading(false);
    }
  }

  const startableTournaments = filterStartableTournaments(tournaments);

  function openStart() {
    setShowStart(true);
    setStartAt(toDateTimeLocalValue(new Date().toISOString()));
    setStartTournamentId(NO_TOURNAMENT_VALUE);
    setError(null);
    ensureTournamentsLoaded();
  }

  async function confirmStart() {
    if (!startAt) return;
    setStarting(true);
    setError(null);
    try {
      await fetchAdminJson("/api/admin-shift/me/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startedAt: fromDateTimeLocalValue(startAt),
          tournamentId: startTournamentId || null,
        }),
      });
      setShowStart(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать смену");
    } finally {
      setStarting(false);
    }
  }

  function openEnd() {
    setShowEnd(true);
    setEndAt(toDateTimeLocalValue(new Date().toISOString()));
    setError(null);
  }

  async function confirmEnd() {
    if (!endAt) return;
    setEnding(true);
    setError(null);
    try {
      await fetchAdminJson("/api/admin-shift/me/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endedAt: fromDateTimeLocalValue(endAt) }),
      });
      setShowEnd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось завершить смену");
    } finally {
      setEnding(false);
    }
  }

  if (loading) {
    return (
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <h2 className="text-xs font-semibold tracking-widest text-white/40">
          МОЯ СМЕНА АДМИНИСТРАТОРА
        </h2>
        <p className="mt-3 text-sm text-white/60">Загружаем...</p>
      </section>
    );
  }

  const openShift = summary?.openShift ?? null;

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <h2 className="text-xs font-semibold tracking-widest text-white/40">
        МОЯ СМЕНА АДМИНИСТРАТОРА
      </h2>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-3">
        {openShift ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>На смене с {formatHM(openShift.startedAt)}</span>
              </div>
              <p className="mt-1 text-xs text-emerald-100/70">
                {openShift.tournamentTitle ?? "Без турнира"}
              </p>
              <p className="mt-1 text-xs font-semibold text-yellow-400">
                {formatRub(openShift.amountRub)}
              </p>
            </div>
            <button
              type="button"
              onClick={openEnd}
              className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
            >
              Закончить смену
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <span className="text-xs text-white/50">Смена не начата</span>
            <button
              type="button"
              onClick={openStart}
              className="shrink-0 rounded-lg bg-yellow-500 px-3 py-2 text-xs font-semibold text-black"
            >
              Начать смену
            </button>
          </div>
        )}
      </div>

      {summary && summary.history.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {summary.history.slice(0, 5).map((shift) => (
            <div
              key={shift.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
            >
              <div className="min-w-0 text-white/55">
                <span>
                  {new Date(shift.startedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                </span>
                <span className="mx-1">·</span>
                <span>{shift.tournamentTitle ?? "Без турнира"}</span>
              </div>
              <span className="shrink-0 font-semibold text-white/80">{formatRub(shift.amountRub)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Начать смену */}
      {showStart ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => !starting && setShowStart(false)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Начать смену</h2>

              <label className="mt-4 block text-xs text-white/50">Время прихода</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <label className="mt-3 block text-xs text-white/50">Турнир</label>
              <select
                value={startTournamentId}
                onChange={(e) => setStartTournamentId(e.target.value)}
                disabled={tournamentsLoading}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none disabled:opacity-50"
              >
                <option value={NO_TOURNAMENT_VALUE}>Без турнира</option>
                {startableTournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>

              <p className="mt-3 text-xs text-white/45">Стандартная выплата: 4 000 ₽</p>

              <button
                type="button"
                disabled={starting || !startAt}
                onClick={confirmStart}
                className="mt-5 w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                {starting ? "Сохраняем..." : "Начать смену"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Закончить смену */}
      {showEnd && openShift ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => !ending && setShowEnd(false)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Закончить смену</h2>

              <label className="mt-4 block text-xs text-white/50">Ушёл</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <p className="mt-4 text-sm font-semibold text-yellow-400">
                К выплате: {formatRub(openShift.amountRub)}
              </p>

              <button
                type="button"
                disabled={ending || !endAt}
                onClick={confirmEnd}
                className="mt-5 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {ending ? "Сохраняем..." : "Завершить смену"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

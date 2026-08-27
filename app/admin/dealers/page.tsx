"use client";

import { useEffect, useMemo, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { isStaff, isSuperAdmin } from "@/lib/roles";
import type { Player, Tournament } from "@/types/domain";

const NO_TOURNAMENT_VALUE = "";

const TAXI_ALLOWANCE_RUB = 500;

type DealerOpenShift = {
  id: string;
  startedAt: string;
  tournamentId: string | null;
  tournamentTitle: string | null;
  taxiAllowanceRub: number;
};

type DealerStatus = {
  player: Player;
  // Absent for an operator caller -- the route strips it server-side.
  hourlyRateRub?: number;
  openShift: DealerOpenShift | null;
};

type DealerShiftSummary = {
  id: string;
  dealerPlayerId: string;
  dealerDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  hourlyRateRub: number;
  workedMinutes: number | null;
  paidHours: number | null;
  amountRub: number | null;
  taxiAllowanceRub: number;
  payoutRub: number | null;
  tournamentId: string | null;
  tournamentTitle: string | null;
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

// Client-side preview only, mirrors the server formula exactly -- the
// persisted calculation always comes from the server's own recalculation
// (features/dealers.ts::computeShiftPayroll), never trusted from here.
// hourlyRateRub is absent for an operator caller (the rate is never sent to
// them), in which case only the worked duration is previewed, no amount.
function previewPayroll(startedAtIso: string, endedAtIso: string, hourlyRateRub?: number) {
  const startMs = new Date(startedAtIso).getTime();
  const endMs = new Date(endedAtIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const workedMinutes = Math.round((endMs - startMs) / 60000);
  const paidHours = Math.ceil(workedMinutes / 60);
  const amountRub = typeof hourlyRateRub === "number" ? paidHours * hourlyRateRub : null;
  return { workedMinutes, paidHours, amountRub };
}

function PlayerAvatar({ player, size = 40 }: { player: Player; size?: number }) {
  const avatarUrl = getPlayerAvatarUrl(player);
  const fallback = getPlayerAvatarFallback(player);
  const style = { width: size, height: size };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={player.display_name}
        style={style}
        className="rounded-full border border-white/10 object-cover"
      />
    );
  }

  return (
    <div
      style={style}
      className="flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80"
    >
      {fallback}
    </div>
  );
}

function TournamentSelect({
  value,
  onChange,
  tournaments,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  tournaments: Tournament[];
  loading: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none disabled:opacity-50"
    >
      <option value={NO_TOURNAMENT_VALUE}>Без турнира</option>
      {tournaments.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
}

export default function AdminDealersPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [dealers, setDealers] = useState<DealerStatus[]>([]);
  const [today, setToday] = useState<{ shifts: DealerShiftSummary[]; totalPayoutRub: number }>({
    shifts: [],
    totalPayoutRub: 0,
  });
  const [recent, setRecent] = useState<DealerShiftSummary[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [savingTaxiAllowanceFor, setSavingTaxiAllowanceFor] = useState<string | null>(null);

  const [showAddDealer, setShowAddDealer] = useState(false);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [dealerSearch, setDealerSearch] = useState("");
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [tournamentsLoaded, setTournamentsLoaded] = useState(false);

  const [startShiftFor, setStartShiftFor] = useState<DealerStatus | null>(null);
  const [startShiftAt, setStartShiftAt] = useState("");
  const [startShiftTournamentId, setStartShiftTournamentId] = useState(NO_TOURNAMENT_VALUE);
  const [startingShift, setStartingShift] = useState(false);

  const [endShiftFor, setEndShiftFor] = useState<DealerStatus | null>(null);
  const [endShiftStartedAt, setEndShiftStartedAt] = useState("");
  const [endShiftEndedAt, setEndShiftEndedAt] = useState("");
  const [endingShift, setEndingShift] = useState(false);

  const [editingShift, setEditingShift] = useState<DealerShiftSummary | null>(null);
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");
  const [editTournamentId, setEditTournamentId] = useState(NO_TOURNAMENT_VALUE);
  const [savingEdit, setSavingEdit] = useState(false);

  const [editingRateFor, setEditingRateFor] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  const [deactivatingPlayerId, setDeactivatingPlayerId] = useState<string | null>(null);

  const isSuperAdminCaller = isSuperAdmin(player?.role);

  async function loadAll(actingAsSuperAdmin: boolean) {
    try {
      setLoading(true);
      setError(null);

      if (actingAsSuperAdmin) {
        const [dealersData, todayData, recentData] = await Promise.all([
          fetchAdminJson<{ dealers: DealerStatus[] }>("/api/admin/dealers"),
          fetchAdminJson<{ shifts: DealerShiftSummary[]; totalPayoutRub: number }>(
            "/api/admin/dealers/shifts/today"
          ),
          fetchAdminJson<{ shifts: DealerShiftSummary[] }>("/api/admin/dealers/shifts/recent"),
        ]);
        setDealers(dealersData.dealers);
        setToday(todayData);
        setRecent(recentData.shifts);
      } else {
        const dealersData = await fetchAdminJson<{ dealers: DealerStatus[] }>(
          "/api/admin/dealers"
        );
        setDealers(dealersData.dealers);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const currentPlayer = await resolveCurrentPlayer();
        setPlayer(currentPlayer);
        if (isStaff(currentPlayer?.role)) {
          await loadAll(isSuperAdmin(currentPlayer?.role));
        }
      } catch {
        // resolveCurrentPlayer failure -> access gate below shows "not staff".
      } finally {
        setAccessChecked(true);
      }
    }
    init();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const dealerPlayerIds = useMemo(() => new Set(dealers.map((d) => d.player.id)), [dealers]);

  const filteredAddablePlayers = useMemo(() => {
    const query = dealerSearch.trim().toLowerCase();
    const candidates = allPlayers.filter((p) => !dealerPlayerIds.has(p.id));
    const matched = query
      ? candidates.filter(
          (p) =>
            (p.display_name ?? "").toLowerCase().includes(query) ||
            (p.admin_display_name ?? "").toLowerCase().includes(query) ||
            (p.username ?? "").toLowerCase().includes(query)
        )
      : candidates.slice(0, 50);
    return matched.sort((a, b) =>
      (a.admin_display_name ?? a.display_name ?? "").localeCompare(
        b.admin_display_name ?? b.display_name ?? "",
        "ru"
      )
    );
  }, [allPlayers, dealerSearch, dealerPlayerIds]);

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
      // Tournament select falls back to "Без турнира" only -- not fatal.
    } finally {
      setTournamentsLoading(false);
    }
  }

  // Nearest non-completed tournament by start time -- a reasonable default
  // for "which tournament is this shift for", never auto-submitted without
  // the operator/admin seeing and being able to change it.
  const defaultTournamentId = useMemo(() => {
    const active = tournaments
      .filter((t) => t.status !== "completed")
      .slice()
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    return active[0]?.id ?? NO_TOURNAMENT_VALUE;
  }, [tournaments]);

  async function handleOpenAddDealer() {
    setShowAddDealer(true);
    setMessage(null);
    setError(null);
    if (allPlayers.length === 0) {
      try {
        setPlayersLoading(true);
        const data = await fetchAdminJson<{ players: Player[] }>("/api/admin/nicknames/players");
        setAllPlayers(data.players);
      } catch {
        setError("Не удалось загрузить список игроков");
      } finally {
        setPlayersLoading(false);
      }
    }
  }

  async function handleAddDealer(playerId: string) {
    setAddingPlayerId(playerId);
    setError(null);
    try {
      await fetchAdminJson("/api/admin/dealers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      setMessage("Дилер добавлен");
      setDealerSearch("");
      setShowAddDealer(false);
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить дилера");
    } finally {
      setAddingPlayerId(null);
    }
  }

  async function handleDeactivateDealer(playerId: string) {
    setDeactivatingPlayerId(playerId);
    setError(null);
    setMessage(null);
    try {
      await fetchAdminJson(`/api/admin/dealers/${playerId}`, { method: "DELETE" });
      setMessage("Дилер убран из списка");
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось убрать дилера");
    } finally {
      setDeactivatingPlayerId(null);
    }
  }

  function openStartShiftModal(dealer: DealerStatus) {
    setStartShiftFor(dealer);
    setStartShiftAt(toDateTimeLocalValue(new Date().toISOString()));
    setStartShiftTournamentId(NO_TOURNAMENT_VALUE);
    setError(null);
    ensureTournamentsLoaded();
  }

  // Once tournaments finish loading, seed the default selection -- only if
  // the modal for starting a shift is still open and nothing was picked yet.
  useEffect(() => {
    if (startShiftFor && startShiftTournamentId === NO_TOURNAMENT_VALUE && defaultTournamentId) {
      setStartShiftTournamentId(defaultTournamentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTournamentId, startShiftFor]);

  async function handleConfirmStartShift() {
    if (!startShiftFor || !startShiftAt) return;
    setStartingShift(true);
    setError(null);
    try {
      await fetchAdminJson("/api/admin/dealers/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerPlayerId: startShiftFor.player.id,
          startedAt: fromDateTimeLocalValue(startShiftAt),
          tournamentId: startShiftTournamentId || null,
        }),
      });
      setMessage("Смена начата");
      setStartShiftFor(null);
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать смену");
    } finally {
      setStartingShift(false);
    }
  }

  function openEndShiftModal(dealer: DealerStatus) {
    if (!dealer.openShift) return;
    setEndShiftFor(dealer);
    setEndShiftStartedAt(toDateTimeLocalValue(dealer.openShift.startedAt));
    setEndShiftEndedAt(toDateTimeLocalValue(new Date().toISOString()));
    setError(null);
  }

  async function handleConfirmEndShift() {
    if (!endShiftFor?.openShift || !endShiftEndedAt) return;
    setEndingShift(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/dealers/shifts/${endShiftFor.openShift.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endedAt: fromDateTimeLocalValue(endShiftEndedAt),
        }),
      });
      setMessage("Смена завершена");
      setEndShiftFor(null);
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось завершить смену");
    } finally {
      setEndingShift(false);
    }
  }

  function openEditShiftModal(shift: DealerShiftSummary) {
    setEditingShift(shift);
    setEditStartedAt(toDateTimeLocalValue(shift.startedAt));
    setEditEndedAt(shift.endedAt ? toDateTimeLocalValue(shift.endedAt) : "");
    setEditTournamentId(shift.tournamentId ?? NO_TOURNAMENT_VALUE);
    setError(null);
    ensureTournamentsLoaded();
  }

  async function handleConfirmEditShift() {
    if (!editingShift || !editStartedAt || !editEndedAt) return;
    setSavingEdit(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/dealers/shifts/${editingShift.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startedAt: fromDateTimeLocalValue(editStartedAt),
          endedAt: fromDateTimeLocalValue(editEndedAt),
          tournamentId: editTournamentId || null,
        }),
      });
      setMessage("Смена изменена");
      setEditingShift(null);
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить смену");
    } finally {
      setSavingEdit(false);
    }
  }

  function openRateEdit(dealer: DealerStatus) {
    if (typeof dealer.hourlyRateRub !== "number") return;
    setEditingRateFor(dealer.player.id);
    setRateDraft(String(dealer.hourlyRateRub));
  }

  async function handleSaveRate(playerId: string) {
    const value = Number(rateDraft);
    if (!Number.isInteger(value) || value < 0) {
      setError("Ставка должна быть неотрицательным целым числом");
      return;
    }
    setSavingRate(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/dealers/${playerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hourlyRateRub: value }),
      });
      setEditingRateFor(null);
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить ставку");
    } finally {
      setSavingRate(false);
    }
  }

  // "Чай" -- works on an open shift or a completed one, Super-Admin-only.
  // Never touches worked_minutes/paid_hours/rate/amount -- a single
  // independent PATCH field.
  async function handleToggleTaxiAllowance(shiftId: string, enable: boolean) {
    setSavingTaxiAllowanceFor(shiftId);
    setError(null);
    try {
      const taxiAllowanceRub = enable ? TAXI_ALLOWANCE_RUB : 0;
      await fetchAdminJson(`/api/admin/dealers/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxiAllowanceRub }),
      });
      setMessage(enable ? "Чай +500 ₽ добавлен" : "Чай отменён");
      // editingShift is a locally-held snapshot from when the modal opened --
      // loadAll refreshes the underlying lists but not this snapshot, so
      // patch it directly if it's the shift that was just toggled.
      setEditingShift((prev) => (prev?.id === shiftId ? { ...prev, taxiAllowanceRub } : prev));
      await loadAll(isSuperAdminCaller);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить чай");
    } finally {
      setSavingTaxiAllowanceFor(null);
    }
  }

  const startPreview = startShiftFor && startShiftAt ? fromDateTimeLocalValue(startShiftAt) : null;
  const endPreview =
    endShiftFor?.openShift && endShiftStartedAt && endShiftEndedAt
      ? previewPayroll(
          fromDateTimeLocalValue(endShiftStartedAt),
          fromDateTimeLocalValue(endShiftEndedAt),
          endShiftFor.hourlyRateRub
        )
      : null;
  const editPreview =
    editingShift && editStartedAt && editEndedAt
      ? previewPayroll(
          fromDateTimeLocalValue(editStartedAt),
          fromDateTimeLocalValue(editEndedAt),
          editingShift.hourlyRateRub
        )
      : null;

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (!isStaff(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/admin" className="mb-4" />
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещён</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только администратору.
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

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Дилеры</h1>
          {isSuperAdminCaller ? (
            <button
              type="button"
              onClick={handleOpenAddDealer}
              className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black"
            >
              Добавить дилера
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            {message}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-white/70">Загружаем...</p>
        ) : (
          <>
            {/* Сейчас на смене */}
            <section className="mt-6">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">
                СЕЙЧАС НА СМЕНЕ
              </h2>

              {dealers.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Нет активных дилеров
                </div>
              ) : (
                <div className="space-y-3">
                  {dealers.map((dealer) => (
                    <div
                      key={dealer.player.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <PlayerAvatar player={dealer.player} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {dealer.player.admin_display_name || dealer.player.display_name}
                            </p>
                            {isSuperAdminCaller && typeof dealer.hourlyRateRub === "number" ? (
                              editingRateFor === dealer.player.id ? (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    value={rateDraft}
                                    onChange={(e) => setRateDraft(e.target.value)}
                                    className="h-7 w-20 rounded-md border border-white/15 bg-black/40 px-2 text-xs outline-none"
                                  />
                                  <span className="text-xs text-white/50">₽/ч</span>
                                  <button
                                    type="button"
                                    disabled={savingRate}
                                    onClick={() => handleSaveRate(dealer.player.id)}
                                    className="text-xs font-semibold text-yellow-400 disabled:opacity-50"
                                  >
                                    Ок
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingRateFor(null)}
                                    className="text-xs text-white/50"
                                  >
                                    Отмена
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openRateEdit(dealer)}
                                  className="mt-0.5 text-xs text-white/50 underline decoration-white/20 underline-offset-2"
                                >
                                  {dealer.hourlyRateRub} ₽/ч
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>

                        {isSuperAdminCaller ? (
                          <button
                            type="button"
                            disabled={!!dealer.openShift || deactivatingPlayerId === dealer.player.id}
                            onClick={() => handleDeactivateDealer(dealer.player.id)}
                            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/60 disabled:opacity-30"
                            title={dealer.openShift ? "Нельзя убрать: есть открытая смена" : undefined}
                          >
                            Убрать
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-3">
                        {dealer.openShift ? (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-200">
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                <span>На смене с {formatHM(dealer.openShift.startedAt)}</span>
                              </div>
                              <p className="mt-1 text-xs text-emerald-100/70">
                                {formatElapsedSince(dealer.openShift.startedAt, nowTick)}
                              </p>
                              <p className="mt-1 text-xs text-emerald-100/60">
                                {dealer.openShift.tournamentTitle ?? "Без турнира"}
                              </p>
                              {isSuperAdminCaller ? (
                                dealer.openShift.taxiAllowanceRub > 0 ? (
                                  <div className="mt-1.5 flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-amber-300">
                                      Чай +{dealer.openShift.taxiAllowanceRub} ₽
                                    </span>
                                    <button
                                      type="button"
                                      disabled={savingTaxiAllowanceFor === dealer.openShift.id}
                                      onClick={() => handleToggleTaxiAllowance(dealer.openShift!.id, false)}
                                      className="text-xs text-white/40 underline decoration-white/20 underline-offset-2 disabled:opacity-50"
                                    >
                                      Отменить
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={savingTaxiAllowanceFor === dealer.openShift.id}
                                    onClick={() => handleToggleTaxiAllowance(dealer.openShift!.id, true)}
                                    className="mt-1.5 text-xs text-amber-300/80 underline decoration-amber-300/30 underline-offset-2 disabled:opacity-50"
                                  >
                                    Добавить чай +500 ₽
                                  </button>
                                )
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => openEndShiftModal(dealer)}
                              className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
                            >
                              Закончить смену
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                            <span className="text-xs text-white/50">Не на смене</span>
                            <button
                              type="button"
                              onClick={() => openStartShiftModal(dealer)}
                              className="shrink-0 rounded-lg bg-yellow-500 px-3 py-2 text-xs font-semibold text-black"
                            >
                              Начать смену
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {isSuperAdminCaller ? (
              <>
                {/* Сегодня */}
                <section className="mt-8">
                  <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">
                    СЕГОДНЯ
                  </h2>

                  {today.shifts.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                      Сегодня завершённых смен ещё нет
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                      {today.shifts.map((shift) => (
                        <div
                          key={shift.id}
                          className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">
                              {shift.dealerDisplayName}
                            </p>
                            <p className="mt-0.5 text-xs text-white/55">
                              {formatHM(shift.startedAt)} — {shift.endedAt ? formatHM(shift.endedAt) : "—"}
                            </p>
                            <p className="mt-0.5 text-xs text-white/40">
                              {shift.workedMinutes != null ? formatDurationMinutes(shift.workedMinutes) : "—"}
                              {" → "}
                              {shift.paidHours != null ? `${shift.paidHours} ч` : "—"}
                            </p>
                            <p className="mt-0.5 text-xs text-white/35">
                              {shift.tournamentTitle ?? "Без турнира"}
                              {shift.taxiAllowanceRub > 0 ? (
                                <span className="text-amber-300/80"> · Чай +{shift.taxiAllowanceRub} ₽</span>
                              ) : null}
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-sm font-semibold text-white">
                            {shift.payoutRub != null ? formatRub(shift.payoutRub) : "—"}
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.03] px-4 py-3">
                        <span className="text-sm font-semibold text-white/80">Итого сегодня</span>
                        <span className="text-sm font-bold text-yellow-400">
                          {formatRub(today.totalPayoutRub)}
                        </span>
                      </div>
                    </div>
                  )}
                </section>

                {/* История */}
                <section className="mt-8">
                  <h2 className="mb-3 text-xs font-semibold tracking-widest text-white/40">
                    ИСТОРИЯ (ПОСЛЕДНИЕ СМЕНЫ)
                  </h2>

                  {recent.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                      История пуста
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recent.map((shift) => (
                        <div
                          key={shift.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">
                              {shift.dealerDisplayName}
                            </p>
                            <p className="mt-0.5 text-xs text-white/50">
                              {new Date(shift.startedAt).toLocaleDateString("ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                              })}{" "}
                              · {formatHM(shift.startedAt)} — {shift.endedAt ? formatHM(shift.endedAt) : "—"}
                            </p>
                            <p className="mt-0.5 text-xs text-white/35">
                              {shift.tournamentTitle ?? "Без турнира"}
                              {shift.taxiAllowanceRub > 0 ? (
                                <span className="text-amber-300/80"> · Чай +{shift.taxiAllowanceRub} ₽</span>
                              ) : null}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-sm font-semibold text-white">
                              {shift.payoutRub != null ? formatRub(shift.payoutRub) : "—"}
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditShiftModal(shift)}
                              className="text-xs font-medium text-yellow-400 underline decoration-yellow-400/30 underline-offset-2"
                            >
                              Изменить
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Добавить дилера */}
      {isSuperAdminCaller && showAddDealer ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => setShowAddDealer(false)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Добавить дилера</h2>
              <input
                type="text"
                value={dealerSearch}
                onChange={(e) => setDealerSearch(e.target.value)}
                placeholder="Поиск по нику или имени"
                className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />
              <div className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
                {playersLoading ? (
                  <p className="p-3 text-sm text-white/60">Загружаем игроков...</p>
                ) : filteredAddablePlayers.length === 0 ? (
                  <p className="p-3 text-sm text-white/60">Никого не найдено</p>
                ) : (
                  filteredAddablePlayers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={addingPlayerId === p.id}
                      onClick={() => handleAddDealer(p.id)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5 disabled:opacity-50"
                    >
                      <PlayerAvatar player={p} size={32} />
                      <span className="min-w-0 flex-1 truncate text-sm text-white">
                        {p.admin_display_name || p.display_name}
                      </span>
                      <span className="shrink-0 text-xs text-white/40">
                        {addingPlayerId === p.id ? "Добавляем..." : "Добавить"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* Начать смену */}
      {startShiftFor ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => !startingShift && setStartShiftFor(null)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Начать смену</h2>
              <p className="mt-1 text-sm text-white/60">
                {startShiftFor.player.admin_display_name || startShiftFor.player.display_name}
              </p>

              <label className="mt-4 block text-xs text-white/50">Время прихода</label>
              <input
                type="datetime-local"
                value={startShiftAt}
                onChange={(e) => setStartShiftAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <label className="mt-3 block text-xs text-white/50">Турнир</label>
              <TournamentSelect
                value={startShiftTournamentId}
                onChange={setStartShiftTournamentId}
                tournaments={tournaments}
                loading={tournamentsLoading}
              />

              <button
                type="button"
                disabled={startingShift || !startPreview}
                onClick={handleConfirmStartShift}
                className="mt-5 w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                {startingShift ? "Сохраняем..." : "Начать смену"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Закончить смену */}
      {endShiftFor?.openShift ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => !endingShift && setEndShiftFor(null)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Закончить смену</h2>
              <p className="mt-1 text-sm text-white/60">
                {endShiftFor.player.admin_display_name || endShiftFor.player.display_name}
              </p>

              <label className="mt-4 block text-xs text-white/50">Пришёл</label>
              <input
                type="datetime-local"
                value={endShiftStartedAt}
                onChange={(e) => setEndShiftStartedAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <label className="mt-3 block text-xs text-white/50">Ушёл</label>
              <input
                type="datetime-local"
                value={endShiftEndedAt}
                onChange={(e) => setEndShiftEndedAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
                {endPreview ? (
                  <>
                    <p className="text-white/70">
                      Отработано: {formatDurationMinutes(endPreview.workedMinutes)}
                    </p>
                    <p className="mt-1 text-white/70">Оплачивается: {endPreview.paidHours} ч</p>
                    {endPreview.amountRub != null ? (
                      <p className="mt-1 font-semibold text-yellow-400">
                        К выплате: {formatRub(endPreview.amountRub)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-white/50">Укажите корректное время окончания позже начала</p>
                )}
              </div>

              <button
                type="button"
                disabled={endingShift || !endPreview}
                onClick={handleConfirmEndShift}
                className="mt-5 w-full rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {endingShift ? "Сохраняем..." : "Завершить смену"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Изменить завершённую смену (Super Admin only) */}
      {isSuperAdminCaller && editingShift ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/70"
          onClick={() => !savingEdit && setEditingShift(null)}
        >
          <section
            className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-lg font-semibold">Изменить смену</h2>
              <p className="mt-1 text-sm text-white/60">{editingShift.dealerDisplayName}</p>

              <label className="mt-4 block text-xs text-white/50">Пришёл</label>
              <input
                type="datetime-local"
                value={editStartedAt}
                onChange={(e) => setEditStartedAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <label className="mt-3 block text-xs text-white/50">Ушёл</label>
              <input
                type="datetime-local"
                value={editEndedAt}
                onChange={(e) => setEditEndedAt(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
              />

              <label className="mt-3 block text-xs text-white/50">Турнир</label>
              <TournamentSelect
                value={editTournamentId}
                onChange={setEditTournamentId}
                tournaments={tournaments}
                loading={tournamentsLoading}
              />

              <div className="mt-3">
                {editingShift.taxiAllowanceRub > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-amber-300">
                      Чай +{editingShift.taxiAllowanceRub} ₽
                    </span>
                    <button
                      type="button"
                      disabled={savingTaxiAllowanceFor === editingShift.id}
                      onClick={() => handleToggleTaxiAllowance(editingShift.id, false)}
                      className="text-xs text-white/40 underline decoration-white/20 underline-offset-2 disabled:opacity-50"
                    >
                      Отменить
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={savingTaxiAllowanceFor === editingShift.id}
                    onClick={() => handleToggleTaxiAllowance(editingShift.id, true)}
                    className="text-xs text-amber-300/80 underline decoration-amber-300/30 underline-offset-2 disabled:opacity-50"
                  >
                    Добавить чай +500 ₽
                  </button>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
                {editPreview ? (
                  <>
                    <p className="text-white/70">
                      Отработано: {formatDurationMinutes(editPreview.workedMinutes)}
                    </p>
                    <p className="mt-1 text-white/70">Оплачивается: {editPreview.paidHours} ч</p>
                    {editPreview.amountRub != null ? (
                      <p className="mt-1 font-semibold text-yellow-400">
                        К выплате: {formatRub(editPreview.amountRub)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-white/50">Укажите корректное время окончания позже начала</p>
                )}
              </div>

              <button
                type="button"
                disabled={savingEdit || !editPreview}
                onClick={handleConfirmEditShift}
                className="mt-5 w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
              >
                {savingEdit ? "Сохраняем..." : "Сохранить"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

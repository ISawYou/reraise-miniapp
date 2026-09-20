"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isStaff, isSuperAdmin } from "@/lib/roles";
import type { Player, Tournament } from "@/types/domain";

const NO_TOURNAMENT_VALUE = "";
const DEFAULT_HISTORICAL_AMOUNT_RUB = 4000;

type AdminShiftSummary = {
  id: string;
  adminPlayerId: string;
  adminDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  amountRub: number;
  tournamentId: string | null;
  tournamentTitle: string | null;
  tournamentDate: string | null;
  updatedByPlayerId: string | null;
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

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

function getPlayerLabel(player: Player) {
  return player.admin_display_name?.trim() || player.display_name;
}

// Recurring tournaments (e.g. CLASSIC) often share a title, so the title
// alone is not enough to tell options apart in the historical-backfill
// selector -- appending the start date disambiguates them. Same
// toLocaleDateString("ru-RU", ...) convention as this codebase's other
// tournament date formatters (app/dealer/page.tsx's, app/tournaments/
// page.tsx's own formatTournamentDate), never manual UTC arithmetic.
function formatTournamentOptionDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function tournamentOptionLabel(tournament: Tournament) {
  return `${tournament.title} — ${formatTournamentOptionDate(tournament.start_at)}`;
}

// Shared bottom-sheet chrome for this page's three sheets (add historical
// shift / correct a completed shift / close an open shift) -- fixes the
// "no reliable way to dismiss" issue: an explicit close (×) button in the
// header, Escape-to-close, and backdrop-click-to-close (unchanged from
// before). The small bar at the top stays purely decorative (never wired
// to a swipe gesture -- no custom gesture system is introduced here), now
// sitting alongside a real close control rather than implying it's the
// only way out. Deliberately scoped to this one page, not a new shared
// modal system used elsewhere.
function BottomSheet({
  title,
  onClose,
  closeDisabled,
  children,
}: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !closeDisabled) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, closeDisabled]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/70"
      onClick={() => !closeDisabled && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-md">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label="Закрыть"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg leading-none text-white/70 disabled:opacity-40"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

// Newest-first, matching this release's "recently completed tournaments
// first" requirement for the historical backfill selector. A native
// <select> is still keyboard-searchable (typing jumps to a matching
// option), so older tournaments stay reachable without a separate search
// UI -- same reasoning the dealer shift tournament <select> already
// relies on.
function completedTournamentsNewestFirst(tournaments: Tournament[]): Tournament[] {
  return tournaments
    .filter((t) => t.status === "completed")
    .slice()
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
}

type ShiftFormValues = {
  adminPlayerId: string;
  tournamentId: string;
  startedAt: string;
  endedAt: string;
  amountRub: string;
};

function ShiftFormFields({
  values,
  onChange,
  staffPlayers,
  tournaments,
  lockAdmin,
}: {
  values: ShiftFormValues;
  onChange: (patch: Partial<ShiftFormValues>) => void;
  staffPlayers: Player[];
  tournaments: Tournament[];
  // Correcting an existing shift never reassigns its owner -- see
  // correctAdminShift's doc comment. The admin selector is shown
  // read-only in that case, never submitted as editable.
  lockAdmin?: string | null;
}) {
  return (
    <>
      <label className="mt-4 block text-xs text-white/50">Администратор</label>
      {lockAdmin ? (
        <p className="mt-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/70">
          {lockAdmin}
        </p>
      ) : (
        <select
          value={values.adminPlayerId}
          onChange={(e) => onChange({ adminPlayerId: e.target.value })}
          className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
        >
          <option value="">Выберите администратора</option>
          {staffPlayers.map((p) => (
            <option key={p.id} value={p.id}>
              {getPlayerLabel(p)}
            </option>
          ))}
        </select>
      )}

      <label className="mt-3 block text-xs text-white/50">Турнир</label>
      <select
        value={values.tournamentId}
        onChange={(e) => onChange({ tournamentId: e.target.value })}
        className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
      >
        <option value={NO_TOURNAMENT_VALUE}>Выберите турнир</option>
        {tournaments.map((t) => (
          <option key={t.id} value={t.id}>
            {tournamentOptionLabel(t)}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs text-white/50">Начало</label>
      <input
        type="datetime-local"
        value={values.startedAt}
        onChange={(e) => onChange({ startedAt: e.target.value })}
        className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
      />

      <label className="mt-3 block text-xs text-white/50">Конец</label>
      <input
        type="datetime-local"
        value={values.endedAt}
        onChange={(e) => onChange({ endedAt: e.target.value })}
        className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
      />

      <label className="mt-3 block text-xs text-white/50">Сумма</label>
      <input
        type="number"
        min="0"
        value={values.amountRub}
        onChange={(e) => onChange({ amountRub: e.target.value })}
        className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
      />
    </>
  );
}

export default function AdminAdminShiftsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [shifts, setShifts] = useState<AdminShiftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [staffPlayers, setStaffPlayers] = useState<Player[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [pickersLoaded, setPickersLoaded] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createValues, setCreateValues] = useState<ShiftFormValues>({
    adminPlayerId: "",
    tournamentId: NO_TOURNAMENT_VALUE,
    startedAt: "",
    endedAt: "",
    amountRub: String(DEFAULT_HISTORICAL_AMOUNT_RUB),
  });
  const [creating, setCreating] = useState(false);

  const [editingShift, setEditingShift] = useState<AdminShiftSummary | null>(null);
  const [editValues, setEditValues] = useState<ShiftFormValues>({
    adminPlayerId: "",
    tournamentId: NO_TOURNAMENT_VALUE,
    startedAt: "",
    endedAt: "",
    amountRub: "",
  });
  const [saving, setSaving] = useState(false);

  // "Завершить смену" -- Super Admin closing another admin's forgotten-
  // open shift. Owner and start time are fixed/read-only here (see
  // closeAdminShiftAsSuperAdmin's doc comment); only tournament, end time,
  // and amount are editable.
  const [closingShift, setClosingShift] = useState<AdminShiftSummary | null>(null);
  const [closeValues, setCloseValues] = useState({
    tournamentId: NO_TOURNAMENT_VALUE,
    endedAt: "",
    amountRub: "",
  });
  const [closing, setClosing] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminJson<{ shifts: AdminShiftSummary[] }>("/api/admin/admin-shifts");
      setShifts(data.shifts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить смены");
    } finally {
      setLoading(false);
    }
  }

  async function ensurePickersLoaded() {
    if (pickersLoaded) return;
    try {
      const [playersData, tournamentsData] = await Promise.all([
        fetchAdminJson<{ players: Player[] }>("/api/admin/nicknames/players"),
        fetchAdminJson<{ tournaments: Tournament[] }>("/api/admin/tournaments?scope=manage"),
      ]);
      setStaffPlayers(playersData.players.filter((p) => isStaff(p.role)));
      setTournaments(completedTournamentsNewestFirst(tournamentsData.tournaments));
      setPickersLoaded(true);
    } catch {
      setError("Не удалось загрузить список администраторов/турниров");
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const currentPlayer = await resolveCurrentPlayer();
        setPlayer(currentPlayer);
        if (isSuperAdmin(currentPlayer?.role)) {
          await load();
        }
      } finally {
        setAccessChecked(true);
      }
    }
    init();
  }, []);

  function openCreate() {
    setShowCreate(true);
    setMessage(null);
    setError(null);
    setCreateValues({
      adminPlayerId: "",
      tournamentId: NO_TOURNAMENT_VALUE,
      startedAt: toDateTimeLocalValue(new Date().toISOString()),
      endedAt: toDateTimeLocalValue(new Date().toISOString()),
      amountRub: String(DEFAULT_HISTORICAL_AMOUNT_RUB),
    });
    void ensurePickersLoaded();
  }

  // Historical backfill only (never edit/close): selecting a tournament
  // prefills BOTH Начало and Конец with its start time, so the common
  // case (a shift tied 1:1 to a tournament) takes as few taps as
  // possible -- the user then only adjusts Конец (and Начало if
  // historically necessary) before pressing "Сохранить смену". Nothing
  // is auto-saved here.
  function handleCreateFieldChange(patch: Partial<ShiftFormValues>) {
    setCreateValues((prev) => {
      const next = { ...prev, ...patch };
      if (patch.tournamentId) {
        const tournament = tournaments.find((t) => t.id === patch.tournamentId);
        if (tournament) {
          const startedAt = toDateTimeLocalValue(tournament.start_at);
          next.startedAt = startedAt;
          next.endedAt = startedAt;
        }
      }
      return next;
    });
  }

  async function handleCreate() {
    if (!createValues.adminPlayerId || !createValues.tournamentId || !createValues.startedAt || !createValues.endedAt) {
      setError("Заполните администратора, турнир, начало и конец смены");
      return;
    }
    const amountRub = Number(createValues.amountRub);
    if (!Number.isInteger(amountRub) || amountRub < 0) {
      setError("Сумма должна быть неотрицательным целым числом");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await fetchAdminJson("/api/admin/admin-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminPlayerId: createValues.adminPlayerId,
          tournamentId: createValues.tournamentId,
          startedAt: fromDateTimeLocalValue(createValues.startedAt),
          endedAt: fromDateTimeLocalValue(createValues.endedAt),
          amountRub,
        }),
      });
      setMessage("Прошлая смена добавлена");
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить смену");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(shift: AdminShiftSummary) {
    setEditingShift(shift);
    setMessage(null);
    setError(null);
    setEditValues({
      adminPlayerId: shift.adminPlayerId,
      tournamentId: shift.tournamentId ?? NO_TOURNAMENT_VALUE,
      startedAt: toDateTimeLocalValue(shift.startedAt),
      endedAt: shift.endedAt ? toDateTimeLocalValue(shift.endedAt) : toDateTimeLocalValue(new Date().toISOString()),
      amountRub: String(shift.amountRub),
    });
    void ensurePickersLoaded();
  }

  async function handleSaveEdit() {
    if (!editingShift) return;
    if (!editValues.startedAt || !editValues.endedAt) {
      setError("Укажите начало и конец смены");
      return;
    }
    const amountRub = Number(editValues.amountRub);
    if (!Number.isInteger(amountRub) || amountRub < 0) {
      setError("Сумма должна быть неотрицательным целым числом");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/admin-shifts/${editingShift.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentId: editValues.tournamentId || null,
          startedAt: fromDateTimeLocalValue(editValues.startedAt),
          endedAt: fromDateTimeLocalValue(editValues.endedAt),
          amountRub,
        }),
      });
      setMessage("Смена изменена");
      setEditingShift(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить смену");
    } finally {
      setSaving(false);
    }
  }

  function openClose(shift: AdminShiftSummary) {
    setClosingShift(shift);
    setMessage(null);
    setError(null);
    // Defaults per this feature's own spec: end time = now, tournament =
    // whatever is already linked (if any), amount = the shift's current
    // stored value -- never today's global default.
    setCloseValues({
      tournamentId: shift.tournamentId ?? NO_TOURNAMENT_VALUE,
      endedAt: toDateTimeLocalValue(new Date().toISOString()),
      amountRub: String(shift.amountRub),
    });
    void ensurePickersLoaded();
  }

  async function handleCloseShift() {
    if (!closingShift) return;
    if (!closeValues.endedAt) {
      setError("Укажите время окончания");
      return;
    }
    const amountRub = Number(closeValues.amountRub);
    if (!Number.isInteger(amountRub) || amountRub < 0) {
      setError("Сумма должна быть неотрицательным целым числом");
      return;
    }

    setClosing(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/admin-shifts/${closingShift.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endedAt: fromDateTimeLocalValue(closeValues.endedAt),
          tournamentId: closeValues.tournamentId || null,
          amountRub,
        }),
      });
      setMessage("Смена завершена");
      setClosingShift(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось завершить смену");
    } finally {
      setClosing(false);
    }
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
              Эта страница доступна только супер-администратору.
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
          <h1 className="text-2xl font-bold">Смены администраторов</h1>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black"
          >
            Добавить прошлую смену
          </button>
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
        ) : shifts.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Смен пока нет
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            {shifts.map((shift) => {
              const isOpen = shift.endedAt === null;
              return (
                <div
                  key={shift.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{shift.adminDisplayName}</p>
                      <p className="mt-0.5 text-xs text-white/50">
                        {formatDateTime(shift.startedAt)} — {shift.endedAt ? formatDateTime(shift.endedAt) : "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-white/35">{shift.tournamentTitle ?? "Без турнира"}</p>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isOpen ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"
                        }`}
                      >
                        {isOpen ? "Открыта" : "Завершена"}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-white">{formatRub(shift.amountRub)}</p>
                      {isOpen ? (
                        // An open shift is never routed into the
                        // completed-shift correction flow (which rejects
                        // it) -- this is the dedicated close action.
                        <button
                          type="button"
                          onClick={() => openClose(shift)}
                          className="mt-1 text-xs font-medium text-emerald-300 underline decoration-emerald-300/30 underline-offset-2"
                        >
                          Завершить смену
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEdit(shift)}
                          className="mt-1 text-xs font-medium text-yellow-400 underline decoration-yellow-400/30 underline-offset-2"
                        >
                          Изменить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Добавить прошлую смену */}
      {showCreate ? (
        <BottomSheet
          title="Добавить прошлую смену"
          onClose={() => setShowCreate(false)}
          closeDisabled={creating}
        >
          <p className="mt-1 text-xs text-white/45">
            Смена сразу сохраняется завершённой — для восстановления исторических данных.
          </p>

          <ShiftFormFields
            values={createValues}
            onChange={handleCreateFieldChange}
            staffPlayers={staffPlayers}
            tournaments={tournaments}
          />

          <button
            type="button"
            disabled={creating}
            onClick={handleCreate}
            className="mt-5 w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
          >
            {creating ? "Сохраняем..." : "Сохранить смену"}
          </button>
        </BottomSheet>
      ) : null}

      {/* Изменить смену (только завершённые) */}
      {editingShift ? (
        <BottomSheet
          title="Изменить смену"
          onClose={() => setEditingShift(null)}
          closeDisabled={saving}
        >
          <ShiftFormFields
            values={editValues}
            onChange={(patch) => setEditValues((prev) => ({ ...prev, ...patch }))}
            staffPlayers={staffPlayers}
            tournaments={tournaments}
            lockAdmin={editingShift.adminDisplayName}
          />

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveEdit}
            className="mt-5 w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>
        </BottomSheet>
      ) : null}

      {/* Завершить смену (только открытые) -- владелец и время начала
          зафиксированы и показаны только для справки. */}
      {closingShift ? (
        <BottomSheet
          title="Завершить смену"
          onClose={() => setClosingShift(null)}
          closeDisabled={closing}
        >
          <label className="mt-4 block text-xs text-white/50">Администратор</label>
          <p className="mt-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/70">
            {closingShift.adminDisplayName}
          </p>

          <label className="mt-3 block text-xs text-white/50">Начало</label>
          <p className="mt-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/70">
            {formatDateTime(closingShift.startedAt)}
          </p>

          <label className="mt-3 block text-xs text-white/50">Турнир</label>
          <select
            value={closeValues.tournamentId}
            onChange={(e) => setCloseValues((prev) => ({ ...prev, tournamentId: e.target.value }))}
            className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
          >
            <option value={NO_TOURNAMENT_VALUE}>Без турнира</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {tournamentOptionLabel(t)}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs text-white/50">Конец</label>
          <input
            type="datetime-local"
            value={closeValues.endedAt}
            onChange={(e) => setCloseValues((prev) => ({ ...prev, endedAt: e.target.value }))}
            className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
          />

          <label className="mt-3 block text-xs text-white/50">Сумма</label>
          <input
            type="number"
            min="0"
            value={closeValues.amountRub}
            onChange={(e) => setCloseValues((prev) => ({ ...prev, amountRub: e.target.value }))}
            className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
          />

          <button
            type="button"
            disabled={closing}
            onClick={handleCloseShift}
            className="mt-5 w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-black disabled:opacity-60"
          >
            {closing ? "Сохраняем..." : "Завершить смену"}
          </button>
        </BottomSheet>
      ) : null}
    </main>
  );
}

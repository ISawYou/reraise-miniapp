"use client";

import { useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

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

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatRub(amount: number) {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

// Super-Admin-only management view of ALL admin shifts -- view + explicit
// amount correction (trainee shift, shortened shift, exceptional payout).
// An operator can never reach this page's data: GET /api/admin/admin-shifts
// and PATCH /api/admin/admin-shifts/:id are both NOT on the operator
// allowlist (lib/admin-permissions.ts), so middleware.ts denies them
// outright regardless of this page's own client-side gate below.
export default function AdminAdminShiftsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [shifts, setShifts] = useState<AdminShiftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [saving, setSaving] = useState(false);

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

  function openEdit(shift: AdminShiftSummary) {
    setEditingId(shift.id);
    setAmountDraft(String(shift.amountRub));
  }

  async function saveAmount(shiftId: string) {
    const value = Number(amountDraft);
    if (!Number.isInteger(value) || value < 0) {
      setError("Сумма должна быть неотрицательным целым числом");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchAdminJson(`/api/admin/admin-shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountRub: value }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить сумму");
    } finally {
      setSaving(false);
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
        <h1 className="text-2xl font-bold">Смены администраторов</h1>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
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
            {shifts.map((shift) => (
              <div
                key={shift.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{shift.adminDisplayName}</p>
                    <p className="mt-0.5 text-xs text-white/50">
                      {formatDateTime(shift.startedAt)} — {shift.endedAt ? formatDateTime(shift.endedAt) : "открыта"}
                    </p>
                    <p className="mt-0.5 text-xs text-white/35">{shift.tournamentTitle ?? "Без турнира"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {editingId === shift.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          value={amountDraft}
                          onChange={(e) => setAmountDraft(e.target.value)}
                          className="h-8 w-24 rounded-md border border-white/15 bg-black/40 px-2 text-sm outline-none"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveAmount(shift.id)}
                          className="text-xs font-semibold text-yellow-400 disabled:opacity-50"
                        >
                          Ок
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-xs text-white/50">
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEdit(shift)}
                        className="text-sm font-semibold text-yellow-400 underline decoration-yellow-400/30 underline-offset-2"
                      >
                        {formatRub(shift.amountRub)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

type SeasonRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
};

type ResyncResult = {
  checked: number;
  reassigned: number;
  reassignments: Array<{ tournamentId: string; fromSeasonId: string | null; toSeasonId: string }>;
  unresolved: Array<{ tournamentId: string; reason: string }>;
};

function statusLabel(season: SeasonRow, seasons: SeasonRow[]) {
  if (season.is_active) return "Активный";
  // "Закрытый" (finalized) vs "Будущий" (not yet started) -- both are
  // simply is_active=false, distinguished only by chronological position
  // relative to the active season (if any).
  const active = seasons.find((s) => s.is_active);
  if (active && season.start_date > active.start_date) return "Будущий";
  return "Закрытый";
}

export default function AdminSeasonsPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createStart, setCreateStart] = useState("");
  const [createEnd, setCreateEnd] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const [rolloverFor, setRolloverFor] = useState<string | null>(null);
  const [rolloverNextId, setRolloverNextId] = useState("");

  async function loadSeasons() {
    const data = await fetchAdminJson<{ seasons: SeasonRow[] }>("/api/admin/seasons");
    setSeasons(data.seasons);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);
        if (ensuredPlayer.role === "admin") {
          await loadSeasons();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки сезонов");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }
    loadPage();
  }, []);

  function describeResync(resync: ResyncResult) {
    if (resync.reassigned === 0 && resync.unresolved.length === 0) return "";
    const parts = [`переназначено турниров: ${resync.reassigned}`];
    if (resync.unresolved.length > 0) {
      parts.push(`не удалось определить сезон для ${resync.unresolved.length} турниров`);
    }
    return ` (${parts.join(", ")})`;
  }

  async function handleCreate() {
    if (!createTitle.trim() || !createStart) {
      setError("Укажите название и дату начала");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchAdminJson<{ season: SeasonRow; resync: ResyncResult }>(
        "/api/admin/seasons",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: createTitle.trim(),
            start_date: createStart,
            end_date: createEnd || null,
          }),
        }
      );
      setMessage(`Сезон "${data.season.title}" создан${describeResync(data.resync)}`);
      setCreateTitle("");
      setCreateStart("");
      setCreateEnd("");
      setShowCreate(false);
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сезон");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(season: SeasonRow) {
    setEditingId(season.id);
    setEditTitle(season.title);
    setEditStart(season.start_date);
    setEditEnd(season.end_date ?? "");
    setMessage(null);
    setError(null);
  }

  async function handleSaveEdit(seasonId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchAdminJson<{ season: SeasonRow; resync: ResyncResult }>(
        `/api/admin/seasons/${seasonId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle.trim(),
            start_date: editStart,
            end_date: editEnd || null,
          }),
        }
      );
      setMessage(`Сезон "${data.season.title}" обновлён${describeResync(data.resync)}`);
      setEditingId(null);
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить сезон");
    } finally {
      setBusy(false);
    }
  }

  async function handleResync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchAdminJson<ResyncResult>("/api/admin/seasons/resync", { method: "POST" });
      setMessage(
        `Проверено турниров: ${data.checked}, переназначено: ${data.reassigned}` +
          (data.unresolved.length > 0 ? `, без сезона: ${data.unresolved.length}` : "")
      );
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить пересчёт");
    } finally {
      setBusy(false);
    }
  }

  async function handleRollover(currentSeasonId: string) {
    if (!rolloverNextId) {
      setError("Выберите следующий сезон");
      return;
    }
    if (
      !confirm(
        "Завершить текущий сезон и активировать следующий? Будет определён Number One (если нет ничьей за 1-е место)."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchAdminJson<{ status: string }>(
        `/api/admin/seasons/${currentSeasonId}/rollover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nextSeasonId: rolloverNextId }),
        }
      );
      setMessage(`Переход выполнен: ${data.status}`);
      setRolloverFor(null);
      setRolloverNextId("");
      await loadSeasons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить переход сезона");
    } finally {
      setBusy(false);
    }
  }

  const sortedSeasons = useMemo(
    () => [...seasons].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [seasons]
  );
  const activeSeason = sortedSeasons.find((s) => s.is_active) ?? null;
  const inactiveFutureSeasons = activeSeason
    ? sortedSeasons.filter((s) => !s.is_active && s.start_date > activeSeason.start_date)
    : [];

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем сезоны...</p>
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
              Управление сезонами доступно только Супер-администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" className="mb-4" />

        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Сезоны</h1>
          <button
            type="button"
            onClick={handleResync}
            disabled={busy}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 disabled:opacity-50"
          >
            Пересчитать предстоящие турниры
          </button>
        </div>
        <p className="mt-2 text-sm text-white/70">
          Даты сезонов видны только администраторам. Игрокам показывается только название сезона.
        </p>

        {message ? (
          <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {sortedSeasons.map((season) => (
            <div key={season.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              {editingId === season.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      type="date"
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      placeholder="без даты окончания"
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSaveEdit(season.id)}
                      className="rounded-lg bg-yellow-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{season.title}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {season.start_date} — {season.end_date ?? "открытый диапазон"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        season.is_active
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/10 text-white/60"
                      }`}
                    >
                      {statusLabel(season, sortedSeasons)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(season)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70"
                    >
                      Редактировать
                    </button>
                    {season.is_active ? (
                      <button
                        type="button"
                        onClick={() => setRolloverFor(rolloverFor === season.id ? null : season.id)}
                        className="rounded-lg border border-yellow-500/30 px-3 py-2 text-xs text-yellow-300"
                      >
                        Завершить и перейти к следующему
                      </button>
                    ) : null}
                    {!season.is_active && statusLabel(season, sortedSeasons) === "Закрытый" ? (
                      <Link
                        href={`/admin/seasons/${season.id}/recap`}
                        className="rounded-lg border border-[#d7b55a]/30 px-3 py-2 text-xs text-[#f0d38a]"
                      >
                        Итоги сезона
                      </Link>
                    ) : null}
                  </div>

                  {rolloverFor === season.id ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
                      <label className="block text-xs text-white/60">Следующий сезон</label>
                      <select
                        value={rolloverNextId}
                        onChange={(e) => setRolloverNextId(e.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none"
                      >
                        <option value="">Выберите сезон</option>
                        {inactiveFutureSeasons.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRollover(season.id)}
                        className="mt-2 w-full rounded-lg bg-yellow-500 py-2 text-xs font-semibold text-black disabled:opacity-60"
                      >
                        Подтвердить переход
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          {showCreate ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold text-white/80">Новый сезон</h2>
              <input
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Например, Осень 2026"
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
              />
              <div className="mt-2 flex gap-2">
                <input
                  type="date"
                  value={createStart}
                  onChange={(e) => setCreateStart(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                />
                <input
                  type="date"
                  value={createEnd}
                  onChange={(e) => setCreateEnd(e.target.value)}
                  placeholder="без даты окончания"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleCreate}
                  className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                >
                  Создать
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full rounded-xl border border-white/10 py-3 text-sm text-white/70"
            >
              + Добавить сезон
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

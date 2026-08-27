"use client";

import { useEffect, useMemo, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

type RatingEligibilityPlayerRow = {
  playerId: string;
  displayName: string;
  username: string | null;
  points: number;
  excluded: boolean;
  reason: string | null;
};

const REASON_PRESETS = ["Владелец", "Дилер на финале", "Другое"];

export default function AdminRatingEligibilityPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [seasonTitle, setSeasonTitle] = useState("");
  const [players, setPlayers] = useState<RatingEligibilityPlayerRow[]>([]);
  const [search, setSearch] = useState("");
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [reasonDraftFor, setReasonDraftFor] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");

  async function loadPlayers() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminJson<{ season: { id: string; title: string }; players: RatingEligibilityPlayerRow[] }>(
        "/api/admin/rating-eligibility"
      );
      setSeasonTitle(data.season.title);
      setPlayers(data.players);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить список игроков");
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
          await loadPlayers();
        }
      } catch {
        // resolveCurrentPlayer failure -> access gate below shows "not admin".
      } finally {
        setAccessChecked(true);
      }
    }
    init();
  }, []);

  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = players.slice().sort((a, b) => b.points - a.points);
    if (!query) return sorted.slice(0, 100);
    return sorted
      .filter(
        (p) =>
          p.displayName.toLowerCase().includes(query) ||
          (p.username ?? "").toLowerCase().includes(query)
      )
      .slice(0, 100);
  }, [players, search]);

  async function applyExclusion(playerId: string, excluded: boolean, reason: string | null) {
    setSavingPlayerId(playerId);
    setError(null);
    setMessage(null);
    try {
      await fetchAdminJson("/api/admin/rating-eligibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, excluded, reason }),
      });
      setPlayers((prev) =>
        prev.map((p) => (p.playerId === playerId ? { ...p, excluded, reason: excluded ? reason : null } : p))
      );
      setMessage(excluded ? "Игрок переведён «Вне зачёта»" : "Игрок возвращён «В зачёт»");
      setReasonDraftFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить статус зачёта");
    } finally {
      setSavingPlayerId(null);
    }
  }

  function handleMarkExcluded(playerId: string) {
    setReasonDraftFor(playerId);
    setReasonDraft(REASON_PRESETS[0]);
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

        <h1 className="text-2xl font-bold">Зачёт рейтинга</h1>
        <p className="mt-1 text-sm text-white/50">
          Сезон: {seasonTitle || "—"}. «Вне зачёта» — игрок продолжает зарабатывать рейтинговые очки, но не занимает
          место в ТОП-9 и не может стать Number One этого сезона.
        </p>

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

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по нику или имени"
          className="mt-6 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm outline-none"
        />

        {loading ? (
          <p className="mt-6 text-sm text-white/70">Загружаем...</p>
        ) : filteredPlayers.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
            Никого не найдено
          </div>
        ) : (
          <div className="mt-6 space-y-2">
            {filteredPlayers.map((p) => (
              <div
                key={p.playerId}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{p.displayName}</p>
                    <p className="mt-0.5 text-xs text-white/45">
                      {p.username ? `@${p.username}` : "без username"} · {p.points} очков
                      {p.excluded && p.reason ? ` · ${p.reason}` : ""}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {p.excluded ? (
                      <button
                        type="button"
                        disabled={savingPlayerId === p.playerId}
                        onClick={() => applyExclusion(p.playerId, false, null)}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 disabled:opacity-50"
                      >
                        {savingPlayerId === p.playerId ? "..." : "В зачёте"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={savingPlayerId === p.playerId}
                        onClick={() => handleMarkExcluded(p.playerId)}
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/70 disabled:opacity-50"
                      >
                        {savingPlayerId === p.playerId ? "..." : "Вне зачёта"}
                      </button>
                    )}
                  </div>
                </div>

                {reasonDraftFor === p.playerId ? (
                  <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
                    <select
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      className="h-9 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 text-xs outline-none"
                    >
                      {REASON_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={savingPlayerId === p.playerId}
                      onClick={() => applyExclusion(p.playerId, true, reasonDraft)}
                      className="rounded-lg bg-yellow-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
                    >
                      Подтвердить
                    </button>
                    <button
                      type="button"
                      onClick={() => setReasonDraftFor(null)}
                      className="text-xs text-white/50"
                    >
                      Отмена
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

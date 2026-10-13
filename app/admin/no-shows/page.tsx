"use client";

import { useCallback, useEffect, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { isStaff } from "@/lib/roles";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import {
  allowPlayerOrdinaryRegistration,
  getAdminNoShowPlayers,
} from "@/features/no-show-admin-actions";
import type { NoShowPlayerSummary } from "@/features/tournament-no-show";
import type { Player } from "@/types/domain";

// "Неявки игроков" -- staff (admin|operator) overview of players with a
// no-show history, and the manual "Разрешить обычную запись" unblock.
//
// "Разрешить обычную запись" is FUTURE registration policy only: it clears
// the player's online-registration restriction and nothing else -- no-show
// history stays (the count does not change), results are untouched, and no
// current tournament admission happens (a quarantined "Не пришли" row stays
// quarantined; "Допустить в игру" on the tournament screen is the separate
// in-person action). The role check below is UX only; both Server Actions
// enforce admin|operator server-side.

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function NoShowPlayerCard({
  player,
  busy,
  onAllow,
}: {
  player: NoShowPlayerSummary;
  busy: boolean;
  onAllow: (player: NoShowPlayerSummary) => void;
}) {
  const avatarUrl = getPlayerAvatarUrl({
    display_name: player.nickname,
    custom_avatar_url: player.custom_avatar_url ?? undefined,
    telegram_avatar_url: player.telegram_avatar_url ?? undefined,
  });
  const avatarFallback = getPlayerAvatarFallback({ display_name: player.nickname });
  const lastNoShow = formatDate(player.last_no_show_at);

  return (
    <div
      data-testid={`no-show-player-${player.player_id}`}
      className="flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={player.nickname}
            className="h-9 w-9 flex-shrink-0 rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80">
            {avatarFallback}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="whitespace-normal break-words text-sm font-medium leading-snug text-white [overflow-wrap:anywhere]">
            {player.nickname}
          </p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <span
              data-testid="no-show-total"
              className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/60"
            >
              Неявок: {player.no_show_count}
            </span>
            {lastNoShow ? (
              <span className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/60">
                Последняя: {lastNoShow}
              </span>
            ) : null}
            {player.online_registration_restricted ? (
              <span
                data-testid="restriction-badge"
                className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-200"
              >
                ⚠ Запись только в лист ожидания
              </span>
            ) : (
              <span
                data-testid="no-restriction-badge"
                className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-200"
              >
                Обычная запись
              </span>
            )}
          </div>
        </div>
      </div>
      {player.online_registration_restricted ? (
        <div className="flex w-full sm:w-auto sm:flex-shrink-0">
          <button
            type="button"
            onClick={() => onAllow(player)}
            disabled={busy}
            className="min-h-10 flex-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-400/50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:flex-none sm:py-1.5 sm:text-xs"
          >
            Разрешить обычную запись
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminNoShowsPage() {
  const [viewer, setViewer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [players, setPlayers] = useState<NoShowPlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<NoShowPlayerSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPlayers = useCallback(async () => {
    setPlayers(await getAdminNoShowPlayers());
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const current = await resolveCurrentPlayer();
        setViewer(current);
        setAccessChecked(true);
        if (!isStaff(current?.role)) {
          return;
        }
        await loadPlayers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить неявки");
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }
    load();
  }, [loadPlayers]);

  async function handleConfirmAllow() {
    if (!candidate) return;
    const target = candidate;
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const result = await allowPlayerOrdinaryRegistration(target.player_id);
      setCandidate(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await loadPlayers();
      setMessage(`${target.nickname}: обычная запись разрешена. История неявок сохранена.`);
    } catch (err) {
      setCandidate(null);
      setError(err instanceof Error ? err.message : "Не удалось снять ограничение");
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

  if (!isStaff(viewer?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/" className="mb-4" />
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

  const restrictedCount = players.filter((p) => p.online_registration_restricted).length;

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <BackButton href="/admin" className="mb-4" />
        <h1 className="text-2xl font-bold">Неявки игроков</h1>
        <p className="mt-2 text-sm text-white/60">
          Игроки с отметкой «Не пришёл». Ограниченные игроки могут записываться
          самостоятельно только в лист ожидания.
        </p>

        {message ? (
          <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <section className="mt-5" aria-label="Неявки игроков">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">
            Игроков{" "}
            <span data-testid="no-show-players-count" className="text-white">
              {players.length}
            </span>
            {" · "}с ограничением{" "}
            <span data-testid="restricted-players-count" className="text-white">
              {restrictedCount}
            </span>
          </h2>
          <div
            data-testid="no-show-players"
            className="mt-2 divide-y divide-white/10 rounded-lg border border-white/10 bg-black/20"
          >
            {loading ? (
              <div className="px-3 py-4 text-sm text-white/60">Загрузка...</div>
            ) : players.length === 0 ? (
              <div className="px-3 py-4 text-sm text-white/60">Неявок нет</div>
            ) : (
              players.map((player) => (
                <NoShowPlayerCard
                  key={player.player_id}
                  player={player}
                  busy={saving}
                  onAllow={setCandidate}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {candidate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="allow-registration-title"
            className="w-full max-w-sm rounded-xl border border-white/10 bg-neutral-900 p-4"
          >
            <h2 id="allow-registration-title" className="text-base font-semibold text-white">
              Снять ограничение на самостоятельную запись?
            </h2>
            <p className="mt-3 text-sm text-white/70">
              {candidate.nickname} снова сможет записываться на турниры как обычно. История
              неявок сохранится.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCandidate(null)}
                disabled={saving}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmAllow}
                disabled={saving}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:opacity-50"
              >
                {saving ? "Сохраняем..." : "Разрешить обычную запись"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

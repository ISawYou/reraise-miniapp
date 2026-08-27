"use client";

import { useEffect, useMemo, useState } from "react";
import { BackButton } from "@/components/ui/back-button";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { isSuperAdmin, ROLE_LABELS } from "@/lib/roles";
import type { Player, PlayerRole } from "@/types/domain";

const ASSIGNABLE_ROLES: PlayerRole[] = ["player", "operator", "admin"];

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

export default function AdminRolesPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);

  async function loadPlayers() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminJson<{ players: Player[] }>("/api/admin/roles");
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
    if (!query) return players.slice(0, 100);
    return players
      .filter(
        (p) =>
          (p.display_name ?? "").toLowerCase().includes(query) ||
          (p.admin_display_name ?? "").toLowerCase().includes(query) ||
          (p.username ?? "").toLowerCase().includes(query)
      )
      .slice(0, 100);
  }, [players, search]);

  async function handleChangeRole(targetPlayerId: string, newRole: PlayerRole) {
    setSavingPlayerId(targetPlayerId);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchAdminJson<{ player: Player }>("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: targetPlayerId, role: newRole }),
      });
      setPlayers((prev) => prev.map((p) => (p.id === targetPlayerId ? data.player : p)));
      setMessage(
        `${data.player.admin_display_name || data.player.display_name}: роль изменена на «${ROLE_LABELS[newRole]}»`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить роль");
    } finally {
      setSavingPlayerId(null);
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

        <h1 className="text-2xl font-bold">Роли и доступы</h1>
        <p className="mt-1 text-sm text-white/50">
          Игрок → обычный доступ. Администратор → операционные функции турнирного дня.
          Супер-администратор → полный доступ без ограничений.
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
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PlayerAvatar player={p} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {p.admin_display_name || p.display_name}
                    </p>
                    <p className="mt-0.5 text-xs text-white/45">
                      {p.username ? `@${p.username}` : "без username"} · {ROLE_LABELS[p.role]}
                    </p>
                  </div>
                </div>

                <select
                  value={p.role}
                  disabled={savingPlayerId === p.id}
                  onChange={(e) => handleChangeRole(p.id, e.target.value as PlayerRole)}
                  className="h-9 shrink-0 rounded-lg border border-white/10 bg-black/40 px-2 text-xs outline-none disabled:opacity-50"
                >
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

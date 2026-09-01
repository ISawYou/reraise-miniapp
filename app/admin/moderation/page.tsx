"use client";

import { BackButton } from "@/components/ui/back-button";
import { useEffect, useMemo, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { fetchAdminJson } from "@/lib/client-request";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { isStaff, isSuperAdmin } from "@/lib/roles";
import type { Player } from "@/types/domain";

function getVisibleNickname(player: Player) {
  return player.admin_display_name?.trim() || player.display_name;
}

export default function AdminModerationPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [pendingPlayers, setPendingPlayers] = useState<Player[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdminCaller = isSuperAdmin(player?.role);

  // Operator only ever needs the pending-approval queue -- the player
  // catalog (edit admin nickname, block/delete/unblock) is Super-Admin-only
  // functionality, so it's not even fetched for a non-admin caller.
  async function loadModerationData(actingAsSuperAdmin: boolean) {
    if (!actingAsSuperAdmin) {
      const pendingPayload = await fetchAdminJson<{ players: Player[] }>(
        "/api/admin/nicknames/pending",
      );
      setPendingPlayers(pendingPayload.players);
      return;
    }

    const [pendingPayload, playersPayload] = await Promise.all([
      fetchAdminJson<{ players: Player[] }>("/api/admin/nicknames/pending"),
      fetchAdminJson<{ players: Player[] }>("/api/admin/nicknames/players"),
    ]);

    setPendingPlayers(pendingPayload.players);
    setPlayers(playersPayload.players);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const ensuredPlayer = await resolveCurrentPlayer();
        setPlayer(ensuredPlayer);

        if (isStaff(ensuredPlayer.role)) {
          await loadModerationData(ensuredPlayer.role === "admin");
        }
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки модерации";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  const filteredPlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const sortedPlayers = [...players].sort((a, b) =>
      getVisibleNickname(a).localeCompare(getVisibleNickname(b), "ru")
    );

    if (!query) {
      return sortedPlayers.slice(0, 80);
    }

    return sortedPlayers.filter((targetPlayer) => {
      const username = (targetPlayer.username ?? "").toLowerCase();
      const displayName = targetPlayer.display_name.toLowerCase();
      const adminDisplayName = (targetPlayer.admin_display_name ?? "").toLowerCase();

      return (
        username.includes(query) ||
        displayName.includes(query) ||
        adminDisplayName.includes(query)
      );
    });
  }, [players, searchQuery]);

  const visiblePlayersCount = searchQuery.trim()
    ? filteredPlayers.length
    : Math.min(players.length, 80);

  async function handleApprove(playerId: string) {
    try {
      setProcessingKey(`approve-${playerId}`);
      setMessage(null);
      setError(null);

      // Narrow, approve-only endpoint -- no body to send, it always applies
      // pending_display_name exactly as submitted (see
      // app/api/admin/nicknames/[id]/approve/route.ts). Operator and Super
      // Admin both use this one path now.
      await fetchAdminJson<{ player: Player }>(`/api/admin/nicknames/${playerId}/approve`, {
        method: "PATCH",
      });

      await loadModerationData(isSuperAdminCaller);
      setMessage("Ник одобрен");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка одобрения ника";
      setError(nextMessage);
    } finally {
      setProcessingKey(null);
    }
  }

  async function handleReject(playerId: string) {
    try {
      setProcessingKey(`reject-${playerId}`);
      setMessage(null);
      setError(null);

      await fetchAdminJson<{ player: Player }>(`/api/admin/nicknames/${playerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reject",
        }),
      });

      await loadModerationData(isSuperAdminCaller);
      setMessage("Ник отклонен");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка отклонения ника";
      setError(nextMessage);
    } finally {
      setProcessingKey(null);
    }
  }

  function handleStartEdit(targetPlayer: Player) {
    setEditingPlayerId(targetPlayer.id);
    setDraftNames((currentDrafts) => ({
      ...currentDrafts,
      [targetPlayer.id]: targetPlayer.admin_display_name ?? targetPlayer.display_name,
    }));
    setMessage(null);
    setError(null);
  }

  async function handleToggleBlock(targetPlayer: Player) {
    const nextBlocked = !targetPlayer.is_blocked;
    const nickname = getVisibleNickname(targetPlayer);

    if (nextBlocked && !confirm(`Заблокировать игрока '${nickname}'? Он потеряет доступ к приложению.`)) {
      return;
    }

    try {
      setProcessingKey(`block-${targetPlayer.id}`);
      setMessage(null);
      setError(null);

      const { player: updatedPlayer } = await fetchAdminJson<{ player: Player }>(
        `/api/admin/players/${targetPlayer.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: nextBlocked ? "block" : "unblock" }),
        }
      );

      setPlayers((prev) =>
        prev.map((p) => (p.id === updatedPlayer.id ? updatedPlayer : p))
      );
      setMessage(nextBlocked ? "Игрок заблокирован" : "Игрок разблокирован");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка изменения статуса блокировки");
    } finally {
      setProcessingKey(null);
    }
  }

  async function handleDeleteManualPlayer(targetPlayer: Player) {
    const nickname = getVisibleNickname(targetPlayer);
    const confirmMessage = targetPlayer.telegram_id
      ? `Удалить Telegram-игрока '${nickname}' и ВСЕ связанные данные? Это действие нельзя отменить.`
      : `Удалить manual-игрока '${nickname}' и все связанные данные?`;

    if (!confirm(confirmMessage)) return;
    try {
      setProcessingKey(`delete-${targetPlayer.id}`);
      setMessage(null);
      setError(null);
      await fetchAdminJson(`/api/admin/players/${targetPlayer.id}`, { method: "DELETE" });
      setPlayers((prev) => prev.filter((p) => p.id !== targetPlayer.id));
      setMessage("Игрок удалён");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setProcessingKey(null);
    }
  }

  async function handleSaveAdminName(playerId: string) {
    try {
      setProcessingKey(`save-${playerId}`);
      setMessage(null);
      setError(null);

      await fetchAdminJson<{ player: Player }>(`/api/admin/nicknames/${playerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "set_admin_display_name",
          admin_display_name: draftNames[playerId] ?? "",
        }),
      });

      await loadModerationData(isSuperAdminCaller);
      setEditingPlayerId(null);
      setMessage("Админский ник сохранен");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка сохранения админского ника";
      setError(nextMessage);
    } finally {
      setProcessingKey(null);
    }
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-white/70">Загружаем модерацию ников...</p>
        </div>
      </main>
    );
  }

  if (!isStaff(player?.role)) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-4xl">
          <BackButton href="/admin" className="mb-4" />

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h1 className="text-xl font-semibold">Доступ запрещен</h1>
            <p className="mt-2 text-sm text-white/70">
              Эта страница доступна только администратору.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-4xl">
        <BackButton href="/admin" className="mb-4" />

        <h1 className="text-2xl font-bold">Модерация ников</h1>
        <p className="mt-2 text-sm text-white/70">
          Заявки на смену ника и внутренние админские имена игроков.
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

        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Заявки на модерации</h2>
            <span className="text-sm text-white/45">{pendingPlayers.length}</span>
          </div>

          {pendingPlayers.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Сейчас нет ников на модерации.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {pendingPlayers.map((pendingPlayer) => {
                const approveKey = `approve-${pendingPlayer.id}`;
                const rejectKey = `reject-${pendingPlayer.id}`;
                const isProcessing =
                  processingKey === approveKey || processingKey === rejectKey;

                return (
                  <div
                    key={pendingPlayer.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {getVisibleNickname(pendingPlayer)}
                        </p>
                        {pendingPlayer.username ? (
                          <p className="mt-1 text-xs text-white/45">
                            @{pendingPlayer.username}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm text-yellow-300">
                          Новый ник: {pendingPlayer.pending_display_name}
                        </p>
                      </div>

                      <div
                        className={
                          isSuperAdminCaller
                            ? "grid shrink-0 grid-cols-2 gap-2"
                            : "shrink-0"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => handleApprove(pendingPlayer.id)}
                          disabled={isProcessing}
                          className="rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
                        >
                          {processingKey === approveKey ? "..." : "Одобрить"}
                        </button>
                        {/* Reject stays Super-Admin-only -- operator only
                            gets "approve the submitted nickname as-is". */}
                        {isSuperAdminCaller ? (
                          <button
                            type="button"
                            onClick={() => handleReject(pendingPlayer.id)}
                            disabled={isProcessing}
                            className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {processingKey === rejectKey ? "..." : "Нет"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Player catalog (edit admin nickname, block/delete/unblock) is
            Super-Admin-only -- operator gets nothing beyond the pending
            queue above. */}
        {isSuperAdminCaller ? (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Каталог игроков</h2>
              <p className="mt-1 text-sm text-white/55">
                Админский ник видит только администратор.
              </p>
            </div>
            <span className="text-sm text-white/45">
              {visiblePlayersCount} из {players.length}
            </span>
          </div>

          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск по @username, нику или админскому имени"
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
          />

          {!searchQuery.trim() ? (
            <p className="mt-2 text-xs text-white/45">
              Показаны первые 80 игроков. Для точного поиска начните вводить ник.
            </p>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {filteredPlayers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Ничего не найдено.</div>
            ) : (
              filteredPlayers.map((targetPlayer) => {
                const avatarUrl = getPlayerAvatarUrl(targetPlayer);
                const avatarFallback = getPlayerAvatarFallback(targetPlayer);
                const isEditing = editingPlayerId === targetPlayer.id;
                const saveKey = `save-${targetPlayer.id}`;

                return (
                  <div
                    key={targetPlayer.id}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-4 py-3 last:border-b-0"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={targetPlayer.display_name}
                        className="h-10 w-10 rounded-full border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white/80">
                        {avatarFallback}
                      </div>
                    )}

                    <div className="min-w-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={draftNames[targetPlayer.id] ?? ""}
                          onChange={(event) =>
                            setDraftNames((currentDrafts) => ({
                              ...currentDrafts,
                              [targetPlayer.id]: event.target.value,
                            }))
                          }
                          placeholder={targetPlayer.display_name}
                          className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                        />
                      ) : (
                        <div className="text-sm">
                          <p className="truncate font-semibold text-white">
                            {getVisibleNickname(targetPlayer)}
                          </p>
                          {targetPlayer.username ? (
                            <p className="mt-1 truncate text-xs text-white/45">
                              @{targetPlayer.username}
                            </p>
                          ) : (
                            <p className="mt-1 truncate text-xs text-white/45">
                              {targetPlayer.telegram_id != null
                                ? `Telegram ID: ${targetPlayer.telegram_id}`
                                : targetPlayer.email
                                  ? `Email: ${targetPlayer.email}`
                                  : "Нет данных"}
                            </p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {targetPlayer.admin_display_name ? (
                            <span className="text-xs text-yellow-300">админский ник</span>
                          ) : null}
                          {targetPlayer.is_blocked ? (
                            <span className="text-xs text-red-400">заблокирован</span>
                          ) : null}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          isEditing
                            ? handleSaveAdminName(targetPlayer.id)
                            : handleStartEdit(targetPlayer)
                        }
                        disabled={processingKey === saveKey}
                        className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {processingKey === saveKey
                          ? "..."
                          : isEditing
                            ? "Сохранить"
                            : "Редактировать"}
                      </button>

                      {targetPlayer.role === "player" ? (
                        <button
                          type="button"
                          onClick={() => handleToggleBlock(targetPlayer)}
                          disabled={processingKey === `block-${targetPlayer.id}`}
                          className={
                            targetPlayer.is_blocked
                              ? "rounded-lg border border-green-500/30 px-3 py-2 text-sm font-medium text-green-400 disabled:opacity-60"
                              : "rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                          }
                        >
                          {processingKey === `block-${targetPlayer.id}`
                            ? "..."
                            : targetPlayer.is_blocked
                              ? "Разблокировать"
                              : "Заблокировать"}
                        </button>
                      ) : null}

                      {targetPlayer.role === "player" ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteManualPlayer(targetPlayer)}
                          disabled={processingKey === `delete-${targetPlayer.id}`}
                          className="rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-400 disabled:opacity-60"
                        >
                          {processingKey === `delete-${targetPlayer.id}` ? "..." : "Удалить"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
        ) : null}
      </div>
    </main>
  );
}

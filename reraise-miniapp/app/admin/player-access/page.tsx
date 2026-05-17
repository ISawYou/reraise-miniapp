"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { fetchAdminJson } from "@/lib/client-request";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

type AccessType = "free" | "paid" | "cash";
type RightsFilter = "free-only" | "paid" | "cash" | "all";

function getRightsCount(targetPlayer: Player) {
  return (
    Number(Boolean(targetPlayer.can_access_free)) +
    Number(Boolean(targetPlayer.can_access_paid)) +
    Number(Boolean(targetPlayer.can_access_cash))
  );
}

function getVisibleNickname(targetPlayer: Player) {
  return targetPlayer.admin_display_name?.trim() || targetPlayer.display_name;
}

function getToggleButtonClassName(isEnabled: boolean) {
  return isEnabled ? "bg-green-600 text-white" : "border border-white/10 text-white";
}

export default function AdminPlayerAccessPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [rightsFilter, setRightsFilter] = useState<RightsFilter>("free-only");
  const [stickyFilteredPlayerIds, setStickyFilteredPlayerIds] = useState<string[]>([]);
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredPlayers = [...players]
    .sort((a, b) => {
      if (rightsFilter === "free-only") {
        return 0;
      }

      const rightsDiff = getRightsCount(a) - getRightsCount(b);

      if (rightsDiff !== 0) {
        return rightsDiff;
      }

      return getVisibleNickname(a).localeCompare(getVisibleNickname(b), "ru");
    })
    .filter((targetPlayer) => {
      const query = searchQuery.trim().toLowerCase();

      if (!query) {
        return true;
      }

      const username = (targetPlayer.username ?? "").toLowerCase();
      const displayName = targetPlayer.display_name.toLowerCase();
      const adminDisplayName = (targetPlayer.admin_display_name ?? "").toLowerCase();
      const telegramId =
        typeof targetPlayer.telegram_id === "number"
          ? String(targetPlayer.telegram_id)
          : "";
      const email = (targetPlayer.email ?? "").toLowerCase();

      return (
        username.includes(query) ||
        displayName.includes(query) ||
        adminDisplayName.includes(query) ||
        telegramId.includes(query) ||
        email.includes(query)
      );
    })
    .filter((targetPlayer) => {
      if (rightsFilter === "free-only") {
        return (
          stickyFilteredPlayerIds.includes(targetPlayer.id) ||
          (Boolean(targetPlayer.can_access_free) &&
            !targetPlayer.can_access_paid &&
            !targetPlayer.can_access_cash)
        );
      }

      if (rightsFilter === "paid") {
        return (
          stickyFilteredPlayerIds.includes(targetPlayer.id) ||
          Boolean(targetPlayer.can_access_paid)
        );
      }

      if (rightsFilter === "cash") {
        return (
          stickyFilteredPlayerIds.includes(targetPlayer.id) ||
          Boolean(targetPlayer.can_access_cash)
        );
      }

      return true;
    });

  async function loadPlayers() {
    const payload = await fetchAdminJson<{ players: Player[] }>(
      "/api/admin/players/access"
    );
    setPlayers(payload.players);
  }

  useEffect(() => {
    async function loadPage() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          return;
        }

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);

        if (ensuredPlayer.role === "admin") {
          await loadPlayers();
        }
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки игроков";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  async function handleToggleAccess(targetPlayer: Player, accessType: AccessType) {
    const nextValue =
      accessType === "free"
        ? !targetPlayer.can_access_free
        : accessType === "paid"
          ? !targetPlayer.can_access_paid
          : !targetPlayer.can_access_cash;

    const processingId = `${targetPlayer.id}-${accessType}`;

    try {
      setProcessingKey(processingId);
      setMessage(null);
      setError(null);

      if (rightsFilter !== "all") {
        setStickyFilteredPlayerIds((currentIds) =>
          currentIds.includes(targetPlayer.id)
            ? currentIds
            : [...currentIds, targetPlayer.id]
        );
      }

      await fetchAdminJson<{ player: Player }>(
        `/api/admin/players/${targetPlayer.id}/access`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            can_access_free:
              accessType === "free" ? nextValue : targetPlayer.can_access_free,
            can_access_paid:
              accessType === "paid" ? nextValue : targetPlayer.can_access_paid,
            can_access_cash:
              accessType === "cash" ? nextValue : targetPlayer.can_access_cash,
          }),
        }
      );

      await loadPlayers();
      setMessage("Права игрока обновлены");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка обновления прав";
      setError(nextMessage);
    } finally {
      setProcessingKey(null);
    }
  }

  function handleChangeFilter(nextFilter: RightsFilter) {
    setRightsFilter(nextFilter);
    setStickyFilteredPlayerIds([]);
  }

  if (!accessChecked || loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем доступы игроков...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/admin"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

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
      <div className="mx-auto max-w-3xl">
        <Link
          href="/admin"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Доступы игроков</h1>
        <p className="mt-2 text-sm text-white/70">
          Быстрая выдача прав игрокам. По умолчанию выше игроки с меньшим числом
          доступов.
        </p>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск по нику, Telegram ID или email"
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { key: "free-only", label: "Только free" },
            { key: "paid", label: "Платные" },
            { key: "cash", label: "Кэш" },
            { key: "all", label: "Все" },
          ].map((filterOption) => (
            <button
              key={filterOption.key}
              type="button"
              onClick={() => handleChangeFilter(filterOption.key as RightsFilter)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                rightsFilter === filterOption.key
                  ? "bg-white/10 text-white"
                  : "border border-white/10 text-white/70"
              }`}
            >
              {filterOption.label}
            </button>
          ))}
        </div>

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

        {players.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Игроки пока не найдены.
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            По вашему запросу никто не найден.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {filteredPlayers.map((targetPlayer) => {
              const freeProcessing = processingKey === `${targetPlayer.id}-free`;
              const paidProcessing = processingKey === `${targetPlayer.id}-paid`;
              const cashProcessing = processingKey === `${targetPlayer.id}-cash`;

              return (
                <div
                  key={targetPlayer.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">
                        {getVisibleNickname(targetPlayer)}
                      </p>
                      {targetPlayer.username ? (
                        <p className="mt-1 truncate text-xs text-white/45">
                          @{targetPlayer.username}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-white/55">
                        {targetPlayer.telegram_id != null
                          ? `Telegram ID: ${targetPlayer.telegram_id}`
                          : targetPlayer.email
                            ? `Email: ${targetPlayer.email}`
                            : "Нет данных"}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 sm:min-w-[280px]">
                      <button
                        type="button"
                        onClick={() => handleToggleAccess(targetPlayer, "free")}
                        disabled={freeProcessing}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${getToggleButtonClassName(Boolean(targetPlayer.can_access_free))}`}
                      >
                        {freeProcessing ? "..." : "Free"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleAccess(targetPlayer, "paid")}
                        disabled={paidProcessing}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${getToggleButtonClassName(Boolean(targetPlayer.can_access_paid))}`}
                      >
                        {paidProcessing ? "..." : "Paid"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleAccess(targetPlayer, "cash")}
                        disabled={cashProcessing}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${getToggleButtonClassName(Boolean(targetPlayer.can_access_cash))}`}
                      >
                        {cashProcessing ? "..." : "Cash"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

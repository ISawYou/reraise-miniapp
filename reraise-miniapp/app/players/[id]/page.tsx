"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ensurePlayerFromTelegramUser,
  getPlayerById,
  submitNicknameForModeration,
} from "@/features/auth";
import {
  getMyTournaments,
  getPlayedTournamentsCount,
  getPlayerRating,
  getPlayerTournamentHistory,
} from "@/features/tournaments";
import { getPlayerAchievements } from "@/features/achievements";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { getTelegramUser, getTelegramWebApp } from "@/lib/telegram";
import type {
  Player,
  RegistrationStatus,
  Tournament,
  TournamentResult,
} from "@/types/domain";

type TabKey = "upcoming" | "past";

type HistoryItem = {
  tournament: Tournament;
  result: TournamentResult;
};

type UpcomingTournamentItem = {
  registration: {
    id: string;
    player_id: string;
    tournament_id: string;
    status: RegistrationStatus;
    created_at: string;
  };
  tournament: Tournament;
};

function formatDateTimeWithoutSeconds(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="currentColor"
    >
      <path d="M16.86 3.49a2 2 0 0 1 2.83 0l.82.82a2 2 0 0 1 0 2.83l-10 10A2 2 0 0 1 9.1 17.7l-3.34.84a1 1 0 0 1-1.22-1.22l.84-3.34a2 2 0 0 1 .54-.95Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m20.5 16.5-5.25-5.25L6 20.5" />
    </svg>
  );
}

function EditBadge({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-8 w-8 appearance-none items-center justify-center rounded-full border-0 bg-black/60 text-white outline-none ring-0"
    >
      <PencilIcon />
    </button>
  );
}

function TrophyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4.5h8v3.75a4 4 0 0 1-8 0Z" />
      <path d="M10 16.5h4" />
      <path d="M12 12.25v4.25" />
      <path d="M6 6H4.75A1.75 1.75 0 0 0 3 7.75v.5A3.75 3.75 0 0 0 6.75 12H8" />
      <path d="M18 6h1.25A1.75 1.75 0 0 1 21 7.75v.5A3.75 3.75 0 0 1 17.25 12H16" />
      <path d="M9 20h6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12h15.5" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

export default function PlayerProfilePage() {
  const MAX_AVATAR_SIZE_BYTES = 20 * 1024 * 1024;
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [rating, setRating] = useState(0);
  const [playedCount, setPlayedCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [upcomingTournaments, setUpcomingTournaments] = useState<
    UpcomingTournamentItem[]
  >([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [completedAchievementsCount, setCompletedAchievementsCount] = useState(0);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!playerId) {
          throw new Error("Player id not found");
        }

        const telegramUser = getTelegramUser();
        let ensuredViewer: Player | null = null;

        if (telegramUser) {
          ensuredViewer = await ensurePlayerFromTelegramUser(telegramUser);
          setViewerId(ensuredViewer.id);
        }

        const [
          playerData,
          playerRating,
          tournamentsCount,
          playerHistory,
          myTournaments,
          achievementRows,
        ] = await Promise.all([
          ensuredViewer?.id === playerId
            ? Promise.resolve(ensuredViewer)
            : getPlayerById(playerId),
          getPlayerRating(playerId),
          getPlayedTournamentsCount(playerId),
          getPlayerTournamentHistory(playerId),
          getMyTournaments(playerId),
          getPlayerAchievements(playerId),
        ]);

        if (!playerData) {
          throw new Error("Player not found");
        }

        setPlayer(playerData);
        setNickname(playerData.pending_display_name ?? playerData.display_name);
        setRating(playerRating);
        setPlayedCount(tournamentsCount);
        setHistory(
          playerHistory.sort(
            (a, b) =>
              new Date(b.tournament.start_at).getTime() -
              new Date(a.tournament.start_at).getTime()
          )
        );
        setUpcomingTournaments(
          myTournaments
            .filter((item) => item.tournament.status !== "completed")
            .sort(
              (a, b) =>
                new Date(a.tournament.start_at).getTime() -
                new Date(b.tournament.start_at).getTime()
            )
        );
        setCompletedAchievementsCount(
          achievementRows.filter((row) => row.completed_at).length
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Ошибка загрузки профиля"
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [playerId]);

  const isOwnProfile = viewerId === player?.id;
  const avatarFallback = getPlayerAvatarFallback(player);
  const avatarUrl = getPlayerAvatarUrl(player);
  const totalKnockouts = history.reduce(
    (sum, item) => sum + (item.result.knockouts ?? 0),
    0
  );
  const achievementsProgressPercent = Math.round(
    (completedAchievementsCount / 5) * 100
  );

  function getStatusText(status: RegistrationStatus) {
    if (status === "registered") {
      return "Вы записаны";
    }

    if (status === "waitlist") {
      return "Вы в списке ожидания";
    }

    if (status === "attended") {
      return "Вы участвовали";
    }

    return status;
  }

  async function handleAvatarFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !player || !isOwnProfile) return;

    if (!file.type.startsWith("image/")) {
      setAvatarError("Можно загрузить только изображение");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setAvatarError("Файл слишком большой. Максимум 20 МБ");
      return;
    }

    try {
      setAvatarLoading(true);
      setAvatarError(null);

      const telegramInitData = getTelegramWebApp()?.initData;

      if (!telegramInitData) {
        throw new Error("Не удалось получить данные Telegram");
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("telegramInitData", telegramInitData);

      const response = await fetch(`/api/players/${player.id}/avatar`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          response.status >= 500
            ? "Сервер не настроен для загрузки аватаров"
            : payload.error ?? "Не удалось загрузить аватар"
        );
      }

      setPlayer(payload.player);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : "Не удалось загрузить аватар"
      );
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleNicknameSubmit() {
    if (!player) return;

    const nextNickname = nickname.trim();
    const currentNickname = player.display_name.trim().toLowerCase();
    const pendingNickname = player.pending_display_name?.trim().toLowerCase();

    if (
      !nextNickname ||
      nextNickname.toLowerCase() === currentNickname ||
      nextNickname.toLowerCase() === pendingNickname
    ) {
      setIsEditingNickname(false);
      setNicknameError(null);
      setNickname(player.pending_display_name ?? player.display_name);
      return;
    }

    try {
      setNicknameLoading(true);
      setNicknameError(null);

      const updatedPlayer = await submitNicknameForModeration(player, nextNickname);

      setPlayer(updatedPlayer);
      setNickname(updatedPlayer.pending_display_name ?? updatedPlayer.display_name);
      setIsEditingNickname(false);
    } catch (err) {
      setNicknameError(
        err instanceof Error ? err.message : "Не удалось обновить ник"
      );
    } finally {
      setNicknameLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем профиль игрока...</p>
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Профиль игрока не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-white/[0.08] bg-transparent px-3.5 py-2 text-sm text-white/65"
          >
            ← Назад
          </Link>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
            Профиль
          </h1>
        </div>

        <Link href="/" className="hidden">
          ← Назад
        </Link>

        <div className="flex items-center gap-4">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={player.display_name}
                className="h-20 w-20 rounded-full border border-white/10 object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-2xl font-bold text-white/80">
                {avatarFallback}
              </div>
            )}

            {isOwnProfile ? (
              <div className="absolute -right-2 -top-2">
                <EditBadge
                  onClick={() => avatarInputRef.current?.click()}
                  label="Сменить аватар"
                />
              </div>
            ) : null}
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarFileChange}
            disabled={avatarLoading}
          />

          <div className="min-w-0 flex-1">
            <div className="relative inline-block max-w-full">
              <h2 className="truncate pr-8 text-2xl font-bold">
                {player.display_name}
              </h2>

              {isOwnProfile ? (
                <div className="absolute right-0 -top-2">
                  <EditBadge
                    onClick={() => {
                      setIsEditingNickname((prev) => !prev);
                      setNicknameError(null);
                      setNickname(player.pending_display_name ?? player.display_name);
                    }}
                    label="Сменить ник"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {player.nickname_status === "pending" && player.pending_display_name ? (
          <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-white/60">
            Ник на модерации: {player.pending_display_name}
          </div>
        ) : null}

        {avatarError ? (
          <p className="mt-3 text-sm text-red-300">{avatarError}</p>
        ) : null}

        {isOwnProfile && isEditingNickname ? (
          <div className="mt-5 max-w-md rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setNicknameError(null);
              }}
              placeholder="Новый ник"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none"
            />

            {nicknameError ? (
              <p className="mt-3 text-sm text-red-300">{nicknameError}</p>
            ) : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleNicknameSubmit}
                disabled={nicknameLoading || !nickname.trim()}
                className="rounded-full bg-yellow-500 px-4 py-3 font-semibold text-black disabled:opacity-40"
              >
                {nicknameLoading ? "Сохраняем..." : "Отправить"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsEditingNickname(false);
                  setNicknameError(null);
                  setNickname(player.pending_display_name ?? player.display_name);
                }}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-white/80"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-7 space-y-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] px-5 pb-5 pt-4">
            <p className="text-2xl font-semibold text-white">
              Статистика
            </p>

            <div className="mt-5 grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-semibold text-white">{rating}</p>
                <p className="mt-2 text-sm text-white/55">Рейтинг</p>
              </div>

              <div className="border-l border-white/10 pl-4 text-center">
                <p className="text-2xl font-semibold text-white">{playedCount}</p>
                <p className="mt-2 text-sm text-white/55">Турниры</p>
              </div>

              <div className="border-l border-white/10 pl-4 text-center">
                <p className="text-2xl font-semibold text-white">{totalKnockouts}</p>
                <p className="mt-2 text-sm text-white/55">Нокауты</p>
              </div>
            </div>
          </div>

          <Link
            href={`/players/${player.id}/achievements`}
            className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-white"
          >
            <p className="text-2xl font-semibold text-white">Достижения</p>

            <div className="mt-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.07] text-white/80">
                <TrophyIcon />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white/70">
                  {completedAchievementsCount}/5
                </p>
                <div className="mt-2 h-2 rounded-full bg-white/[0.08]">
                  <div
                    className="h-2 rounded-full bg-white"
                    style={{ width: `${achievementsProgressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </Link>
        </div>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Турниры</h2>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("upcoming")}
              className={`rounded-full border px-4 py-3 text-sm font-medium ${
                activeTab === "upcoming"
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-white/10 bg-transparent text-white/70"
              }`}
            >
              Активные ({upcomingTournaments.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("past")}
              className={`rounded-full border px-4 py-3 text-sm font-medium ${
                activeTab === "past"
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-white/10 bg-transparent text-white/70"
              }`}
            >
              Прошедшие ({history.length})
            </button>
          </div>

          {activeTab === "upcoming" ? (
            <div className="mt-4">
              {upcomingTournaments.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  Пока нет активных турниров
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingTournaments.map((item) => (
                    <Link
                      key={item.registration.id}
                      href={`/tournaments/${item.tournament.id}`}
                      className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold">
                          {item.tournament.title}
                        </h3>

                        <div className="inline-flex items-center text-white/45">
                          <ArrowRightIcon />
                        </div>
                      </div>

                      <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white/75">
                        {formatDateTimeWithoutSeconds(item.tournament.start_at)}
                      </div>

                      <div className="mt-3 text-sm text-white/60">
                        {getStatusText(item.registration.status)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              {history.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  Пока нет завершённых турниров
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((item) => (
                    <Link
                      key={`${item.tournament.id}-${item.result.player_id}`}
                      href={`/tournaments/${item.tournament.id}`}
                      className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5"
                    >
                      <h3 className="text-lg font-semibold">
                        {item.tournament.title}
                      </h3>

                      <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white/75">
                        {formatDateTimeWithoutSeconds(item.tournament.start_at)}
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-2xl bg-white/[0.04] px-3 py-3 text-center">
                          <p className="text-xs text-white/45">Место</p>
                          <p className="mt-2 text-lg font-semibold text-white">
                            {item.result.place}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/[0.04] px-3 py-3 text-center">
                          <p className="text-xs text-white/45">Нокауты</p>
                          <p className="mt-2 text-lg font-semibold text-white">
                            {item.result.knockouts}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white/[0.04] px-3 py-3 text-center">
                          <p className="text-xs text-white/45">Очки</p>
                          <p className="mt-2 text-lg font-semibold text-white">
                            {item.result.rating_points}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

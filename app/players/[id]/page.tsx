"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  getPlayerById,
  submitNicknameForModeration,
} from "@/features/auth";
import {
  getMyTournaments,
  getPlayedTournamentsCount,
  getPlayerRating,
  getPlayerTournamentHistory,
  getTournamentRegistrationCounts,
} from "@/features/tournaments";

import { resolveCurrentPlayer } from "@/lib/current-player";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { getTelegramWebApp } from "@/lib/telegram";
import { logEvent } from "@/lib/activity-client";
import { AchievementVisual } from "@/components/achievements/achievement-visual";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { fetchTournamentVisualConfigs } from "@/lib/tournament-visuals-client";
import {
  buildAchievementDisplayModel,
  getEarnedFeaturedOptions,
  resolveFeaturedAchievements,
  type AchievementProgressRow,
} from "@/lib/achievement-display";
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

function getTournamentKindLabel(kind: Tournament["kind"]) {
  if (kind === "paid") {
    return "Платный";
  }

  if (kind === "cash") {
    return "Кэш";
  }

  return "Бесплатный";
}

function pluralEntries(n: number): string {
  return `${n} re-entry`;
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
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
      className="inline-flex h-7 w-7 appearance-none items-center justify-center rounded-full border-0 bg-black/60 text-white outline-none ring-0"
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
  const [registrationCounts, setRegistrationCounts] = useState<
    Record<string, number>
  >({});
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
  const [achievementRows, setAchievementRows] = useState<AchievementProgressRow[]>([]);
  const [achievementVisuals, setAchievementVisuals] = useState<Record<string, AchievementVisualConfig>>({});
  const [tournamentVisuals, setTournamentVisuals] = useState<Record<string, TournamentVisualConfig>>({});
  const [featuredKeys, setFeaturedKeys] = useState<string[]>([]);
  const [featuredDraft, setFeaturedDraft] = useState<string[]>([]);
  const [showFeaturedEditor, setShowFeaturedEditor] = useState(false);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!playerId) {
          throw new Error("Player id not found");
        }

        const ensuredViewer = await resolveCurrentPlayer().catch(() => null);
        if (ensuredViewer) {
          setViewerId(ensuredViewer.id);
        }

        const [
          playerData,
          playerRating,
          tournamentsCount,
          playerHistory,
          myTournaments,
          achievementRows,
          counts,
          visualsData,
          featuredData,
          tournamentVisualsData,
        ] = await Promise.all([
          ensuredViewer?.id === playerId
            ? Promise.resolve(ensuredViewer)
            : getPlayerById(playerId),
          getPlayerRating(playerId),
          getPlayedTournamentsCount(playerId),
          getPlayerTournamentHistory(playerId),
          getMyTournaments(playerId),
          fetch(`/api/players/${playerId}/achievements`).then((r) => r.ok ? r.json() : []),
          getTournamentRegistrationCounts(),
          fetch("/api/achievement-visuals").then((r) => r.json()),
          fetch(`/api/players/${playerId}/featured-achievements`).then((r) => r.ok ? r.json() : { keys: [] }),
          fetchTournamentVisualConfigs(),
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
            (a: HistoryItem, b: HistoryItem) =>
              new Date(b.tournament.start_at).getTime() -
              new Date(a.tournament.start_at).getTime()
          )
        );
        setUpcomingTournaments(
          myTournaments
            .filter(
              (item: UpcomingTournamentItem) =>
                item.tournament.status !== "completed"
            )
            .sort(
              (a: UpcomingTournamentItem, b: UpcomingTournamentItem) =>
                new Date(a.tournament.start_at).getTime() -
                new Date(b.tournament.start_at).getTime()
            )
        );
        setRegistrationCounts(counts);
        setTournamentVisuals(tournamentVisualsData);
        setAchievementRows(achievementRows);
        setAchievementVisuals(Object.fromEntries((visualsData.visuals ?? []).map((config: AchievementVisualConfig) => [config.visualKey, config])));
        setFeaturedKeys(featuredData.keys ?? []);
        logEvent("profile_opened", { metadata: { target_player_id: playerId } });
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
  const achievementModel = buildAchievementDisplayModel(achievementRows);
  const earnedFeaturedOptions = getEarnedFeaturedOptions(achievementRows);
  const featuredAchievements = resolveFeaturedAchievements(achievementRows, featuredKeys);
  const earnedFamiliesCount = achievementModel.families.filter((card) => card.currentTier).length;
  const earnedLegendaryCount = achievementModel.legendary.filter((card) => card.earned).length;
  const profileAchievementCards = [
    ...achievementModel.families.filter((card) => card.currentTier),
    ...achievementModel.legendary.filter((card) => card.earned),
  ].sort((left, right) => {
    const tierPriority = { bronze: 1, silver: 2, gold: 3, platinum: 4 } as const;
    const leftPriority = "currentTier" in left ? tierPriority[left.currentTier!] : 5;
    const rightPriority = "currentTier" in right ? tierPriority[right.currentTier!] : 5;
    return rightPriority - leftPriority;
  }).slice(0, 4);
  const showTournamentKindTags = false;

  async function saveFeaturedAchievements() {
    if (!player) return;
    setFeaturedSaving(true);
    try {
      const response = await fetch(`/api/players/${player.id}/featured-achievements`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: featuredDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setFeaturedKeys(data.keys);
      setShowFeaturedEditor(false);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Не удалось сохранить достижения");
    } finally {
      setFeaturedSaving(false);
    }
  }

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
      <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем профиль игрока...</p>
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/" className="mb-4" />

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Профиль игрока не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <BackButton href="/" />

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
            Профиль
          </h1>
        </div>

        <div className="rounded-[28px] border border-[#7f9b8c]/15 bg-[linear-gradient(160deg,#15231b_0%,#0d1512_55%,#0a0f0c_100%)] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
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
            {isOwnProfile && player.email ? (
              <p className="mt-1 truncate text-sm text-white/45">{player.email}</p>
            ) : null}

            {(player.free_reentries_balance ?? 0) > 0 ? (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-400">
                  {pluralEntries(player.free_reentries_balance ?? 0)}
                </span>
              </div>
            ) : null}

            {featuredAchievements.length > 0 || isOwnProfile ? (
              <div className="mt-3 flex items-center gap-2">
                {featuredAchievements.map((item) => (
                  <AchievementVisual key={item.key} visualKey={item.visualKey} tier={item.tier} configs={achievementVisuals} className="h-11 w-11" />
                ))}
                {isOwnProfile ? (
                  <button type="button" onClick={() => { setFeaturedDraft(featuredKeys); setShowFeaturedEditor(true); }} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/65">
                    Изменить достижения
                  </button>
                ) : null}
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
          <Link
            href={`/players/${player.id}/achievements`}
            className="block rounded-3xl border border-[#8a6a4a]/20 bg-[linear-gradient(160deg,#1c140f_0%,#120d0a_100%)] p-5 text-white"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xl font-semibold text-white">Достижения</p>
              <ArrowRightIcon />
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex -space-x-2">
                {profileAchievementCards.map((card) => (
                  <AchievementVisual key={"family" in card ? card.family : card.code} visualKey={card.visualKey} tier={"currentTier" in card ? card.currentTier : null} configs={achievementVisuals} className="h-12 w-12 rounded-full bg-[#0b100d]" />
                ))}
                {earnedFamiliesCount + earnedLegendaryCount === 0 ? <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.07] text-white/60"><TrophyIcon /></div> : null}
              </div>
              <div className="text-right text-xs text-white/50">
                <p>{earnedFamiliesCount + earnedLegendaryCount} из 12 открыто</p>
                <p className="mt-1">Легендарные {earnedLegendaryCount}/4</p>
              </div>
            </div>
          </Link>

          <div className="rounded-3xl border border-[#8a8262]/15 bg-[linear-gradient(160deg,#171a13_0%,#101210_100%)] px-5 pb-4 pt-3.5">
            <p className="text-xl font-semibold text-white">
              Статистика
            </p>

            <div className="mt-3 grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-xl font-semibold text-white">{rating}</p>
                <p className="mt-1.5 text-sm text-white/55">Рейтинг</p>
              </div>

              <div className="border-l border-[#8a8262]/20 pl-4 text-center">
                <p className="text-xl font-semibold text-white">{playedCount}</p>
                <p className="mt-1.5 text-sm text-white/55">Турниры</p>
              </div>

              <div className="border-l border-[#8a8262]/20 pl-4 text-center">
                <p className="text-xl font-semibold text-white">{totalKnockouts}</p>
                <p className="mt-1.5 text-sm text-white/55">Нокауты</p>
              </div>
            </div>
          </div>
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
                      className="relative block overflow-hidden rounded-3xl border border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)] p-5 shadow-[0_14px_36px_rgba(0,0,0,0.3)] transition active:scale-[0.99]"
                    >
                      <TournamentVisual
                        tournamentType={item.tournament.tournament_type}
                        configs={tournamentVisuals}
                        className="z-0"
                      />

                      <div className="relative z-10">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold text-white">
                            {item.tournament.title}
                          </h3>
                          {showTournamentKindTags ? (
                            <span className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">
                              {getTournamentKindLabel(item.tournament.kind)}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/75">
                          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-medium">
                            {formatDateTimeWithoutSeconds(item.tournament.start_at)}
                          </div>
                          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-medium">
                            {registrationCounts[item.tournament.id] ?? 0} / {item.tournament.max_players}
                          </div>
                        </div>

                        <div className="mt-3 text-sm text-white/60">
                          {getStatusText(item.registration.status)}
                        </div>
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
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold">
                          {item.tournament.title}
                        </h3>
                        {showTournamentKindTags ? (
                          <span className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">
                            {getTournamentKindLabel(item.tournament.kind)}
                          </span>
                        ) : null}
                      </div>

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

      {showFeaturedEditor && isOwnProfile ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setShowFeaturedEditor(false)}>
          <section className="w-full rounded-t-[30px] border border-white/10 bg-[#101612]/95 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] backdrop-blur-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-md">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <h2 className="text-xl font-semibold">Любимые достижения</h2>
              <p className="mt-1 text-sm text-white/50">Выберите до трёх полученных достижений</p>
              <div className="mt-4 grid max-h-[48vh] grid-cols-2 gap-2 overflow-y-auto">
                {earnedFeaturedOptions.map((item) => {
                  const selected = featuredDraft.includes(item.key);
                  return (
                    <button key={item.key} type="button" onClick={() => setFeaturedDraft((current) => selected ? current.filter((key) => key !== item.key) : current.length < 3 ? [...current, item.key] : current)} className={`flex min-w-0 items-center gap-2 rounded-2xl border p-2 text-left ${selected ? "border-[#d5b867]/50 bg-[#d5b867]/10" : "border-white/10 bg-white/[0.04]"}`}>
                      <AchievementVisual visualKey={item.visualKey} tier={item.tier} configs={achievementVisuals} className="h-12 w-12 shrink-0" />
                      <span className="truncate text-sm">{item.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setShowFeaturedEditor(false)} className="flex-1 rounded-2xl border border-white/10 py-3 text-sm text-white/65">Отмена</button>
                <button type="button" disabled={featuredSaving} onClick={() => void saveFeaturedAchievements()} className="flex-1 rounded-2xl bg-[#d5b867] py-3 text-sm font-semibold text-black disabled:opacity-50">{featuredSaving ? "Сохраняем..." : `Сохранить (${featuredDraft.length}/3)`}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}



"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ensurePlayerFromTelegramUser,
  getPlayerById,
  submitNicknameForModeration,
} from "@/features/auth";
import {
  getPlayedTournamentsCount,
  getPlayerRating,
  getPlayerTournamentHistory,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament, TournamentResult } from "@/types/domain";

type HistoryItem = {
  tournament: Tournament;
  result: TournamentResult;
};

export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const playerId = params?.id;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [telegramPhotoUrl, setTelegramPhotoUrl] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [rating, setRating] = useState(0);
  const [playedCount, setPlayedCount] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        if (!playerId) {
          throw new Error("Player id not found");
        }

        const telegramUser = getTelegramUser();

        if (telegramUser) {
          const ensuredViewer = await ensurePlayerFromTelegramUser(telegramUser);
          setViewerId(ensuredViewer.id);
          setTelegramPhotoUrl(
            (telegramUser as { photo_url?: string }).photo_url ?? null
          );
        }

        const [playerData, playerRating, tournamentsCount, playerHistory] =
          await Promise.all([
            getPlayerById(playerId),
            getPlayerRating(playerId),
            getPlayedTournamentsCount(playerId),
            getPlayerTournamentHistory(playerId),
          ]);

        if (!playerData) {
          throw new Error("Player not found");
        }

        setPlayer(playerData);
        setNickname(playerData.pending_display_name ?? playerData.display_name);
        setRating(playerRating);
        setPlayedCount(tournamentsCount);
        setHistory(playerHistory);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РїСЂРѕС„РёР»СЏ"
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [playerId]);

  const isOwnProfile = viewerId === player?.id;
  const avatarFallback = (player?.display_name?.trim()?.[0] ?? "?").toUpperCase();
  const avatarUrl = isOwnProfile ? telegramPhotoUrl : null;

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
          <p className="text-sm text-white/70">Р—Р°РіСЂСѓР¶Р°РµРј РїСЂРѕС„РёР»СЊ РёРіСЂРѕРєР°...</p>
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
            в†ђ РќР°Р·Р°Рґ
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "РџСЂРѕС„РёР»СЊ РёРіСЂРѕРєР° РЅРµ РЅР°Р№РґРµРЅ"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          в†ђ РќР°Р·Р°Рґ
        </Link>

        <div className="flex flex-col items-start">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={player.display_name}
              className="mb-4 h-20 w-20 rounded-full border border-white/10 object-cover"
            />
          ) : (
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl font-bold text-white/80">
              {avatarFallback}
            </div>
          )}

          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{player.display_name}</h1>
            {isOwnProfile ? (
              <button
                type="button"
                onClick={() => {
                  setIsEditingNickname((prev) => !prev);
                  setNicknameError(null);
                  setNickname(player.pending_display_name ?? player.display_name);
                }}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
                title="Редактировать ник"
              >
                вњЋ
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-white/70">
          {player.username ? `@${player.username}` : "Р‘РµР· username"}
        </p>

        {player.nickname_status === "pending" && player.pending_display_name ? (
          <p className="mt-2 text-sm text-yellow-300">
            Ник на модерации: {player.pending_display_name}
          </p>
        ) : null}

        {isOwnProfile && isEditingNickname ? (
          <div className="mt-4 max-w-md rounded-xl border border-white/10 bg-white/5 p-4">
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                setNicknameError(null);
              }}
              placeholder="Новый ник"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none"
            />

            {nicknameError ? (
              <p className="mt-3 text-sm text-red-300">{nicknameError}</p>
            ) : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleNicknameSubmit}
                disabled={nicknameLoading || !nickname.trim()}
                className="rounded-xl bg-yellow-500 px-4 py-3 font-semibold text-black disabled:opacity-40"
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
                className="rounded-xl border border-white/10 px-4 py-3 text-white/80"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/60">Р РµР№С‚РёРЅРі</p>
            <p className="mt-2 text-2xl font-semibold">{rating}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/60">РЎС‹РіСЂР°РЅРѕ С‚СѓСЂРЅРёСЂРѕРІ</p>
            <p className="mt-2 text-2xl font-semibold">{playedCount}</p>
          </div>
        </div>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">РСЃС‚РѕСЂРёСЏ С‚СѓСЂРЅРёСЂРѕРІ</h2>

          {history.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              РџРѕРєР° РЅРµС‚ СЃС‹РіСЂР°РЅРЅС‹С… С‚СѓСЂРЅРёСЂРѕРІ
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {history.map((item) => (
                <div
                  key={`${item.tournament.id}-${item.result.player_id}`}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-lg font-semibold">{item.tournament.title}</p>
                  <p className="mt-1 text-sm text-white/60">
                    {new Date(item.tournament.start_at).toLocaleString("ru-RU")}
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-white/80">
                    <div>РњРµСЃС‚Рѕ: {item.result.place}</div>
                    <div>РќРѕРєР°СѓС‚С‹: {item.result.knockouts}</div>
                    <div>РћС‡РєРё: {item.result.rating_points}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

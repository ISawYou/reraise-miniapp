"use client";

import { useEffect, useState } from "react";
import {
  getTelegramUser,
  getTelegramWebApp,
  type TelegramWebAppUser,
} from "@/lib/telegram";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import type { Player } from "@/types/domain";

export default function HomePage() {
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [checkedTelegram, setCheckedTelegram] = useState(false);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const webApp = getTelegramWebApp();

        if (webApp) {
          setIsInsideTelegram(true);
          webApp.ready?.();
          webApp.expand?.();
        }

        const telegramUser = getTelegramUser();
        setUser(telegramUser);
        setCheckedTelegram(true);

        if (telegramUser) {
          setPlayerLoading(true);
          setPlayerError(null);

          const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
          setPlayer(ensuredPlayer);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown player sync error";
        setPlayerError(message);
      } finally {
        setPlayerLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-3xl font-bold">ReRaise Poker Club</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Управляемый клубный MVP внутри Telegram
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Telegram Mini App</h2>

          {!checkedTelegram && (
            <p className="mt-2 text-sm text-neutral-300">Проверяем Telegram...</p>
          )}

          {checkedTelegram && !isInsideTelegram && (
            <p className="mt-2 text-sm text-neutral-300">
              Приложение открыто вне Telegram
            </p>
          )}

          {checkedTelegram && isInsideTelegram && !user && (
            <p className="mt-2 text-sm text-neutral-300">
              Telegram открыт, но данные пользователя пока недоступны
            </p>
          )}

          {user && (
            <div className="mt-3 space-y-2 text-sm text-neutral-200">
              <p>
                <span className="text-neutral-400">first_name:</span>{" "}
                {user.first_name}
              </p>
              <p>
                <span className="text-neutral-400">username:</span>{" "}
                {user.username ? `@${user.username}` : "не указан"}
              </p>
              <p>
                <span className="text-neutral-400">telegram id:</span> {user.id}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Игрок в базе</h2>

          {playerLoading && (
            <p className="mt-2 text-sm text-neutral-300">Синхронизируем игрока...</p>
          )}

          {playerError && (
            <p className="mt-2 text-sm text-red-400">{playerError}</p>
          )}

          {!playerLoading && !playerError && !player && (
            <p className="mt-2 text-sm text-neutral-300">
              Игрок пока не синхронизирован
            </p>
          )}

          {player && (
            <div className="mt-3 space-y-2 text-sm text-neutral-200">
              <p>
                <span className="text-neutral-400">player id:</span> {player.id}
              </p>
              <p>
                <span className="text-neutral-400">display_name:</span>{" "}
                {player.display_name}
              </p>
              <p>
                <span className="text-neutral-400">username:</span>{" "}
                {player.username ? `@${player.username}` : "не указан"}
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <a
            href="/tournaments"
            className="rounded-xl bg-yellow-500 px-4 py-3 text-center font-semibold text-black"
          >
            Турниры
          </a>

          <a
            href="/status"
            className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
          >
            Мой статус
          </a>

          <a
            href="/rating"
            className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
          >
            Рейтинг
          </a>

          <a
            href="/admin"
            className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
          >
            Админ-панель
          </a>
        </div>
      </div>
    </main>
  );
}
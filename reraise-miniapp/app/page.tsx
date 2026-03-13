"use client";

import { useEffect, useState } from "react";
import { getTelegramUser, getTelegramWebApp, type TelegramWebAppUser } from "@/lib/telegram";

export default function HomePage() {
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);

  useEffect(() => {
    const webApp = getTelegramWebApp();

    if (webApp) {
      setIsInsideTelegram(true);
      webApp.expand?.();
    }

    const telegramUser = getTelegramUser();
    setUser(telegramUser);
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-3xl font-bold">ReRaise Poker Club</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Управляемый клубный MVP внутри Telegram
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Telegram Mini App</h2>

          {!isInsideTelegram && (
            <p className="mt-2 text-sm text-neutral-300">
              Приложение открыто вне Telegram
            </p>
          )}

          {isInsideTelegram && !user && (
            <p className="mt-2 text-sm text-neutral-300">
              Telegram открыт, но данные пользователя недоступны
            </p>
          )}

          {user && (
            <div className="mt-3 space-y-2 text-sm text-neutral-200">
              <p>
                <span className="text-neutral-400">first_name:</span> {user.first_name}
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
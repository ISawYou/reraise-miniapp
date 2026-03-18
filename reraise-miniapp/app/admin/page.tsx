"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

export default function AdminPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    async function loadAdminData() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          return;
        }

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);
      } catch (error) {
        console.error("Admin access check error:", error);
      } finally {
        setAccessChecked(true);
      }
    }

    loadAdminData();
  }, []);

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
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
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Админ-панель</h1>
        <p className="mt-2 text-sm text-white/70">
          Управление турнирами и модерацией клуба
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <Link
            href="/admin/moderation"
            className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-yellow-500/40 hover:bg-white/8"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500 font-bold text-black">
              MN
            </div>
            <h2 className="mt-4 text-lg font-semibold">Модерация ников</h2>
            <p className="mt-2 text-sm text-white/70">
              Проверка и одобрение новых ников игроков
            </p>
          </Link>

          <Link
            href="/admin/tournaments/create"
            className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-yellow-500/40 hover:bg-white/8"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500 font-bold text-black">
              CT
            </div>
            <h2 className="mt-4 text-lg font-semibold">Создание турнира</h2>
            <p className="mt-2 text-sm text-white/70">
              Создание нового турнира с базовыми настройками
            </p>
          </Link>

          <Link
            href="/admin/tournaments"
            className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-yellow-500/40 hover:bg-white/8"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500 font-bold text-black">
              MT
            </div>
            <h2 className="mt-4 text-lg font-semibold">Модерация турниров</h2>
            <p className="mt-2 text-sm text-white/70">
              Открытие, редактирование, результаты и удаление турниров
            </p>
          </Link>
        </section>
      </div>
    </main>
  );
}

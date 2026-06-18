"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

type AdminCard = {
  href: string;
  code: string;
  title: string;
  description: string;
};

const ADMIN_CARDS: AdminCard[] = [
  {
    href: "/admin/moderation",
    code: "MN",
    title: "Модерация ников",
    description: "Проверка и одобрение новых ников игроков.",
  },
  {
    href: "/admin/tournaments/create",
    code: "CT",
    title: "Создание турнира",
    description: "Создание нового турнира с базовыми настройками.",
  },
  {
    href: "/admin/tournament-notifications",
    code: "NT",
    title: "Уведомления",
    description: "Отправка анонсов турниров в основную Telegram-группу.",
  },
  {
    href: "/admin/tournaments",
    code: "MT",
    title: "Турниры",
    description: "Редактирование турниров, участников и результатов.",
  },
  {
    href: "/admin/settings",
    code: "ST",
    title: "Настройки",
    description: "Debug overlay, предложение привязки email и прочие параметры.",
  },
  {
    href: "/admin/referral",
    code: "RF",
    title: "Реферальная программа",
    description: "Рефералы, бесплатные re-entry и бонус за отзыв на Яндекс.",
  },
  {
    href: "/admin/activity",
    code: "AN",
    title: "Аналитика активности",
    description: "Активные пользователи, открытия приложения, регистрации.",
  },
];

export default function AdminPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    async function loadAdminData() {
      try {
        const telegramUser = getTelegramUser();
        if (!telegramUser) return;
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
            className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

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

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Админ-панель</h1>
        <p className="mt-2 text-sm text-white/70">
          Управление турнирами, результатами и внутренними процессами клуба.
        </p>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {ADMIN_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-yellow-500/40 hover:bg-white/8"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500 font-bold text-black">
                {card.code}
              </div>
              <h2 className="mt-4 text-lg font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm text-white/70">{card.description}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

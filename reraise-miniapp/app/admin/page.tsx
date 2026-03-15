"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { createTournament } from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

export default function AdminPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadPlayer() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          setAccessChecked(true);
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

    loadPlayer();
  }, []);

  async function handleCreateTournament() {
    if (!title.trim()) {
      setMessage("Введите название турнира");
      return;
    }

    if (!startAt) {
      setMessage("Выберите дату и время");
      return;
    }

    if (!maxPlayers || Number(maxPlayers) <= 0) {
      setMessage("Укажите корректный лимит игроков");
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      await createTournament({
        title: title.trim(),
        start_at: new Date(startAt).toISOString(),
        max_players: Number(maxPlayers),
      });

      setMessage("Турнир создан");
      setTitle("");
      setStartAt("");
      setMaxPlayers("20");
    } catch (error) {
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Ошибка создания турнира");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Проверяем доступ...</p>
        </div>
      </main>
    );
  }

  if (player?.role !== "admin") {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
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
      <div className="mx-auto max-w-md">
        <Link
          href="/"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <h1 className="text-2xl font-bold">Админ-панель</h1>
        <p className="mt-2 text-sm text-white/70">Создание турнира</p>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="block text-sm text-white/80">Название турнира</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, Friday Deep Stack"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">Дата и время</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">Лимит игроков</label>
          <input
            type="number"
            min="1"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <button
            type="button"
            onClick={handleCreateTournament}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-yellow-500 py-2 font-semibold text-black disabled:opacity-60"
          >
            {loading ? "Создаем..." : "Создать турнир"}
          </button>

          {message ? (
            <p className="mt-3 text-sm text-white/80">{message}</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
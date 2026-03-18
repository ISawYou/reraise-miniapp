"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { createTournament } from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player } from "@/types/domain";

export default function AdminTournamentCreatePage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPage() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          return;
        }

        const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayer(ensuredPlayer);
      } catch (err) {
        const nextMessage =
          err instanceof Error ? err.message : "Ошибка загрузки страницы";
        setError(nextMessage);
      } finally {
        setAccessChecked(true);
      }
    }

    loadPage();
  }, []);

  async function handleCreateTournament() {
    if (!title.trim()) {
      setError("Введите название турнира");
      return;
    }

    if (!description.trim()) {
      setError("Введите описание турнира");
      return;
    }

    if (!location.trim()) {
      setError("Укажите место проведения");
      return;
    }

    if (!startAt) {
      setError("Выберите дату и время");
      return;
    }

    if (!maxPlayers || Number(maxPlayers) <= 0) {
      setError("Укажите корректный лимит игроков");
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      setError(null);

      await createTournament({
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        start_at: new Date(startAt).toISOString(),
        max_players: Number(maxPlayers),
      });

      setMessage("Турнир создан");
      setTitle("");
      setDescription("");
      setLocation("");
      setStartAt("");
      setMaxPlayers("20");
    } catch (err) {
      const nextMessage =
        err instanceof Error ? err.message : "Ошибка создания турнира";
      setError(nextMessage);
    } finally {
      setLoading(false);
    }
  }

  if (!accessChecked) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-white/70">Загружаем страницу создания...</p>
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

        <h1 className="text-2xl font-bold">Создание турнира</h1>
        <p className="mt-2 text-sm text-white/70">
          Заполните базовые параметры нового турнира
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

        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="block text-sm text-white/80">Название турнира</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, Friday Deep Stack"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">
            Описание турнира
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например, баунти, ребаи разрешены, поздняя регистрация 60 минут"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
            rows={4}
          />

          <label className="mt-4 block text-sm text-white/80">
            Место проведения
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Например, Poker Loft, Москва-Сити"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">Дата и время</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">
            Лимит игроков
          </label>
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
        </div>
      </div>
    </main>
  );
}

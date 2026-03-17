"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  createTournament,
  deleteTournament,
  getOpenTournaments,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { Player, Tournament } from "@/types/domain";

export default function AdminPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("20");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);

  async function loadAdminData() {
    try {
      const telegramUser = getTelegramUser();

      if (!telegramUser) {
        setAccessChecked(true);
        return;
      }

      const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
      setPlayer(ensuredPlayer);

      if (ensuredPlayer.role === "admin") {
        const nextTournaments = await getOpenTournaments();
        setTournaments(nextTournaments);
      }
    } catch (error) {
      console.error("Admin access check error:", error);
    } finally {
      setAccessChecked(true);
      setTournamentsLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
  }, []);

async function handleDeleteTournament(tournamentId: string, tournamentTitle: string) {
  const isConfirmed = window.confirm(
    `Вы точно хотите удалить турнир "${tournamentTitle}"?`
  );

  if (!isConfirmed) {
    return;
  }

  try {
    setLoading(true);
    setMessage("");

    await deleteTournament(tournamentId);

    setMessage(`Турнир "${tournamentTitle}" удален`);

    const nextTournaments = await getOpenTournaments();
    setTournaments(nextTournaments);
  } catch (error) {
    if (error instanceof Error) {
      setMessage(error.message);
    } else {
      setMessage("Ошибка удаления турнира");
    }
  } finally {
    setLoading(false);
  }
}

  async function handleCreateTournament() {
    if (!title.trim()) {
      setMessage("Введите название турнира");
      return;
    }

    if (!description.trim()) {
      setMessage("Введите описание турнира");
      return;
    }

    if (!location.trim()) {
      setMessage("Укажите место проведения");
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

      const nextTournaments = await getOpenTournaments();
      setTournaments(nextTournaments);
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

        <Link
          href="/admin/moderation"
          className="mt-4 inline-block rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm font-medium text-yellow-300"
        >
          Модерация ников
        </Link>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="block text-sm text-white/80">Название турнира</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, Friday Deep Stack"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
          />

          <label className="mt-4 block text-sm text-white/80">Описание турнира</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Например, баунти, ребаи разрешены, поздняя регистрация 60 минут"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none"
            rows={4}
          />

          <label className="mt-4 block text-sm text-white/80">Место проведения</label>
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

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Открытые турниры</h2>

          {tournamentsLoading ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Загружаем турниры...
            </div>
          ) : tournaments.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Пока нет открытых турниров
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {tournaments.map((tournament) => (
                <div
                  key={tournament.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-lg font-semibold">{tournament.title}</p>

                  <p className="mt-2 text-sm text-white/60">
                    {new Date(tournament.start_at).toLocaleString("ru-RU")}
                  </p>

                  <p className="mt-1 text-sm text-white/60">
                    Лимит игроков: {tournament.max_players}
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                  <Link
                    href={`/tournaments/${tournament.id}`}
                    className="rounded-lg border border-white/10 px-3 py-2 text-center text-sm text-white/80"
                  >
                    Открыть турнир
                  </Link>

                  <Link
                    href={`/admin/results/${tournament.id}`}
                    className="rounded-lg bg-yellow-500 px-3 py-2 text-center text-sm font-semibold text-black"
                  >
                    Внести результаты
                  </Link>

                  <button
                    type="button"
                    onClick={() => handleDeleteTournament(tournament.id, tournament.title)}
                    disabled={loading}
                    className="rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Удалить турнир
                  </button>
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

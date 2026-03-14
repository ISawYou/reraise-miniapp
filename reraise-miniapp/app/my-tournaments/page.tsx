"use client";

import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getMyTournaments } from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";

import type { Tournament, Registration } from "@/types/domain";

type MyTournamentItem = {
  registration: Registration;
  tournament: Tournament;
};

export default function MyTournamentsPage() {
  const [items, setItems] = useState<MyTournamentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          throw new Error("Telegram user not found");
        }

        const player = await ensurePlayerFromTelegramUser(telegramUser);
        const data = await getMyTournaments(player.id);

        setItems(data);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown my tournaments error";

        setError(message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  const registeredItems = items.filter(
    (item) => item.registration.status === "registered"
  );

  const waitlistItems = items.filter(
    (item) => item.registration.status === "waitlist"
  );

  function renderTournamentCard(item: MyTournamentItem) {
    return (
      <div
        key={item.registration.id}
        className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
      >
        <h2 className="text-lg font-semibold">{item.tournament.title}</h2>

        <p className="mt-1 text-sm text-neutral-400">
          {new Date(item.tournament.start_at).toLocaleString()}
        </p>

        <p className="mt-1 text-sm text-neutral-400">
          Макс игроков: {item.tournament.max_players}
        </p>

        <p className="mt-3 text-sm font-medium text-neutral-200">
          {item.registration.status === "registered"
            ? "Статус: вы зарегистрированы"
            : "Статус: вы в waitlist"}
        </p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-md space-y-6">
        <h1 className="text-3xl font-bold">Мои турниры</h1>

        {loading && (
          <p className="text-neutral-400">Загружаем ваши турниры...</p>
        )}

        {error && <p className="text-red-400">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <p className="text-neutral-300">У вас пока нет активных записей</p>
          </div>
        )}

        {!loading && !error && registeredItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Вы зарегистрированы</h2>
            {registeredItems.map(renderTournamentCard)}
          </section>
        )}

        {!loading && !error && waitlistItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Вы в waitlist</h2>
            {waitlistItems.map(renderTournamentCard)}
          </section>
        )}
      </div>
    </main>
  );
}
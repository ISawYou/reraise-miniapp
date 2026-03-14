"use client";

import { useEffect, useState } from "react";
import { getOpenTournaments } from "@/features/tournaments";
import type { Tournament } from "@/types/domain";

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTournaments() {
      try {
        const data = await getOpenTournaments();
        setTournaments(data);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown tournaments error";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadTournaments();
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-md space-y-6">

        <h1 className="text-3xl font-bold">
          Турниры
        </h1>

        {loading && (
          <p className="text-neutral-400">
            Загружаем турниры...
          </p>
        )}

        {error && (
          <p className="text-red-400">
            {error}
          </p>
        )}

        {!loading && tournaments.length === 0 && (
          <p className="text-neutral-400">
            Открытых турниров пока нет
          </p>
        )}

        {tournaments.map((tournament) => (
          <div
            key={tournament.id}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <h2 className="text-lg font-semibold">
              {tournament.title}
            </h2>

            <p className="text-sm text-neutral-400 mt-1">
              {new Date(tournament.start_at).toLocaleString()}
            </p>

            <p className="text-sm text-neutral-400 mt-1">
              Макс игроков: {tournament.max_players}
            </p>

            <button
              className="mt-3 w-full rounded-lg bg-yellow-500 py-2 text-black font-semibold"
            >
              Записаться
            </button>

          </div>
        ))}

      </div>
    </main>
  );
}
"use client";

import { useEffect, useState } from "react";
import {
  getOpenTournaments,
  registerPlayerForTournament,
  getPlayerRegistrations
} from "@/features/tournaments";

import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";

import type { Tournament } from "@/types/domain";

export default function TournamentsPage() {

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const [registrations, setRegistrations] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister(tournamentId: string) {

    if (!playerId) return;

    try {

      const result = await registerPlayerForTournament(playerId, tournamentId);

      setRegistrations((prev) => ({
        ...prev,
        [tournamentId]: result.status
      }));

    } catch (err) {

      alert("Ошибка записи");

    }

  }

  useEffect(() => {

    async function init() {

      try {

        const telegramUser = getTelegramUser();

        if (telegramUser) {

          const player = await ensurePlayerFromTelegramUser(telegramUser);

          setPlayerId(player.id);

          const regs = await getPlayerRegistrations(player.id);

          const map: Record<string, string> = {};

          regs.forEach((r: any) => {
            map[r.tournament_id] = r.status;
          });

          setRegistrations(map);

        }

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

    init();

  }, []);

  function renderButton(tournamentId: string) {

    const status = registrations[tournamentId];

    if (!status) {

      return (
        <button
          onClick={() => handleRegister(tournamentId)}
          className="mt-3 w-full rounded-lg bg-yellow-500 py-2 text-black font-semibold"
        >
          Записаться
        </button>
      );

    }

    if (status === "registered") {

      return (
        <button
          className="mt-3 w-full rounded-lg bg-green-600 py-2 font-semibold"
        >
          Вы записаны
        </button>
      );

    }

    if (status === "waitlist") {

      return (
        <button
          className="mt-3 w-full rounded-lg bg-orange-500 py-2 font-semibold"
        >
          Вы в waitlist
        </button>
      );

    }

    return null;

  }

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

            {renderButton(tournament.id)}

          </div>

        ))}

      </div>

    </main>
  );

}
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getMyTournamentHistory,
  getMyTournaments,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type { RegistrationStatus, Tournament, TournamentResult } from "@/types/domain";

type TabKey = "upcoming" | "past";

type UpcomingTournamentItem = {
  registration: {
    id: string;
    player_id: string;
    tournament_id: string;
    status: RegistrationStatus;
    created_at: string;
  };
  tournament: Tournament;
};

type PastTournamentItem = {
  tournament: Tournament;
  result: TournamentResult;
};

export default function MyTournamentsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [upcomingTournaments, setUpcomingTournaments] = useState<UpcomingTournamentItem[]>([]);
  const [pastTournaments, setPastTournaments] = useState<PastTournamentItem[]>([]);
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

        const [myTournaments, myHistory] = await Promise.all([
          getMyTournaments(player.id),
          getMyTournamentHistory(player.id),
        ]);

        const upcoming = myTournaments
          .filter((item) => item.tournament.status !== "completed")
          .sort(
            (a, b) =>
              new Date(a.tournament.start_at).getTime() -
              new Date(b.tournament.start_at).getTime()
          );

        const past = myHistory.sort(
          (a, b) =>
            new Date(b.tournament.start_at).getTime() -
            new Date(a.tournament.start_at).getTime()
        );

        setUpcomingTournaments(upcoming);
        setPastTournaments(past);
      } catch (err) {
        const nextError =
          err instanceof Error ? err.message : "Ошибка загрузки моих турниров";
        setError(nextError);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  function getStatusText(status: RegistrationStatus) {
    if (status === "registered") {
      return "Вы зарегистрированы";
    }

    if (status === "waitlist") {
      return "Вы в waitlist";
    }

    if (status === "attended") {
      return "Вы участвовали";
    }

    return status;
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Загружаем ваши турниры...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <Link
            href="/"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
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

        <h1 className="text-2xl font-bold">Мои турниры</h1>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("upcoming")}
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "upcoming"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            Предстоящие ({upcomingTournaments.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("past")}
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "past"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            Прошедшие ({pastTournaments.length})
          </button>
        </div>

        {activeTab === "upcoming" ? (
          <section className="mt-6">
            {upcomingTournaments.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                У вас пока нет предстоящих турниров
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingTournaments.map((item) => (
                  <Link
                    key={item.registration.id}
                    href={`/tournaments/${item.tournament.id}`}
                    className="block rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <h3 className="text-lg font-semibold">{item.tournament.title}</h3>

                    <p className="mt-2 text-sm text-white/60">
                      {new Date(item.tournament.start_at).toLocaleString("ru-RU")}
                    </p>

                    <p className="mt-1 text-sm text-white/60">
                      Статус: {getStatusText(item.registration.status)}
                    </p>

                    <p className="mt-3 text-sm text-white/70 underline underline-offset-4">
                      Открыть турнир
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="mt-6">
            {pastTournaments.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                У вас пока нет завершённых турниров
              </div>
            ) : (
              <div className="space-y-4">
                {pastTournaments.map((item) => (
                  <Link
                    key={`${item.tournament.id}-${item.result.player_id}`}
                    href={`/tournaments/${item.tournament.id}`}
                    className="block rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <h3 className="text-lg font-semibold">{item.tournament.title}</h3>

                    <p className="mt-2 text-sm text-white/60">
                      {new Date(item.tournament.start_at).toLocaleString("ru-RU")}
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-xs uppercase tracking-wide text-white/50">Место</p>
                        <p className="mt-1 text-lg font-semibold">{item.result.place}</p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <p className="text-xs uppercase tracking-wide text-white/50">Очки</p>
                        <p className="mt-1 text-lg font-semibold">{item.result.rating_points}</p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-white/70 underline underline-offset-4">
                      Открыть результаты
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
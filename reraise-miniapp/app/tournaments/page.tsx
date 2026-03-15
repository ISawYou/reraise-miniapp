"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  cancelPlayerRegistration,
  getCompletedTournaments,
  getOpenTournaments,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  registerPlayerForTournament,
} from "@/features/tournaments";
import { PromotionToast } from "@/components/promotion-toast";
import { supabase } from "@/lib/supabase";
import { getTelegramUser } from "@/lib/telegram";
import type { RegistrationStatus, Tournament } from "@/types/domain";

export default function TournamentsPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [completedTournaments, setCompletedTournaments] = useState<Tournament[]>([]);
  const [registrationMap, setRegistrationMap] = useState<Record<string, RegistrationStatus>>({});
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotionToast, setPromotionToast] = useState<string | null>(null);

  const registrationsRef = useRef<Record<string, RegistrationStatus>>({});

  useEffect(() => {
    if (!promotionToast) return;

    const timeout = setTimeout(() => {
      setPromotionToast(null);
    }, 4500);

    return () => clearTimeout(timeout);
  }, [promotionToast]);

  async function refreshPageData(
    currentPlayerId: string,
    options?: { showPromotionToast?: boolean }
  ) {
    const [openData, completedData, registrations, counts] = await Promise.all([
      getOpenTournaments(),
      getCompletedTournaments(),
      getPlayerRegistrations(currentPlayerId),
      getTournamentRegistrationCounts(),
    ]);

    const nextRegistrationMap: Record<string, RegistrationStatus> = {};

    registrations.forEach((registration) => {
      nextRegistrationMap[registration.tournament_id] = registration.status;
    });

    if (options?.showPromotionToast) {
      const promotedTournamentId = Object.keys(nextRegistrationMap).find((tournamentId) => {
        const previousStatus = registrationsRef.current[tournamentId];
        const nextStatus = nextRegistrationMap[tournamentId];

        return previousStatus === "waitlist" && nextStatus === "registered";
      });

      if (promotedTournamentId) {
        const promotedTournament = openData.find(
          (tournament) => tournament.id === promotedTournamentId
        );

        if (promotedTournament) {
          setPromotionToast(
            `Вы переместились из waitlist в основной список: ${promotedTournament.title}`
          );
        } else {
          setPromotionToast("Вы переместились из waitlist в основной список");
        }
      }
    }

    registrationsRef.current = nextRegistrationMap;
    setRegistrationMap(nextRegistrationMap);
    setRegistrationCounts(counts);
    setOpenTournaments(openData);
    setCompletedTournaments(completedData);
  }

  useEffect(() => {
    async function init() {
      try {
        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          throw new Error("Telegram user not found");
        }

        const player = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayerId(player.id);

        await refreshPageData(player.id, { showPromotionToast: false });
      } catch (err) {
        const nextError =
          err instanceof Error ? err.message : "Ошибка загрузки турниров";
        setError(nextError);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  useEffect(() => {
    if (!playerId) return;

    const registrationsChannel = supabase
      .channel(`registrations-realtime-${playerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registrations",
        },
        async () => {
          try {
            await refreshPageData(playerId, { showPromotionToast: true });
          } catch (err) {
            console.error("Registrations realtime refresh error:", err);
          }
        }
      )
      .subscribe();

    const tournamentsChannel = supabase
      .channel(`tournaments-realtime-${playerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournaments",
        },
        async () => {
          try {
            await refreshPageData(playerId, { showPromotionToast: false });
          } catch (err) {
            console.error("Tournaments realtime refresh error:", err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(registrationsChannel);
      supabase.removeChannel(tournamentsChannel);
    };
  }, [playerId]);

  async function handleRegister(tournamentId: string) {
    if (!playerId) return;

    try {
      setActionLoadingId(tournamentId);

      await registerPlayerForTournament(playerId, tournamentId);
      await refreshPageData(playerId, { showPromotionToast: false });
    } catch (err) {
      console.error("Register error:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCancel(tournamentId: string) {
    if (!playerId) return;

    try {
      setActionLoadingId(tournamentId);

      await cancelPlayerRegistration(playerId, tournamentId);
      await refreshPageData(playerId, { showPromotionToast: false });
    } catch (err) {
      console.error("Cancel error:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  function renderActionButton(tournament: Tournament) {
    const currentStatus = registrationMap[tournament.id];
    const registeredCount = registrationCounts[tournament.id] ?? 0;
    const isLoading = actionLoadingId === tournament.id;

    if (!currentStatus) {
      return (
        <button
          type="button"
          onClick={() => handleRegister(tournament.id)}
          disabled={isLoading}
          className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : registeredCount >= tournament.max_players ? "В waitlist" : "Записаться"}
        </button>
      );
    }

    if (currentStatus === "registered") {
      return (
        <button
          type="button"
          onClick={() => handleCancel(tournament.id)}
          disabled={isLoading}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Вы записаны"}
        </button>
      );
    }

    if (currentStatus === "waitlist") {
      return (
        <button
          type="button"
          onClick={() => handleCancel(tournament.id)}
          disabled={isLoading}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Вы в waitlist"}
        </button>
      );
    }

    return null;
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Загружаем турниры...</p>
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

        <h1 className="text-2xl font-bold">Турниры</h1>

        <section className="mt-6">
          <h2 className="text-xl font-semibold">Открытые</h2>

          {openTournaments.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              Сейчас нет открытых турниров
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {openTournaments.map((tournament) => {
                const registeredCount = registrationCounts[tournament.id] ?? 0;
                const currentStatus = registrationMap[tournament.id];

                return (
                  <div
                    key={tournament.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <Link href={`/tournaments/${tournament.id}`} className="block">
                      <h3 className="text-lg font-semibold">{tournament.title}</h3>
                      <p className="mt-2 text-sm text-white/60">
                        {new Date(tournament.start_at).toLocaleString("ru-RU")}
                      </p>
                      <p className="mt-1 text-sm text-white/60">
                        Игроков: {registeredCount} / {tournament.max_players}
                      </p>
                      <p className="mt-1 text-sm text-white/60">
                        {currentStatus === "registered"
                          ? "Статус: вы зарегистрированы"
                          : currentStatus === "waitlist"
                          ? "Статус: вы в waitlist"
                          : registeredCount >= tournament.max_players
                          ? "Статус: свободных мест нет"
                          : "Статус: есть свободные места"}
                      </p>
                    </Link>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Link
                        href={`/tournaments/${tournament.id}`}
                        className="text-sm text-white/70 underline underline-offset-4"
                      >
                        Открыть турнир
                      </Link>

                      {renderActionButton(tournament)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Прошедшие</h2>

          {completedTournaments.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              Пока нет завершённых турниров
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {completedTournaments.map((tournament) => (
                <Link
                  key={tournament.id}
                  href={`/tournaments/${tournament.id}`}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <h3 className="text-lg font-semibold">{tournament.title}</h3>
                  <p className="mt-2 text-sm text-white/60">
                    {new Date(tournament.start_at).toLocaleString("ru-RU")}
                  </p>
                  <p className="mt-1 text-sm text-white/60">Статус: турнир завершён</p>
                  <p className="mt-3 text-sm text-white/70 underline underline-offset-4">
                    Открыть результаты
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {promotionToast ? <PromotionToast message={promotionToast} /> : null}
    </main>
  );
}
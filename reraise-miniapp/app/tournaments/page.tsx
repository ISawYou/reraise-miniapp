"use client";

import { useEffect, useRef, useState } from "react";
import {
  getOpenTournaments,
  registerPlayerForTournament,
  cancelPlayerRegistration,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
} from "@/features/tournaments";

import { ensurePlayerFromTelegramUser } from "@/features/auth";
import { getTelegramUser } from "@/lib/telegram";
import { supabase } from "@/lib/supabase";

import type { Tournament, RegistrationStatus } from "@/types/domain";

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const [registrations, setRegistrations] = useState<
    Record<string, RegistrationStatus>
  >({});
  const [registrationCounts, setRegistrationCounts] = useState<
    Record<string, number>
  >({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionTournamentId, setActionTournamentId] = useState<string | null>(
    null
  );

  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const [promotionToast, setPromotionToast] = useState<string | null>(null);

  const registrationsRef = useRef<Record<string, RegistrationStatus>>({});

  useEffect(() => {
    registrationsRef.current = registrations;
  }, [registrations]);

  useEffect(() => {
    if (!promotionToast) return;

    const timeout = setTimeout(() => {
      setPromotionToast(null);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [promotionToast]);

  async function refreshPageData(
    currentPlayerId: string,
    options?: { showPromotionToast?: boolean }
  ) {
    const [regs, counts, tournamentsData] = await Promise.all([
      getPlayerRegistrations(currentPlayerId),
      getTournamentRegistrationCounts(),
      getOpenTournaments(),
    ]);

    const nextMap: Record<string, RegistrationStatus> = {};

    regs.forEach((r: any) => {
      nextMap[r.tournament_id] = r.status;
    });

    if (options?.showPromotionToast) {
      const promotedTournamentId = Object.keys(nextMap).find((tournamentId) => {
        const previousStatus = registrationsRef.current[tournamentId];
        const nextStatus = nextMap[tournamentId];

        return previousStatus === "waitlist" && nextStatus === "registered";
      });

      if (promotedTournamentId) {
        const promotedTournament = tournamentsData.find(
          (tournament) => tournament.id === promotedTournamentId
        );

        if (promotedTournament) {
          setPromotionToast(
            `🎉 Вы переместились из waitlist в основной список: ${promotedTournament.title}`
          );
        } else {
          setPromotionToast(
            "🎉 Вы переместились из waitlist в основной список"
          );
        }
      }
    }

    setRegistrations(nextMap);
    setRegistrationCounts(counts);
    setTournaments(tournamentsData);
  }

  async function handleRegister(tournamentId: string) {
    if (!playerId) return;

    try {
      setActionTournamentId(tournamentId);

      const result = await registerPlayerForTournament(playerId, tournamentId);

      setRegistrations((prev) => ({
        ...prev,
        [tournamentId]: result.status,
      }));

      setRegistrationCounts((prev) => {
        const current = prev[tournamentId] ?? 0;

        if (result.status === "registered") {
          return {
            ...prev,
            [tournamentId]: current + 1,
          };
        }

        return prev;
      });

      if (result.status === "registered") {
        setModalMessage("Вы записаны на турнир");
      } else if (result.status === "waitlist") {
        setModalMessage("Вы добавлены в waitlist");
      }

      await refreshPageData(playerId, { showPromotionToast: false });
    } catch (err) {
      alert("Ошибка записи");
    } finally {
      setActionTournamentId(null);
    }
  }

  async function handleCancel(tournamentId: string) {
    if (!playerId) return;

    const currentStatus = registrations[tournamentId];

    try {
      setActionTournamentId(tournamentId);

      await cancelPlayerRegistration(playerId, tournamentId);

      setRegistrations((prev) => {
        const next = { ...prev };
        delete next[tournamentId];
        return next;
      });

      if (currentStatus === "registered") {
        setModalMessage("Запись на турнир отменена");
      } else if (currentStatus === "waitlist") {
        setModalMessage("Вы вышли из waitlist");
      }

      await refreshPageData(playerId, { showPromotionToast: false });
    } catch (err) {
      alert("Ошибка отмены записи");
    } finally {
      setActionTournamentId(null);
    }
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
        const message =
          err instanceof Error ? err.message : "Unknown tournaments error";

        setError(message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  useEffect(() => {
    if (!playerId) return;

    const channel = supabase
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
            console.error("Realtime refresh error:", err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [playerId]);

  function getStatusLabel(tournament: Tournament) {
    const myStatus = registrations[tournament.id];
    const registeredCount = registrationCounts[tournament.id] ?? 0;
    const isFull = registeredCount >= tournament.max_players;

    if (myStatus === "registered") {
      return "Статус: вы зарегистрированы";
    }

    if (myStatus === "waitlist") {
      return "Статус: вы в waitlist";
    }

    if (isFull) {
      return "Статус: свободных мест нет";
    }

    return "Статус: есть свободные места";
  }

  function renderButton(tournamentId: string) {
    const status = registrations[tournamentId];
    const isLoading = actionTournamentId === tournamentId;

    if (!status) {
      return (
        <button
          onClick={() => handleRegister(tournamentId)}
          disabled={isLoading}
          className="mt-3 w-full rounded-lg bg-yellow-500 py-2 text-black font-semibold disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Записаться"}
        </button>
      );
    }

    if (status === "registered") {
      return (
        <button
          onClick={() => handleCancel(tournamentId)}
          disabled={isLoading}
          className="mt-3 w-full rounded-lg bg-green-600 py-2 font-semibold disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Отменить запись"}
        </button>
      );
    }

    if (status === "waitlist") {
      return (
        <button
          onClick={() => handleCancel(tournamentId)}
          disabled={isLoading}
          className="mt-3 w-full rounded-lg bg-orange-500 py-2 font-semibold disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Выйти из waitlist"}
        </button>
      );
    }

    return null;
  }

  return (
    <>
      <main className="min-h-screen bg-neutral-950 p-6 text-white">
        <div className="mx-auto max-w-md space-y-6">
          <h1 className="text-3xl font-bold">Турниры</h1>

          {loading && <p className="text-neutral-400">Загружаем турниры...</p>}

          {error && <p className="text-red-400">{error}</p>}

          {!loading && tournaments.length === 0 && (
            <p className="text-neutral-400">Открытых турниров пока нет</p>
          )}

          {tournaments.map((tournament) => {
            const registeredCount = registrationCounts[tournament.id] ?? 0;

            return (
              <div
                key={tournament.id}
                className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <h2 className="text-lg font-semibold">{tournament.title}</h2>

                <p className="mt-1 text-sm text-neutral-400">
                  {new Date(tournament.start_at).toLocaleString()}
                </p>

                <p className="mt-1 text-sm text-neutral-400">
                  Игроков: {registeredCount} / {tournament.max_players}
                </p>

                <p className="mt-1 text-sm text-neutral-300">
                  {getStatusLabel(tournament)}
                </p>

                {renderButton(tournament.id)}
              </div>
            );
          })}
        </div>
      </main>

      {promotionToast && (
        <div className="fixed left-4 right-4 top-4 z-50 flex justify-center">
          <div className="w-full max-w-md animate-pulse rounded-2xl border border-green-500/40 bg-green-500/15 px-4 py-3 text-sm font-medium text-green-200 shadow-lg backdrop-blur">
            {promotionToast}
          </div>
        </div>
      )}

      {modalMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-xl">
            <h2 className="text-lg font-semibold">Готово</h2>

            <p className="mt-3 text-sm text-neutral-300">{modalMessage}</p>

            <button
              onClick={() => setModalMessage(null)}
              className="mt-5 w-full rounded-lg bg-yellow-500 py-2 font-semibold text-black"
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PromotionToast } from "@/components/promotion-toast";
import { ensurePlayerFromTelegramUser, ensurePlayerFromEmail } from "@/features/auth";
import {
  cancelPlayerRegistration,
  getVisibleCompletedTournamentsForPlayer,
  getVisibleOpenTournamentsForPlayer,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  registerPlayerForTournament,
} from "@/features/tournaments";
import { supabase } from "@/lib/supabase";
import { getTelegramUser } from "@/lib/telegram";
import type {
  Player,
  RegistrationStatus,
  Tournament,
  TournamentKind,
} from "@/types/domain";

type TabKey = "active" | "completed";
type TournamentFilterKey = TournamentKind;

function ArrowUpRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 12h15.5" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3.5v3" />
      <path d="M16.5 3.5v3" />
      <path d="M3.5 9.5h17" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function formatTournamentDate(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTournamentKindLabel(kind: Tournament["kind"]) {
  if (kind === "paid") {
    return "Платный";
  }

  if (kind === "cash") {
    return "Кэш";
  }

  return "Бесплатный";
}

export default function TournamentsPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [completedTournaments, setCompletedTournaments] = useState<Tournament[]>(
    []
  );
  const [registrationMap, setRegistrationMap] = useState<
    Record<string, RegistrationStatus>
  >({});
  const [registrationCounts, setRegistrationCounts] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotionToast, setPromotionToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("active");
  const [activeFilter, setActiveFilter] = useState<TournamentFilterKey>("free");

  const registrationsRef = useRef<Record<string, RegistrationStatus>>({});
  const availableFilters: TournamentFilterKey[] = [
    ...(player?.can_access_free ?? true ? (["free"] as TournamentFilterKey[]) : []),
    ...(player?.can_access_paid ? (["paid"] as TournamentFilterKey[]) : []),
    ...(player?.can_access_cash ? (["cash"] as TournamentFilterKey[]) : []),
  ];
  const showTournamentKindFilters = availableFilters.length > 1;
  const showTournamentKindTags = showTournamentKindFilters;
  const filteredOpenTournaments = openTournaments.filter(
    (tournament) => tournament.kind === activeFilter
  );
  const filteredCompletedTournaments = completedTournaments.filter(
    (tournament) => tournament.kind === activeFilter
  );

  useEffect(() => {
    if (!promotionToast) return;

    const timeout = setTimeout(() => {
      setPromotionToast(null);
    }, 4500);

    return () => clearTimeout(timeout);
  }, [promotionToast]);

  useEffect(() => {
    if (!availableFilters.includes(activeFilter)) {
      setActiveFilter(availableFilters[0] ?? "free");
    }
  }, [activeFilter, availableFilters]);

  async function refreshPageData(
    currentPlayer: Player,
    options?: { showPromotionToast?: boolean }
  ) {
    const [openData, completedData, registrations, counts] = await Promise.all([
      getVisibleOpenTournamentsForPlayer(currentPlayer),
      getVisibleCompletedTournamentsForPlayer(currentPlayer),
      getPlayerRegistrations(currentPlayer.id),
      getTournamentRegistrationCounts(),
    ]);

    const nextRegistrationMap: Record<string, RegistrationStatus> = {};

    registrations.forEach((registration) => {
      nextRegistrationMap[registration.tournament_id] = registration.status;
    });

    if (options?.showPromotionToast) {
      const promotedTournamentId = Object.keys(nextRegistrationMap).find(
        (tournamentId) => {
          const previousStatus = registrationsRef.current[tournamentId];
          const nextStatus = nextRegistrationMap[tournamentId];

          return previousStatus === "waitlist" && nextStatus === "registered";
        }
      );

      if (promotedTournamentId) {
        const promotedTournament = openData.find(
          (tournament) => tournament.id === promotedTournamentId
        );

        if (promotedTournament) {
          setPromotionToast(
            `Вы переместились из списка ожидания в основной список: ${promotedTournament.title}`
          );
        } else {
          setPromotionToast(
            "Вы переместились из списка ожидания в основной список"
          );
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
        let currentPlayer: Player;

        if (telegramUser) {
          currentPlayer = await ensurePlayerFromTelegramUser(telegramUser);
        } else {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user?.email) {
            throw new Error("Необходимо войти в систему");
          }
          currentPlayer = await ensurePlayerFromEmail(session.user.email);
        }

        setPlayer(currentPlayer);
        setPlayerId(currentPlayer.id);

        await refreshPageData(currentPlayer, { showPromotionToast: false });
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
    if (!playerId || !player) return;

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
            await refreshPageData(player, { showPromotionToast: true });
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
            await refreshPageData(player, { showPromotionToast: false });
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
  }, [player, playerId]);

  async function handleRegister(tournamentId: string) {
    if (!playerId || !player) return;

    try {
      setActionLoadingId(tournamentId);

      await registerPlayerForTournament(playerId, tournamentId);
      await refreshPageData(player, { showPromotionToast: false });
    } catch (err) {
      console.error("Register error:", err);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCancel(tournamentId: string) {
    if (!playerId || !player) return;

    try {
      setActionLoadingId(tournamentId);

      await cancelPlayerRegistration(playerId, tournamentId);
      await refreshPageData(player, { showPromotionToast: false });
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
          className="w-full rounded-2xl bg-yellow-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
        >
          {isLoading
            ? "Сохраняем..."
            : registeredCount >= tournament.max_players
              ? "Встать в список ожидания"
              : "Записаться"}
        </button>
      );
    }

    if (currentStatus === "registered") {
      return (
        <button
          type="button"
          onClick={() => handleCancel(tournament.id)}
          disabled={isLoading}
          className="w-full rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
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
          className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Вы в списке ожидания"}
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
            className="telegram-top-action inline-flex items-center rounded-full border border-white/[0.08] bg-transparent px-3.5 py-2 text-sm text-white/60"
          >
            ← Назад
          </Link>

          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
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
          className="telegram-top-action inline-flex items-center rounded-full border border-white/[0.08] bg-transparent px-3.5 py-2 text-sm text-white/60"
        >
          ← Назад
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Турниры</h1>
        <p className="mt-2 text-sm text-white/45">
          Активные и завершённые события
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`rounded-full border px-4 py-3 text-sm font-medium transition ${
              activeTab === "active"
                ? "border-white/15 bg-white/[0.08] text-white"
                : "border-white/10 bg-transparent text-white/60"
            }`}
          >
            Активные ({openTournaments.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("completed")}
            className={`rounded-full border px-4 py-3 text-sm font-medium transition ${
              activeTab === "completed"
                ? "border-white/15 bg-white/[0.08] text-white"
                : "border-white/10 bg-transparent text-white/60"
            }`}
          >
            Прошедшие ({completedTournaments.length})
          </button>
        </div>

        {showTournamentKindFilters ? (
          <div
            className={`mt-2 grid gap-3 ${
              availableFilters.length === 2 ? "grid-cols-2" : "grid-cols-3"
            }`}
          >
            {availableFilters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={`rounded-full border px-4 py-3 text-sm font-medium transition ${
                  activeFilter === filter
                    ? "border-white/15 bg-white/[0.08] text-white"
                    : "border-white/10 bg-transparent text-white/60"
                }`}
              >
                {filter === "free"
                  ? "Бесплатные"
                  : filter === "paid"
                    ? "Платные"
                    : "Кэш-игра"}
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === "active" ? (
          <section className="mt-5">
            {filteredOpenTournaments.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-sm text-white/60">
                Сейчас нет турниров в этом разделе
              </div>
            ) : (
              <div className="space-y-4">
                {filteredOpenTournaments.map((tournament) => {
                  const registeredCount = registrationCounts[tournament.id] ?? 0;

                  return (
                    <Link
                      key={tournament.id}
                      href={`/tournaments/${tournament.id}`}
                      className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold">{tournament.title}</h3>
                          {showTournamentKindTags ? (
                            <span className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">
                              {getTournamentKindLabel(tournament.kind)}
                            </span>
                          ) : null}
                        </div>
                        <div className="inline-flex items-center text-white/55">
                          <ArrowUpRightIcon />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-white/75">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-2">
                          <CalendarIcon />
                          <span>{formatTournamentDate(tournament.start_at)}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-2">
                          <UserIcon />
                          <span>{registeredCount} / {tournament.max_players}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div onClick={(event) => event.preventDefault()}>
                          {renderActionButton(tournament)}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="mt-5">
            {filteredCompletedTournaments.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-sm text-white/60">
                Пока нет турниров в этом разделе
              </div>
            ) : (
              <div className="space-y-4">
                {filteredCompletedTournaments.map((tournament) => (
                  <Link
                    key={tournament.id}
                    href={`/tournaments/${tournament.id}`}
                    className="block rounded-3xl border border-white/10 bg-white/[0.05] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold">{tournament.title}</h3>
                        {showTournamentKindTags ? (
                          <span className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80">
                            {getTournamentKindLabel(tournament.kind)}
                          </span>
                        ) : null}
                      </div>
                      <div className="inline-flex items-center text-white/45">
                        <ArrowUpRightIcon />
                      </div>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white/75">
                      <CalendarIcon />
                      <span>{formatTournamentDate(tournament.start_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {promotionToast ? <PromotionToast message={promotionToast} /> : null}
    </main>
  );
}

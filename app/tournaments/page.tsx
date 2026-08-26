"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PromotionToast } from "@/components/promotion-toast";
import { resolveCurrentPlayer } from "@/lib/current-player";
import { logEvent } from "@/lib/activity-client";
import {
  cancelPlayerRegistration,
  getVisibleTournamentsForPlayer,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  registerPlayerForTournament,
} from "@/features/tournaments";
import { supabase } from "@/lib/supabase";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { fetchTournamentVisualConfigs } from "@/lib/tournament-visuals-client";
import type { Player, RegistrationStatus, Tournament } from "@/types/domain";

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

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-6"
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

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 4.25 4.25L19 6.5" />
    </svg>
  );
}

function formatTournamentDate(date: string) {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

function formatTournamentTime(date: string) {
  return new Date(date).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pluralize(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatTournamentCountdown(date: string) {
  const diffMs = new Date(date).getTime() - Date.now();

  if (diffMs <= 0) {
    return "Старт уже начался";
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0) {
    if (hours > 0) {
      return `Старт через ${days} ${pluralize(days, "день", "дня", "дней")} ${hours} ${pluralize(hours, "час", "часа", "часов")}`;
    }

    return `Старт через ${days} ${pluralize(days, "день", "дня", "дней")}`;
  }

  return `Старт через ${Math.max(hours, 1)} ${pluralize(Math.max(hours, 1), "час", "часа", "часов")}`;
}

export default function TournamentsPage() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [completedTournaments, setCompletedTournaments] = useState<Tournament[]>([]);
  const [registrationMap, setRegistrationMap] = useState<Record<string, RegistrationStatus>>({});
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [tournamentVisuals, setTournamentVisuals] = useState<Record<string, TournamentVisualConfig>>({});
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
    currentPlayer: Player,
    options?: { showPromotionToast?: boolean }
  ) {
    const [tournamentsData, registrations, counts] = await Promise.all([
      getVisibleTournamentsForPlayer(currentPlayer),
      getPlayerRegistrations(currentPlayer.id),
      getTournamentRegistrationCounts(),
    ]);

    const { open: openData, completed: completedData } = tournamentsData;
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
            `Вы переместились из списка ожидания в основной список: ${promotedTournament.title}`
          );
        } else {
          setPromotionToast("Вы переместились из списка ожидания в основной список");
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
        const currentPlayer: Player = await resolveCurrentPlayer();

        setPlayer(currentPlayer);
        setPlayerId(currentPlayer.id);
        logEvent("page_view_tournaments");

        void fetchTournamentVisualConfigs().then(setTournamentVisuals);
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
          className="inline-flex min-w-[152px] items-center justify-center rounded-xl bg-[#d7b55a] px-4 py-2.5 text-sm font-semibold text-black transition disabled:opacity-60"
        >
          {isLoading
            ? "Сохраняем..."
            : registeredCount >= tournament.max_players
              ? "Лист ожидания"
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
          className="inline-flex min-w-[152px] items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/14 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition disabled:opacity-60"
        >
          <CheckIcon />
          <span>{isLoading ? "Сохраняем..." : "Вы записаны"}</span>
        </button>
      );
    }

    if (currentStatus === "waitlist") {
      return (
        <button
          type="button"
          onClick={() => handleCancel(tournament.id)}
          disabled={isLoading}
          className="inline-flex min-w-[152px] items-center justify-center rounded-xl border border-amber-400/20 bg-amber-500/12 px-4 py-2.5 text-sm font-semibold text-amber-100 transition disabled:opacity-60"
        >
          {isLoading ? "Сохраняем..." : "Вы в листе ожидания"}
        </button>
      );
    }

    return null;
  }

  function renderOpenTournamentCard(tournament: Tournament) {
    const registeredCount = registrationCounts[tournament.id] ?? 0;
    const prizePlaces = getExpectedPrizePlaces(registeredCount);
    const fillPercent =
      tournament.max_players > 0
        ? Math.min((registeredCount / tournament.max_players) * 100, 100)
        : 0;

    return (
      <Link
        key={tournament.id}
        href={`/tournaments/${tournament.id}`}
        className="relative block overflow-hidden rounded-[28px] border border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.32)] transition active:scale-[0.99]"
      >
        <TournamentVisual
          tournamentType={tournament.tournament_type}
          configs={tournamentVisuals}
          className="z-0"
        />

        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[22px] font-black uppercase leading-tight tracking-[0.05em] text-white">
                {tournament.title}
              </h3>
            </div>

            <div className="pt-1 text-white/35">
              <ArrowRightIcon />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/72">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/72">
              <CalendarIcon />
              <span>{formatTournamentDate(tournament.start_at)}</span>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/72">
              <span>{formatTournamentTime(tournament.start_at)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <UserIcon />
                <span>
                  {registeredCount} / {tournament.max_players}
                </span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white/28"
                  style={{ width: `${fillPercent}%` }}
                />
              </div>
            </div>

            <p className="shrink-0 text-sm font-semibold text-[#e1bf6b]">
              🏆 ТОП-{prizePlaces}
            </p>
          </div>

          <p className="mt-3 text-sm text-white/54">
            {formatTournamentCountdown(tournament.start_at)}
          </p>

          <div className="mt-4" onClick={(event) => event.preventDefault()}>
            {renderActionButton(tournament)}
          </div>
        </div>
      </Link>
    );
  }

  function renderCompletedTournamentCard(tournament: Tournament) {
    return (
      <Link
        key={tournament.id}
        href={`/tournaments/${tournament.id}`}
        className="flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3.5 transition active:scale-[0.99]"
      >
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">{tournament.title}</p>
          <p className="mt-1 text-sm text-white/48">{formatTournamentDate(tournament.start_at)}</p>
        </div>

        <div className="shrink-0 text-white/28">
          <ArrowRightIcon />
        </div>
      </Link>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#090b0a] px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Загружаем турниры...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#090b0a] px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_80%_32%_at_50%_-5%,rgba(76,116,95,0.2),transparent_58%),linear-gradient(180deg,#09100d_0%,#090b0a_38%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 right-0 top-0 h-48 bg-[radial-gradient(ellipse_65%_45%_at_50%_0%,rgba(121,169,137,0.08),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-white">Турниры</h1>

        <section className="mt-5">
          {openTournaments.length === 0 ? (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4 text-sm text-white/60">
              Сейчас нет открытых турниров
            </div>
          ) : (
            <div className="space-y-4">
              {openTournaments.map((tournament) => renderOpenTournamentCard(tournament))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Прошедшие турниры</h2>
            <span className="text-xs uppercase tracking-[0.14em] text-white/30">
              {completedTournaments.length}
            </span>
          </div>

          {completedTournaments.length === 0 ? (
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/55">
              Пока нет завершённых турниров
            </div>
          ) : (
            <div className="space-y-2.5">
              {completedTournaments.map((tournament) =>
                renderCompletedTournamentCard(tournament)
              )}
            </div>
          )}
        </section>
      </div>

      {promotionToast ? <PromotionToast message={promotionToast} /> : null}
    </main>
  );
}

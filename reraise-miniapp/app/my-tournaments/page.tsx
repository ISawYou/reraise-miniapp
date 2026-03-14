"use client";

import { useEffect, useRef, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getMyTournaments,
  getPlayerRegistrations,
  getOpenTournaments,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import { supabase } from "@/lib/supabase";
import { PromotionToast } from "@/components/promotion-toast";
import { BottomNav } from "@/components/bottom-nav";

import type {
  Tournament,
  Registration,
  RegistrationStatus,
} from "@/types/domain";

type MyTournamentItem = {
  registration: Registration;
  tournament: Tournament;
};

export default function MyTournamentsPage() {
  const [items, setItems] = useState<MyTournamentItem[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    const [myItems, regs, tournaments] = await Promise.all([
      getMyTournaments(currentPlayerId),
      getPlayerRegistrations(currentPlayerId),
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
        const promotedTournament = tournaments.find(
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

    registrationsRef.current = nextMap;
    setItems(myItems);
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
          err instanceof Error ? err.message : "Unknown my tournaments error";

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
      .channel(`my-tournaments-realtime-${playerId}`)
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
            console.error("My tournaments realtime refresh error:", err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [playerId]);

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
    <>
      <main className="min-h-screen bg-neutral-950 p-6 pb-28 text-white">
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

      {promotionToast && <PromotionToast message={promotionToast} />}
      <BottomNav />
    </>
  );
}
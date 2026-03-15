"use client";

import { useEffect, useRef, useState } from "react";
import {
  getTelegramUser,
  getTelegramWebApp,
  type TelegramWebAppUser,
} from "@/lib/telegram";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getPlayerRegistrations,
  getOpenTournaments,
} from "@/features/tournaments";
import { supabase } from "@/lib/supabase";
import { PromotionToast } from "@/components/promotion-toast";

import type { Player, RegistrationStatus, Tournament } from "@/types/domain";

export default function HomePage() {
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [checkedTelegram, setCheckedTelegram] = useState(false);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [promotionToast, setPromotionToast] = useState<string | null>(null);

  const registrationsRef = useRef<Record<string, RegistrationStatus>>({});

  useEffect(() => {
    if (!promotionToast) return;

    const timeout = setTimeout(() => {
      setPromotionToast(null);
    }, 4500);

    return () => clearTimeout(timeout);
  }, [promotionToast]);

  async function refreshPromotionState(
    currentPlayerId: string,
    options?: { showPromotionToast?: boolean }
  ) {
    const [regs, tournaments] = await Promise.all([
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
          (tournament: Tournament) => tournament.id === promotedTournamentId
        );

        if (promotedTournament) {
          setPromotionToast(
            `🎉 Вы переместились из waitlist в основной список: ${promotedTournament.title}`
          );
        } else {
          setPromotionToast("🎉 Вы переместились из waitlist в основной список");
        }
      }
    }

    registrationsRef.current = nextMap;
  }

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const webApp = getTelegramWebApp();

        if (webApp) {
          setIsInsideTelegram(true);
          webApp.ready?.();
          webApp.expand?.();
        }

        const telegramUser = getTelegramUser();
        setUser(telegramUser);
        setCheckedTelegram(true);

        if (telegramUser) {
          setPlayerLoading(true);
          setPlayerError(null);

          const ensuredPlayer = await ensurePlayerFromTelegramUser(telegramUser);
          setPlayer(ensuredPlayer);

          await refreshPromotionState(ensuredPlayer.id, {
            showPromotionToast: false,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown player sync error";
        setPlayerError(message);
      } finally {
        setPlayerLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!player?.id) return;

    const channel = supabase
      .channel(`home-registrations-realtime-${player.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registrations",
        },
        async () => {
          try {
            await refreshPromotionState(player.id, {
              showPromotionToast: true,
            });
          } catch (error) {
            console.error("Home realtime refresh error:", error);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [player?.id]);

  return (
    <>
      <main className="min-h-screen bg-neutral-950 p-6 text-white">
        <div className="mx-auto max-w-md space-y-6">
          <div>
            <h1 className="text-3xl font-bold">ReRaise Poker Club</h1>
            <p className="mt-2 text-sm text-neutral-400">
              Управляемый клубный MVP внутри Telegram
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="text-lg font-semibold">Telegram Mini App</h2>

            {!checkedTelegram && (
              <p className="mt-2 text-sm text-neutral-300">
                Проверяем Telegram...
              </p>
            )}

            {checkedTelegram && !isInsideTelegram && (
              <p className="mt-2 text-sm text-neutral-300">
                Приложение открыто вне Telegram
              </p>
            )}

            {checkedTelegram && isInsideTelegram && !user && (
              <p className="mt-2 text-sm text-neutral-300">
                Telegram открыт, но данные пользователя пока недоступны
              </p>
            )}

            {user && (
              <div className="mt-3 space-y-2 text-sm text-neutral-200">
                <p>
                  <span className="text-neutral-400">first_name:</span>{" "}
                  {user.first_name}
                </p>
                <p>
                  <span className="text-neutral-400">username:</span>{" "}
                  {user.username ? `@${user.username}` : "не указан"}
                </p>
                <p>
                  <span className="text-neutral-400">telegram id:</span>{" "}
                  {user.id}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="text-lg font-semibold">Игрок в базе</h2>

            {playerLoading && (
              <p className="mt-2 text-sm text-neutral-300">
                Синхронизируем игрока...
              </p>
            )}

            {playerError && (
              <p className="mt-2 text-sm text-red-400">{playerError}</p>
            )}

            {!playerLoading && !playerError && !player && (
              <p className="mt-2 text-sm text-neutral-300">
                Игрок пока не синхронизирован
              </p>
            )}

            {player && (
              <div className="mt-3 space-y-2 text-sm text-neutral-200">
                <p>
                  <span className="text-neutral-400">player id:</span>{" "}
                  {player.id}
                </p>
                <p>
                  <span className="text-neutral-400">display_name:</span>{" "}
                  {player.display_name}
                </p>
                <p>
                  <span className="text-neutral-400">username:</span>{" "}
                  {player.username ? `@${player.username}` : "не указан"}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3">
            <a
              href="/tournaments"
              className="rounded-xl bg-yellow-500 px-4 py-3 text-center font-semibold text-black"
            >
              Турниры
            </a>

            <a
              href="/my-tournaments"
              className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
            >
              Мои турниры
            </a>

            <a
              href="/status"
              className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
            >
              Мой статус
            </a>

            <a
              href="/rating"
              className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
            >
              Рейтинг
            </a>

      {player?.role === "admin" ? (
            <a
            href="/admin"
            className="rounded-xl border border-neutral-700 px-4 py-3 text-center"
            >
              Админ-панель
            </a>
        ) : null}
          </div>
        </div>
      </main>

      {promotionToast && <PromotionToast message={promotionToast} />}
    </>
  );
}
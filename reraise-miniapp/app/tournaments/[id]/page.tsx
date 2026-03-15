"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getTournamentById,
  getTournamentParticipants,
  getPlayerRegistrations,
  getTournamentRegistrationCounts,
  registerPlayerForTournament,
  cancelPlayerRegistration,
} from "@/features/tournaments";
import { getTelegramUser } from "@/lib/telegram";
import type {
  RegistrationStatus,
  Tournament,
  TournamentParticipant,
} from "@/types/domain";

type TabKey = "about" | "participants";

export default function TournamentDetailsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [registeredCount, setRegisteredCount] = useState(0);

  const [activeTab, setActiveTab] = useState<TabKey>("about");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshPageData(currentPlayerId: string, currentTournamentId: string) {
    const [tournamentData, participantsData, registrations, counts] = await Promise.all([
      getTournamentById(currentTournamentId),
      getTournamentParticipants(currentTournamentId),
      getPlayerRegistrations(currentPlayerId),
      getTournamentRegistrationCounts(),
    ]);

    const myRegistration =
      registrations.find((item) => item.tournament_id === currentTournamentId) ?? null;

    setTournament(tournamentData);
    setParticipants(participantsData);
    setRegistrationStatus(myRegistration?.status ?? null);
    setRegisteredCount(counts[currentTournamentId] ?? 0);
  }

  useEffect(() => {
    async function init() {
      try {
        if (!tournamentId) {
          throw new Error("Tournament id not found");
        }

        const telegramUser = getTelegramUser();

        if (!telegramUser) {
          throw new Error("Telegram user not found");
        }

        const player = await ensurePlayerFromTelegramUser(telegramUser);
        setPlayerId(player.id);

        await refreshPageData(player.id, tournamentId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown tournament details error";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [tournamentId]);

  async function handleRegister() {
    if (!playerId || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      const result = await registerPlayerForTournament(playerId, tournamentId);

      if (result.status === "registered") {
        setMessage("Вы записаны на турнир");
      } else if (result.status === "waitlist") {
        setMessage("Вы добавлены в waitlist");
      }

      await refreshPageData(playerId, tournamentId);
    } catch (err) {
      setMessage("Ошибка записи");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!playerId || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      await cancelPlayerRegistration(playerId, tournamentId);

      if (registrationStatus === "registered") {
        setMessage("Запись на турнир отменена");
      } else if (registrationStatus === "waitlist") {
        setMessage("Вы вышли из waitlist");
      }

      await refreshPageData(playerId, tournamentId);
    } catch (err) {
      setMessage("Ошибка отмены записи");
    } finally {
      setActionLoading(false);
    }
  }

  function renderActionButton() {
    if (!tournament) return null;

    if (!registrationStatus) {
      return (
        <button
          type="button"
          onClick={handleRegister}
          disabled={actionLoading}
          className="mt-5 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-60"
        >
          {actionLoading ? "Сохраняем..." : "Записаться на турнир"}
        </button>
      );
    }

    if (registrationStatus === "registered") {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={actionLoading}
          className="mt-5 w-full rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-60"
        >
          {actionLoading ? "Сохраняем..." : "Отменить запись"}
        </button>
      );
    }

    if (registrationStatus === "waitlist") {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={actionLoading}
          className="mt-5 w-full rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-60"
        >
          {actionLoading ? "Сохраняем..." : "Выйти из waitlist"}
        </button>
      );
    }

    return null;
  }

  function getStatusText() {
    if (!tournament) return "";

    if (registrationStatus === "registered") {
      return "Статус: вы зарегистрированы";
    }

    if (registrationStatus === "waitlist") {
      return "Статус: вы в waitlist";
    }

    if (registeredCount >= tournament.max_players) {
      return "Статус: свободных мест нет";
    }

    return "Статус: есть свободные места";
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-sm text-white/70">Загружаем турнир...</p>
        </div>
      </main>
    );
  }

  if (error || !tournament) {
    return (
      <main className="min-h-screen bg-black px-4 py-6 text-white">
        <div className="mx-auto max-w-md">
          <Link
            href="/tournaments"
            className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </Link>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Турнир не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href="/tournaments"
          className="mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </Link>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-red-900/60 to-black p-5">
          <p className="text-sm text-white/60">Турнир</p>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-wide">
            {tournament.title}
          </h1>

          <div className="mt-4 flex gap-2 text-sm text-white/80">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
              {new Date(tournament.start_at).toLocaleString("ru-RU")}
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
              {registeredCount} / {tournament.max_players}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("about")}
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "about"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            О турнире
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("participants")}
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "participants"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            Участники ({participants.length}/{tournament.max_players})
          </button>
        </div>

        {activeTab === "about" ? (
          <div className="mt-6 space-y-6">
            <section>
              <h2 className="text-2xl font-bold">Когда</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base">{new Date(tournament.start_at).toLocaleString("ru-RU")}</p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold">Где</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base text-white/70">Место проведения добавим следующим шагом</p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold">Статус</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-base">{getStatusText()}</p>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold">Регистрация</h2>
              <div className="mt-3 rounded-xl border border-white/10 bg-red-900/30 p-4">
                <p className="text-sm text-white/80">
                  Если планы изменились, пожалуйста, отменяйте регистрацию заранее,
                  чтобы освободить место для игроков из waitlist.
                </p>

                {renderActionButton()}

                {message ? (
                  <p className="mt-3 text-sm text-white/80">{message}</p>
                ) : null}
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
            <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>#</div>
              <div>Ник</div>
              <div className="text-right">Рейтинг</div>
            </div>

            {participants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Пока участников нет</div>
            ) : (
              participants.map((participant, index) => (
                <div
                  key={participant.registration_id}
                  className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                  <div>
                    <p className="text-sm font-medium text-white">
                      {participant.username
                        ? `@${participant.username}`
                        : participant.display_name}
                    </p>
                    {!participant.username ? (
                      <p className="mt-1 text-xs text-white/50">{participant.display_name}</p>
                    ) : null}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {participant.rating}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
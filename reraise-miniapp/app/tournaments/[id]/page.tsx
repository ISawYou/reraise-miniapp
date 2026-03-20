"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ensurePlayerFromTelegramUser } from "@/features/auth";
import {
  getTournamentById,
  getTournamentParticipants,
  getTournamentResults,
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
  TournamentResult,
} from "@/types/domain";

type TabKey = "about" | "participants" | "results";

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

function PinIcon() {
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
      <path d="M12 20s6-4.35 6-10a6 6 0 1 0-12 0c0 5.65 6 10 6 10Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

function NoteIcon() {
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
      <path d="M7 4.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6A1.5 1.5 0 0 1 7.5 4.5Z" />
      <path d="M14 4.5V9h4" />
      <path d="M9 12.5h6" />
      <path d="M9 16h4.5" />
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

function formatTournamentDateParts(date: string) {
  const value = new Date(date);

  return {
    date: value.toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    time: value.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export default function TournamentDetailsPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params?.id;

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [results, setResults] = useState<TournamentResult[]>([]);
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [registeredCount, setRegisteredCount] = useState(0);

  const [activeTab, setActiveTab] = useState<TabKey>("about");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tournamentDateParts = tournament
    ? formatTournamentDateParts(tournament.start_at)
    : null;
  const registeredParticipants = participants.filter(
  (participant) =>
    participant.status === "registered" || participant.status === "attended"
);

const waitlistParticipants = participants.filter(
  (participant) => participant.status === "waitlist"
);

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

    if (tournamentData.status === "completed") {
      const resultsData = await getTournamentResults(currentTournamentId);
      setResults(resultsData);
    } else {
      setResults([]);
    }
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
        setMessage("Вы добавлены в список ожидания");
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
        setMessage("Вы вышли из списка ожидания");
      }

      await refreshPageData(playerId, tournamentId);
    } catch (err) {
      setMessage("Ошибка отмены записи");
    } finally {
      setActionLoading(false);
    }
  }

  function renderActionButton() {
    if (!tournament || tournament.status === "completed") return null;

    if (!registrationStatus) {
  return (
    <button
      type="button"
      onClick={handleRegister}
      disabled={actionLoading}
      className="mt-5 w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-60"
    >
      {actionLoading
        ? "Сохраняем..."
        : registeredCount >= tournament.max_players
        ? "Встать в список ожидания"
        : "Записаться на турнир"}
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
          {actionLoading ? "Сохраняем..." : "Вы записаны"}
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
          {actionLoading ? "Сохраняем..." : "Выйти из списка ожидания"}
        </button>
      );
    }

    return null;
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

          <div className="mt-4 flex flex-wrap gap-2 text-sm text-white/80">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
              {formatTournamentDate(tournament.start_at)}
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
            onClick={() =>
              setActiveTab(tournament.status === "completed" ? "results" : "participants")
            }
            className={`rounded-full border px-4 py-3 text-sm font-medium ${
              activeTab === "participants" || activeTab === "results"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            {tournament.status === "completed"
              ? `Результаты (${results.length})`
              : `Участники (${registeredParticipants.length})`}
          </button>
        </div>

        {activeTab === "about" ? (
          <div className="mt-6 space-y-6">
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <CalendarIcon />
                  <span>Время</span>
                </div>
                <p className="mt-6 text-lg font-semibold text-white">
                  {tournamentDateParts?.date}
                </p>
                <p className="mt-2 text-base text-white/65">
                  {tournamentDateParts?.time}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <PinIcon />
                  <span>Место</span>
                </div>
                <p className="mt-6 text-lg font-semibold text-white">
                  {tournament.location || "Место не указано"}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <NoteIcon />
                <span>Описание</span>
              </div>
              <p className="mt-4 text-base leading-7 text-white/80">
                {tournament.description || "Описание не добавлено"}
              </p>
            </section>

            {tournament.status !== "completed" ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                <h2 className="text-2xl font-bold">Регистрация</h2>
                <div className="mt-4 rounded-2xl border border-white/10 bg-red-900/20 p-4">
                  {renderActionButton()}

                  <p className="mt-3 text-sm text-white/70">
                    Если планы изменились, отмените запись заранее.
                  </p>

                  {message ? (
                    <p className="mt-3 text-sm text-white/70">{message}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        ) : tournament.status === "completed" ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
            <div className="grid grid-cols-[48px_1fr_80px_80px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>Место</div>
              <div>Игрок</div>
              <div className="text-right">KO</div>
              <div className="text-right">Очки</div>
            </div>

            {results.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Результаты пока не заполнены</div>
            ) : (
              results.map((result) => (
                <div
                  key={`${result.player_id}-${result.place}`}
                  className="grid grid-cols-[48px_1fr_80px_80px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{result.place}</div>

                  <div>
                    <Link
                      href={`/players/${result.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {result.username ? `@${result.username}` : result.display_name}
                    </Link>
                    {!result.username ? (
                      <p className="mt-1 text-xs text-white/50">{result.display_name}</p>
                    ) : null}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {result.knockouts}
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {result.rating_points}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white/80">
                Записаны ({registeredParticipants.length})
              </p>
            </div>

            <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
              <div>#</div>
              <div>Ник</div>
              <div className="text-right">Рейтинг</div>
            </div>

            {registeredParticipants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Пока записанных участников нет</div>
            ) : (
              registeredParticipants.map((participant, index) => (
                <div
                  key={participant.registration_id}
                  className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                  <div>
                    <Link
                      href={`/players/${participant.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {participant.display_name}
                    </Link>
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {participant.rating}
                  </div>
                </div>
              ))
            )}
          </div>

          {waitlistParticipants.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="text-sm font-semibold text-white/80">
                  Список ожидания ({waitlistParticipants.length})
                </p>
              </div>

              <div className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/50">
                <div>#</div>
                <div>Ник</div>
                <div className="text-right">Рейтинг</div>
              </div>

              {waitlistParticipants.map((participant, index) => (
                <div
                  key={participant.registration_id}
                  className="grid grid-cols-[48px_1fr_90px] gap-3 border-b border-white/10 px-4 py-4 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-white/80">{index + 1}</div>

                  <div>
                    <Link
                      href={`/players/${participant.player_id}`}
                      className="text-sm font-medium text-white"
                    >
                      {participant.display_name}
                    </Link>
                  </div>

                  <div className="text-right text-sm font-semibold text-white/80">
                    {participant.rating}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        )}
      </div>
    </main>
  );
}

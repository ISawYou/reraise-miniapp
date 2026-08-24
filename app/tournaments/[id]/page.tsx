"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveCurrentPlayer } from "@/lib/current-player";
import {
  getVisibleTournamentByIdForPlayer,
  getTournamentParticipants,
  getTournamentResults,
  getPlayerRegistrationForTournament,
  registerPlayerForTournament,
  cancelPlayerRegistration,
} from "@/features/tournaments";
import { getPlayerAvatarFallback, getPlayerAvatarUrl } from "@/lib/player-avatar";
import { logEvent } from "@/lib/activity-client";
import { CLUB_ADDRESS, CLUB_MAP_URL } from "@/config/club";
import {
  getExpectedPrizePlaces,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
} from "@/lib/tournament-helpers";
import { getTelegramUser } from "@/lib/telegram";
import type {
  Player,
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


function StarIcon() {
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
      <path d="m12 4 2.45 4.96 5.47.8-3.96 3.86.94 5.45L12 16.5l-4.9 2.57.94-5.45L4.08 9.76l5.47-.8Z" />
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

function ParticipantRow({
  participant,
  index,
}: {
  participant: TournamentParticipant;
  index: number;
}) {
  const avatarUrl = getPlayerAvatarUrl(participant);
  const avatarFallback = getPlayerAvatarFallback(participant);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex w-6 shrink-0 justify-center text-sm font-semibold text-white/45">
          {index + 1}
        </div>

        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={participant.display_name}
            className="h-10 w-10 rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80">
            {avatarFallback}
          </div>
        )}

        <div className="min-w-0">
          <Link
            href={`/players/${participant.player_id}`}
            className="block truncate text-sm font-medium text-white"
          >
            {participant.display_name}
          </Link>
        </div>
      </div>

      <div className="shrink-0 pr-2 text-right text-sm font-semibold text-white/80">
        {participant.rating}
      </div>
    </div>
  );
}

function renderDescription(text: string) {
  const blocks = text.split(/\n{2,}/).filter((s) => s.trim());

  return blocks.map((block, i) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const isListBlock = lines.length > 1 && lines.every((l) => l.startsWith("- ") || l.startsWith("• "));

    if (isListBlock) {
      return (
        <ul key={i} className="space-y-1.5 pl-0">
          {lines.map((line, j) => (
            <li key={j} className="flex items-start gap-2.5 text-sm text-white/70">
              <span className="mt-[7px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-white/30" />
              <span>{line.replace(/^[-•]\s*/, "")}</span>
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={i} className="text-sm leading-relaxed text-white/70">
        {block.replace(/\n/g, " ")}
      </p>
    );
  });
}

export default function TournamentDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tournamentId = params?.id;

  const [player, setPlayer] = useState<Player | null>(null);
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
  const expectedPrizePlaces = getExpectedPrizePlaces(participants.length);
  const tournamentTypeBonusLines = tournament
    ? getTournamentTypeBonusLines(tournament.tournament_type)
    : [];
  const registeredParticipants = participants.filter(
  (participant) =>
    participant.status === "registered" || participant.status === "attended"
);

const waitlistParticipants = participants.filter(
  (participant) => participant.status === "waitlist"
);
  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/tournaments");
  }

  async function refreshPageData(currentPlayer: Player, currentTournamentId: string) {
    const [tournamentData, participantsData, myRegistration] = await Promise.all([
      getVisibleTournamentByIdForPlayer(currentTournamentId, currentPlayer),
      getTournamentParticipants(currentTournamentId),
      getPlayerRegistrationForTournament(currentPlayer.id, currentTournamentId),
    ]);

    setTournament(tournamentData);
    setParticipants(participantsData);
    setRegistrationStatus(myRegistration?.status ?? null);
    setRegisteredCount(participantsData.filter((p) => p.status === "registered").length);

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

        const currentPlayer: Player = await resolveCurrentPlayer();

        setPlayer(currentPlayer);

        await refreshPageData(currentPlayer, tournamentId);
        logEvent("tournament_opened", { metadata: { tournament_id: tournamentId } });
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
    if (!player?.id || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      const result = await registerPlayerForTournament(player.id, tournamentId);

      if (result.status === "registered") {
        setMessage("Вы записаны на турнир");
        logEvent("registration_created", { metadata: { tournament_id: tournamentId } });
      } else if (result.status === "waitlist") {
        setMessage("Вы добавлены в список ожидания");
        logEvent("waitlist_joined", { metadata: { tournament_id: tournamentId } });
      }

      await refreshPageData(player, tournamentId);
    } catch (err) {
      setMessage("Ошибка записи");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!player?.id || !tournamentId) return;

    try {
      setActionLoading(true);
      setMessage(null);

      await cancelPlayerRegistration(player.id, tournamentId);
      logEvent("registration_cancelled", { metadata: { tournament_id: tournamentId } });

      if (registrationStatus === "registered") {
        setMessage("Запись на турнир отменена");
      } else if (registrationStatus === "waitlist") {
        setMessage("Вы вышли из списка ожидания");
      }

      await refreshPageData(player, tournamentId);
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
          className="w-full rounded-xl bg-yellow-500 py-3 font-semibold text-black disabled:opacity-60"
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
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/14 py-3 font-semibold text-emerald-100 disabled:opacity-60"
        >
          {actionLoading ? (
            "Сохраняем..."
          ) : (
            <>
              <CheckIcon />
              <span>Вы записаны</span>
            </>
          )}
        </button>
      );
    }

    if (registrationStatus === "waitlist") {
      return (
        <button
          type="button"
          onClick={handleCancel}
          disabled={actionLoading}
          className="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-60"
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
          <button
            type="button"
            onClick={handleBack}
            className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
          >
            ← Назад
          </button>

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Турнир не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-44 text-white">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={handleBack}
          className="telegram-top-action mb-4 inline-block rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80"
        >
          ← Назад
        </button>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-700/40 to-black p-4">
          <p className="text-xs uppercase tracking-wider text-white/45">Турнир</p>
          <h1 className="mt-1.5 text-2xl font-bold uppercase tracking-wide">
            {tournament.title}
          </h1>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/65">
              <CalendarIcon />
              <span>{formatTournamentDate(tournament.start_at)}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/65">
              <UserIcon />
              <span>{tournament.status === "completed" ? results.length : registeredCount} / {tournament.max_players}</span>
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
          <div className="mt-4 space-y-3">
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <CalendarIcon />
                  <span>Начало</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-white">
                  {tournamentDateParts?.date}
                </p>
                <p className="mt-1 text-xs text-white/55">
                  {tournamentDateParts?.time}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <PinIcon />
                  <span>Место</span>
                </div>
                {tournament.location === CLUB_ADDRESS ? (
                  <a
                    href={CLUB_MAP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block text-sm font-semibold text-white underline decoration-white/25 underline-offset-4"
                  >
                    {tournament.location}
                  </a>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-white">
                    {tournament.location || "Не указано"}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <UserIcon />
                  <span>Призовые места</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-white">
                  {expectedPrizePlaces}
                </p>
                {expectedPrizePlaces > 0 ? (
                  <p className="mt-1 text-xs text-white/55">
                    Рейтинговая зона: места 1-{expectedPrizePlaces}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <StarIcon />
                  <span>Тип турнира</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-white">
                  {getTournamentTypeLabel(tournament.tournament_type)}
                </p>
                {tournamentTypeBonusLines.length > 0 ? (
                  <p className="mt-1 text-xs text-white/55">
                    {tournamentTypeBonusLines.join(" · ")}
                  </p>
                ) : null}
              </div>
            </section>

            {tournament.description ? (
              <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                {renderDescription(tournament.description)}
              </section>
            ) : null}

            {tournament.status !== "completed" ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h2 className="text-sm font-semibold text-white">Регистрация</h2>
                <div className="mt-3">
                  <p className="text-sm text-white/72">
                    {!registrationStatus
                      ? registeredCount >= tournament.max_players
                        ? "Свободные места закончились, но можно встать в список ожидания."
                        : "Кнопка регистрации закреплена внизу экрана и всегда доступна."
                      : registrationStatus === "registered"
                        ? "Вы уже записаны на турнир. Управление записью доступно внизу экрана."
                        : "Вы в списке ожидания. Управление записью доступно внизу экрана."}
                  </p>

                  <p className="mt-3 text-xs text-white/55">
                    Если планы изменились, отмените запись заранее.
                  </p>

                  {message ? (
                    <p className="mt-2 text-xs text-white/60">{message}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        ) : tournament.status === "completed" ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-3 py-2.5 text-xs font-medium text-emerald-200/75 sm:px-4">
              Призовая зона: ТОП-{expectedPrizePlaces}
            </div>
            <div className="grid grid-cols-[40px_minmax(0,1fr)_44px_58px] gap-2 border-b border-white/10 px-3 py-3 text-xs uppercase tracking-wide text-white/50 sm:grid-cols-[48px_minmax(0,1fr)_80px_80px] sm:gap-3 sm:px-4">
              <div className="text-center">Место</div>
              <div>Игрок</div>
              <div className="text-right">KO</div>
              <div className="text-right">Очки</div>
            </div>

            {results.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Результаты пока не заполнены</div>
            ) : (
              results.map((result) => {
                const isPodium = result.place <= 3;
                const isItm = result.place <= expectedPrizePlaces;
                const rowTone = result.place === 1 ? "border-[#d7b55a]/30 bg-[#b88a2e]/[0.13]"
                  : result.place === 2 ? "border-slate-200/25 bg-slate-300/[0.10]"
                  : result.place === 3 ? "border-orange-300/25 bg-[#a65f32]/[0.11]"
                  : isItm ? "border-emerald-300/20 bg-emerald-400/[0.08]"
                  : "border-white/10";
                const badgeTone = result.place === 1 ? "border-[#d7b55a]/45 bg-[#d7b55a]/15 text-[#f1d486]"
                  : result.place === 2 ? "border-slate-200/35 bg-slate-200/10 text-slate-100"
                  : result.place === 3 ? "border-orange-300/35 bg-orange-400/10 text-orange-200"
                  : isItm ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                  : "border-white/10 bg-white/[0.04] text-white/70";
                return <div
                  key={`${result.player_id}-${result.place}`}
                  className={`grid grid-cols-[40px_minmax(0,1fr)_44px_58px] items-center gap-2 border-b px-3 py-4 last:border-b-0 sm:grid-cols-[48px_minmax(0,1fr)_80px_80px] sm:gap-3 sm:px-4 ${rowTone} ${result.place === expectedPrizePlaces ? "border-b-2 border-b-emerald-300/30" : ""}`}
                >
                  <div className={`flex h-7 min-w-7 items-center justify-center justify-self-center rounded-lg border px-1 text-xs font-bold tabular-nums ${badgeTone}`}>
                    {result.place}
                  </div>

                  <div className="min-w-0">
                    <Link
                      href={`/players/${result.player_id}`}
                      className="block truncate text-sm font-medium text-white"
                    >
                      {result.display_name}
                    </Link>
                    {isItm && !isPodium ? <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-200/70">ITM</span> : null}
                  </div>

                  <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-white/80">
                    {result.knockouts}
                  </div>

                  <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-white/80">
                    {result.rating_points}
                  </div>
                </div>
              })
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/[0.05]">
            {registeredParticipants.length > 0 ? (
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/45">
                <div className="flex items-center gap-1 pl-9">
                  <UserIcon />
                  <span>Игроки</span>
                </div>
                <div className="flex items-center gap-1 pr-2">
                  <StarIcon />
                  <span>Рейтинг</span>
                </div>
              </div>
            ) : null}

            {registeredParticipants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Пока записанных участников нет</div>
            ) : (
              registeredParticipants.map((participant, index) => (
                <ParticipantRow
                  key={participant.registration_id}
                  participant={participant}
                  index={index}
                />
              ))
            )}
          </div>

          {waitlistParticipants.length > 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.05]">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="text-sm font-semibold text-white/80">
                  Список ожидания ({waitlistParticipants.length})
                </p>
              </div>

              {waitlistParticipants.map((participant, index) => (
                <ParticipantRow
                  key={participant.registration_id}
                  participant={participant}
                  index={index}
                />
              ))}
            </div>
          ) : null}
        </div>
        )}
      </div>

      {tournament.status !== "completed" ? (
        <div className="pointer-events-none fixed inset-x-0 z-20 bottom-[calc(env(safe-area-inset-bottom)+92px)] px-4">
          <div className="mx-auto max-w-md">
            <div className="pointer-events-auto rounded-[22px] border border-white/10 bg-[#0d0f0f]/78 p-3 backdrop-blur-xl">
              {renderActionButton()}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}


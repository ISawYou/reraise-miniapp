"use client";

import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { TournamentCard } from "@/components/tournaments/tournament-card";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import {
  getExpectedPrizePlaces,
  getTournamentTypeBonusLines,
  getTournamentTypeLabel,
  sortParticipantsByRating,
  splitTournamentLiveRoster,
} from "@/lib/tournament-helpers";
import { getTelegramUser } from "@/lib/telegram";
import { FINAL_MONTH_LABEL } from "@/config/tournament-presets";
import {
  FINAL_REGISTRATION_EXPLANATION,
  FINAL_REGISTRATION_TAB_LABEL,
} from "@/lib/tournament-final-policy";
import { useTournamentLiveState } from "@/lib/hooks/use-tournament-live-state";
import { useTournamentActivePlayers } from "@/lib/hooks/use-tournament-active-players";
import { isTournamentLive } from "@/components/tournaments/tournament-live-status";
import type {
  Player,
  RegistrationStatus,
  Tournament,
  TournamentParticipant,
  TournamentResult,
} from "@/types/domain";
import type { PublicActiveTournamentPlayer } from "@/types/poker-clock-live-state";

type TabKey = "about" | "live" | "registration" | "results";

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

function ActivePlayerRow({
  player,
  index,
}: {
  player: PublicActiveTournamentPlayer;
  index: number;
}) {
  const trimmedName = player.displayName.trim();
  const avatarFallback = trimmedName ? trimmedName[0].toUpperCase() : "?";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex w-6 shrink-0 justify-center text-sm font-semibold text-white/45">
          {index + 1}
        </div>

        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt={player.displayName}
            className="h-10 w-10 rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80">
            {avatarFallback}
          </div>
        )}

        <div className="min-w-0">
          <Link
            href={`/players/${player.playerId}`}
            className="block truncate text-sm font-medium text-white"
          >
            {player.displayName}
          </Link>
        </div>
      </div>

      <div className="shrink-0 pr-2 text-right text-sm font-semibold text-white/80">
        {player.rating ?? "—"}
      </div>
    </div>
  );
}

// "Выбыли" row -- same layout/classes as ActivePlayerRow above (avatar
// fallback, truncated name, right-aligned trailing value), just visually
// secondary (muted text/opacity) and showing the canonical derived place
// instead of rating. `player.place` is read as-is -- never recalculated
// here, see PublicActiveTournamentPlayer's doc comment. A temporarily null
// place renders "—", never "null"/"undefined" text.
function EliminatedPlayerRow({
  player,
  index,
}: {
  player: PublicActiveTournamentPlayer;
  index: number;
}) {
  const trimmedName = player.displayName.trim();
  const avatarFallback = trimmedName ? trimmedName[0].toUpperCase() : "?";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 last:border-b-0 opacity-70">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex w-6 shrink-0 justify-center text-sm font-semibold text-white/35">
          {index + 1}
        </div>

        {player.avatarUrl ? (
          <img
            src={player.avatarUrl}
            alt={player.displayName}
            className="h-10 w-10 rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/60">
            {avatarFallback}
          </div>
        )}

        <div className="min-w-0">
          <Link
            href={`/players/${player.playerId}`}
            className="block truncate text-sm font-medium text-white/80"
          >
            {player.displayName}
          </Link>
        </div>
      </div>

      <div className="shrink-0 pr-2 text-right text-sm font-semibold tabular-nums text-white/60">
        {player.place != null ? `${player.place} место` : "—"}
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
  const [tournamentVisuals, setTournamentVisuals] = useState<Record<string, TournamentVisualConfig>>({});

  const [activeTab, setActiveTab] = useState<TabKey>("about");
  // Display-only convenience sort for the Registration tab -- never
  // persisted, never sent to the server, never touches registration order in
  // the DB. Off by default so the existing order is exactly what it was
  // before this control existed.
  const [sortRegistrationByRating, setSortRegistrationByRating] = useState(false);
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

  // Never offered for a completed tournament (see the toggle button below),
  // so this only ever reorders an open/closed/live registration list, never
  // the frozen Results view.
  const displayedRegisteredParticipants =
    sortRegistrationByRating && tournament?.status !== "completed"
      ? sortParticipantsByRating(registeredParticipants)
      : registeredParticipants;

  // Single source of clock truth, shared with Home -- no second poll/logic
  // for "is this tournament live" here.
  const liveStateIds = useMemo(
    () => (tournamentId ? [tournamentId] : []),
    [tournamentId]
  );
  const liveState = useTournamentLiveState(liveStateIds);
  const liveSummary = tournamentId ? liveState[tournamentId] : undefined;
  const clock = liveSummary?.clock ?? null;
  // Never shown once the tournament is completed, even if a stale clock
  // status is still "running"/"paused" this poll.
  const isLive = tournament?.status !== "completed" && isTournamentLive(clock);
  const attendance = liveSummary?.attendance ?? null;

  const middleTabKey: TabKey = tournament?.status === "completed" ? "results" : "live";
  const middleTabLabel =
    tournament?.status === "completed"
      ? `Результаты (${results.length})`
      : isLive && attendance
        ? `В игре (${attendance.active})`
        : "В игре";

  // Live roster: every arrived player, active and eliminated alike -- same
  // one poll, split below into the two "В игре" / "Выбыли" sections.
  const livePlayers = useTournamentActivePlayers(
    tournamentId ?? null,
    isLive && activeTab === "live"
  );

  const { active: activeRoster, eliminated: eliminatedRoster } = useMemo(
    () => splitTournamentLiveRoster(livePlayers),
    [livePlayers]
  );

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/tournaments");
  }

  async function refreshPageData(currentPlayer: Player, currentTournamentId: string) {
    const [tournamentData, participantsData, myRegistration, visualsData] = await Promise.all([
      getVisibleTournamentByIdForPlayer(currentTournamentId, currentPlayer),
      getTournamentParticipants(currentTournamentId),
      getPlayerRegistrationForTournament(currentPlayer.id, currentTournamentId),
      fetch("/api/tournament-visuals").then((response) =>
        response.ok ? response.json() : { visuals: [] }
      ),
    ]);

    setTournament(tournamentData);
    setParticipants(participantsData);
    setRegistrationStatus(myRegistration?.status ?? null);
    setRegisteredCount(participantsData.filter((p) => p.status === "registered").length);
    setTournamentVisuals(
      Object.fromEntries(
        (visualsData.visuals ?? []).map((config: TournamentVisualConfig) => [config.tournamentType, config])
      )
    );

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

  // Dispatches to the same handleRegister/handleCancel the page already had
  // -- the shared TournamentCard owns presentation only (label/tone/is_final
  // non-interactivity), never which server action to call. It never invokes
  // this at all for a final tournament, regardless of what's passed here --
  // see TournamentCard's onAction doc comment.
  function handleCardAction() {
    if (registrationStatus) {
      handleCancel();
    } else {
      handleRegister();
    }
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
          <BackButton onClick={handleBack} className="mb-4" />

          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error ?? "Турнир не найден"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <BackButton onClick={handleBack} className="mb-4" />

        <TournamentCard
          tournament={tournament}
          registeredCount={tournament.status === "completed" ? results.length : registeredCount}
          liveSummary={liveSummary}
          configs={tournamentVisuals}
          registrationStatus={registrationStatus}
          onAction={handleCardAction}
          actionLoading={actionLoading}
        />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("about")}
            className={`rounded-full border px-2 py-2.5 text-center text-xs font-medium ${
              activeTab === "about"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            Описание
          </button>

          <button
            type="button"
            onClick={() => setActiveTab(middleTabKey)}
            className={`rounded-full border px-2 py-2.5 text-center text-xs font-medium ${
              activeTab === middleTabKey
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            {middleTabLabel}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("registration")}
            className={`rounded-full border px-2 py-2.5 text-center text-xs font-medium ${
              activeTab === "registration"
                ? "border-white/20 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/70"
            }`}
          >
            {tournament?.is_final
              ? `${FINAL_REGISTRATION_TAB_LABEL} (${registeredParticipants.length})`
              : `Регистрация (${registeredParticipants.length})`}
          </button>
        </div>

        {activeTab === "about" ? (
          <div className="mt-4 space-y-3">
            <section className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <CalendarIcon />
                  <span>Начало</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {tournamentDateParts?.date}
                </p>
                <p className="mt-0.5 text-[11px] text-white/55">
                  {tournamentDateParts?.time}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <PinIcon />
                  <span>Место</span>
                </div>
                {tournament.location === CLUB_ADDRESS ? (
                  <a
                    href={CLUB_MAP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 block text-sm font-semibold text-white underline decoration-white/25 underline-offset-4"
                  >
                    {tournament.location}
                  </a>
                ) : (
                  <p className="mt-1.5 text-sm font-semibold text-white">
                    {tournament.location || "Не указано"}
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <UserIcon />
                  <span>Призовые места</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {expectedPrizePlaces}
                </p>
                {/* Championship, not a rating tournament -- never show
                    "Рейтинговая зона" for is_final (see
                    lib/tournament-helpers.ts::isRatingEligibleTournament). */}
                {expectedPrizePlaces > 0 && !tournament.is_final ? (
                  <p className="mt-0.5 text-[11px] text-white/55">
                    Рейтинговая зона: места 1-{expectedPrizePlaces}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <StarIcon />
                  <span>Тип турнира</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {tournament.is_final ? FINAL_MONTH_LABEL : getTournamentTypeLabel(tournament.tournament_type)}
                </p>
                {tournamentTypeBonusLines.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-white/55">
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
          </div>
        ) : activeTab === "results" ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-3 py-2.5 text-xs font-medium text-emerald-200/75 sm:px-4">
              {tournament.is_final ? "Результаты" : `Призовая зона: ТОП-${expectedPrizePlaces}`}
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
        ) : activeTab === "live" ? (
          !isLive ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.05] px-4 py-6 text-sm text-white/60">
              Список игроков появится после старта турнира
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.05]">
                {activeRoster.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-white/60">
                    Пока никто не в игре
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/45">
                      <div className="flex items-center gap-1 pl-9">
                        <UserIcon />
                        <span>В игре</span>
                      </div>
                      <div className="flex items-center gap-1 pr-2">
                        <StarIcon />
                        <span>Рейтинг</span>
                      </div>
                    </div>
                    {activeRoster.map((activePlayer, index) => (
                      <ActivePlayerRow
                        key={activePlayer.playerId}
                        player={activePlayer}
                        index={index}
                      />
                    ))}
                  </>
                )}
              </div>

              {/* Visually secondary (dimmer background/label), never a
                  large empty block when nobody has busted out yet -- the
                  whole section is simply omitted. */}
              {eliminatedRoster.length > 0 ? (
                <div className="rounded-3xl border border-white/10 bg-white/[0.03]">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/35">
                    <div className="flex items-center gap-1 pl-9">
                      <UserIcon />
                      <span>Выбыли</span>
                    </div>
                    <span className="pr-2">Место</span>
                  </div>
                  {eliminatedRoster.map((eliminatedPlayer, index) => (
                    <EliminatedPlayerRow
                      key={eliminatedPlayer.playerId}
                      player={eliminatedPlayer}
                      index={index}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="mt-6 space-y-4">
          {tournament.status !== "completed" ? (
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-sm text-white/72">
                {tournament.is_final
                  ? FINAL_REGISTRATION_EXPLANATION
                  : !registrationStatus
                    ? registeredCount >= tournament.max_players
                      ? "Свободные места закончились, но можно встать в список ожидания."
                      : "Кнопка регистрации закреплена внизу экрана и всегда доступна."
                    : registrationStatus === "registered"
                      ? "Вы уже записаны на турнир. Управление записью доступно внизу экрана."
                      : "Вы в списке ожидания. Управление записью доступно внизу экрана."}
              </p>
              {message ? (
                <p className="mt-2 text-xs text-white/60">{message}</p>
              ) : null}
            </section>
          ) : null}

          <div className="rounded-3xl border border-white/10 bg-white/[0.05]">
            {registeredParticipants.length > 0 ? (
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/45">
                <div className="flex items-center gap-1 pl-9">
                  <UserIcon />
                  <span>Игроки</span>
                </div>
                <div className="flex items-center gap-2">
                  {tournament.status !== "completed" ? (
                    <button
                      type="button"
                      onClick={() => setSortRegistrationByRating((current) => !current)}
                      aria-pressed={sortRegistrationByRating}
                      className={`rounded-full border px-2.5 py-1 text-[11px] normal-case tracking-normal transition ${
                        sortRegistrationByRating
                          ? "border-[#d5b867] text-[#d5b867]"
                          : "border-white/15 text-white/55"
                      }`}
                    >
                      По рейтингу
                    </button>
                  ) : null}
                  <div className="flex items-center gap-1 pr-2">
                    <StarIcon />
                    <span>Рейтинг</span>
                  </div>
                </div>
              </div>
            ) : null}

            {registeredParticipants.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">Пока записанных участников нет</div>
            ) : (
              displayedRegisteredParticipants.map((participant, index) => (
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
    </main>
  );
}


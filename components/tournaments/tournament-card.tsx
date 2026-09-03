import type { Tournament, RegistrationStatus } from "@/types/domain";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import type { TournamentLiveSummary } from "@/types/poker-clock-live-state";
import { TournamentVisual } from "@/components/tournaments/tournament-visual";
import {
  isTournamentLive,
  TournamentLiveStatusLines,
} from "@/components/tournaments/tournament-live-status";
import { getExpectedPrizePlaces } from "@/lib/tournament-helpers";
import { getFinalRegistrationLabel } from "@/lib/tournament-final-policy";

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

function formatTournamentShortDate(date: string) {
  const value = new Date(date);
  return value.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatTournamentShortTime(date: string) {
  const value = new Date(date);
  return value.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTournamentCountdown(date: string) {
  const diffMs = new Date(date).getTime() - Date.now();

  if (diffMs <= 0) {
    return "Уже начался";
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days <= 0) {
    return `${hours} ч`;
  }

  return `${days} д ${hours} ч`;
}

export type TournamentCardProps = {
  tournament: Tournament;
  registeredCount: number;
  liveSummary?: TournamentLiveSummary | null;
  configs: Record<string, TournamentVisualConfig>;
  registrationStatus: RegistrationStatus | null;
  // Absent (Home): the action area renders as a static status pill -- the
  // whole card is already a navigation Link one level up, so nothing here
  // needs to be independently clickable. Present (detail page): the action
  // area becomes a real <button> calling this on click. A final tournament
  // is NEVER interactive either way, regardless of onAction -- server-side
  // enforcement in registerPlayerForTournament/cancelPlayerRegistration
  // (features/tournaments.ts) rejects self-service either way, so the UI
  // must not pretend an action exists. Never infers is_final from
  // title/description -- only tournament.is_final.
  onAction?: () => void;
  actionLoading?: boolean;
  className?: string;
};

// The ONE tournament-card presentation, shared by Home's carousel and the
// tournament detail page's header -- Detail no longer maintains a separate
// hero. Home wraps this in its own <Link> (carousel-slide sizing, tap
// feedback, navigation) entirely outside this component; the detail page
// renders it directly as the page header with a real onAction callback.
// Artwork geometry always comes from `configs` as-is (the admin
// Home/default config) -- this component has no variant/detail-specific
// artwork sizing of its own, by product decision.
export function TournamentCard({
  tournament,
  registeredCount,
  liveSummary,
  configs,
  registrationStatus,
  onAction,
  actionLoading = false,
  className = "",
}: TournamentCardProps) {
  const prizePlaces = getExpectedPrizePlaces(registeredCount);
  const countdownText = formatTournamentCountdown(tournament.start_at);
  const isPlayerInFinal = registrationStatus === "registered" || registrationStatus === "waitlist";

  const clock = liveSummary?.clock ?? null;
  const isLive = tournament.status !== "completed" && isTournamentLive(clock);
  const attendance = liveSummary?.attendance ?? null;
  // The player-count chip always shows registered / max, LIVE or not -- a
  // tournament with 12 registrations must never suddenly look like it only
  // has 4-7 players just because the clock started. The in-game count gets
  // its own separate "В игре" line below instead.
  const playerChipLabel = `${registeredCount} / ${tournament.max_players}`;

  // A completed tournament has nothing to register/cancel -- no action
  // area at all, matching the detail page's prior behavior.
  const showAction = tournament.status !== "completed";

  const actionLabel = tournament.is_final
    ? getFinalRegistrationLabel(isPlayerInFinal)
    : actionLoading
      ? "Сохраняем..."
      : registrationStatus === "registered"
        ? "Вы записаны"
        : registrationStatus === "waitlist"
          ? "Вы в листе ожидания"
          : "Записаться";

  const isInteractive = Boolean(onAction) && !tournament.is_final;

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ${
        tournament.is_final
          ? "border-red-500/25 bg-[radial-gradient(circle_at_top_left,rgba(153,27,27,0.22),transparent_32%),linear-gradient(145deg,#1c0a0c_0%,#0f0708_55%,#050405_100%)]"
          : "border-[#7f9b8c]/20 bg-[radial-gradient(circle_at_top_left,rgba(120,148,130,0.18),transparent_32%),linear-gradient(145deg,#122018_0%,#0b1210_58%,#050605_100%)]"
      } ${className}`}
    >
      <TournamentVisual
        tournamentType={tournament.tournament_type}
        configs={configs}
        className="z-0"
      />

      <div className="relative z-10">
        <h3 className="text-2xl font-black uppercase leading-tight tracking-[0.04em] text-white">
          {tournament.title}
        </h3>

        <div className="mt-4 flex flex-wrap gap-2 text-sm text-white/75">
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
            {formatTournamentShortDate(tournament.start_at)}
          </div>
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
            {formatTournamentShortTime(tournament.start_at)}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium">
            <UserIcon />
            <span>{playerChipLabel}</span>
          </div>
        </div>

        {isLive ? (
          <TournamentLiveStatusLines
            clock={clock}
            attendance={attendance}
            lateRegistration={liveSummary?.lateRegistration ?? null}
          />
        ) : showAction ? (
          <>
            <p className="mt-3 text-sm font-semibold text-white/70">
              {tournament.is_final
                ? countdownText === "Уже начался"
                  ? "Турнир уже начался"
                  : `Старт через ${countdownText}`
                : countdownText === "Уже начался"
                  ? `🏆 ТОП-${prizePlaces} • турнир уже начался`
                  : `🏆 ТОП-${prizePlaces} • старт через ${countdownText}`}
            </p>

            <div className="mt-4">
              {isInteractive ? (
                <button
                  type="button"
                  onClick={onAction}
                  disabled={actionLoading}
                  className="inline-flex min-w-[154px] items-center justify-center rounded-xl bg-[#d7b55a] px-4 py-2.5 text-center text-sm font-semibold text-black disabled:opacity-60"
                >
                  {actionLabel}
                </button>
              ) : (
                <div
                  className={`inline-flex min-w-[154px] items-center justify-center rounded-xl px-4 py-2.5 text-center text-sm font-semibold ${
                    tournament.is_final
                      ? isPlayerInFinal
                        ? "border border-emerald-400/20 bg-emerald-500/14 text-emerald-100"
                        : "border border-white/10 bg-white/[0.06] text-white/65"
                      : "bg-[#d7b55a] text-black"
                  }`}
                >
                  {actionLabel}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

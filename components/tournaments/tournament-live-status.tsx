import type { TournamentLiveSummary } from "@/types/poker-clock-live-state";

// Shared by the Home tournament card and the tournament detail hero so the
// two never drift apart on wording/order. Fact of LIVE comes only from
// Poker Clock's actual clock status -- never from tournament.start_at or
// Re-Raise's own "open" status. Paused still counts as LIVE (the
// tournament hasn't stopped, only the clock has).
export function isTournamentLive(
  clock: TournamentLiveSummary["clock"] | null | undefined
): boolean {
  return clock?.status === "running" || clock?.status === "paused";
}

// No seconds, per the compact LIVE second line ("38 мин" / "1 ч 12 мин").
// Clamped to a 1-minute floor so a near-zero-but-still-positive remaining
// value never reads as "0 мин".
function formatLateRegistrationMinutes(remainingSeconds: number) {
  const totalMinutes = Math.max(1, Math.round(remainingSeconds / 60));

  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

// Re-Raise's own late-registration status is authoritative; Poker Clock's
// countdown is only a reference used to phrase the "open" case. `null`
// means "not applicable" (non-free tournament) or "unknown this poll" --
// the line is omitted entirely rather than guessed.
export function resolveLateRegistrationLine(
  lateRegistration: TournamentLiveSummary["lateRegistration"],
  clockRemainingSeconds: number | null | undefined
): string | null {
  if (!lateRegistration) return null;

  if (lateRegistration.status === "closed") {
    return "Поздняя рег. закрыта";
  }

  if (typeof clockRemainingSeconds === "number" && clockRemainingSeconds > 0) {
    return `Поздняя рег. ${formatLateRegistrationMinutes(clockRemainingSeconds)}`;
  }

  return "Поздняя рег. открыта";
}

// Renders the LIVE status line + "В игре N" + late-registration line, in
// that fixed order. Deliberately does NOT render a "Пришли" count anywhere
// -- registered vs. in-game are the only two player-facing counts (see
// TournamentAttendanceSummary's doc comment). "В игре" is omitted (not
// shown as a fake 0) whenever attendance data isn't available this poll.
export function TournamentLiveStatusLines({
  clock,
  attendance,
  lateRegistration,
}: {
  clock: TournamentLiveSummary["clock"] | null | undefined;
  attendance: TournamentLiveSummary["attendance"] | null | undefined;
  lateRegistration: TournamentLiveSummary["lateRegistration"] | null | undefined;
}) {
  const lateRegistrationLine = resolveLateRegistrationLine(
    lateRegistration ?? null,
    clock?.lateRegistrationRemainingSeconds
  );

  return (
    <>
      <p className="mt-3 text-sm font-semibold text-white/70">
        {clock?.isBreak === true
          ? "🔴 LIVE · Перерыв"
          : clock?.isBreak === false &&
            clock?.currentLevel !== null &&
            clock?.smallBlind !== null &&
            clock?.bigBlind !== null
            ? `🔴 LIVE · Ур. ${clock.currentLevel} · ${clock.smallBlind} / ${clock.bigBlind}`
            : "🔴 LIVE"}
      </p>
      {attendance ? (
        <p className="mt-1 text-sm text-white/55">В игре {attendance.active}</p>
      ) : null}
      {lateRegistrationLine ? (
        <p className="mt-1 text-sm text-white/55">{lateRegistrationLine}</p>
      ) : null}
    </>
  );
}

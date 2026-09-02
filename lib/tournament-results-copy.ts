// Pure, client-safe text formatting for the Admin Results screen's
// "Скопировать результаты" button (app/admin/results/[id]/page.tsx) --
// plain factual TEXT, not HTML, and no generated marketing prose: an admin
// pastes this into ChatGPT (or anywhere else) to draft the actual public
// post themselves. Operates only on the already-fetched Tournament/
// TournamentResult shapes (the exact same canonical data the player-facing
// Results tab already reads via features/tournaments.ts::getTournamentResults
// -- see app/tournaments/[id]/page.tsx), so it never imports repositories/
// server code, never recalculates place or rating_points, and is trivially
// unit-testable.
import {
  supportsMysteryBounty,
  supportsTournamentBossKnockouts,
  supportsTournamentKnockouts,
} from "@/lib/tournament-helpers";
import type { TournamentResult, TournamentType } from "@/types/domain";

const CLUB_TIME_ZONE = "Europe/Moscow";

const copyDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: CLUB_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatCopyDate(startAt: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return "—";
  return copyDateFormatter.format(date);
}

// Russian очко/очка/очков agreement -- the task's own examples rely on it
// (52 -> очка, 43 -> очка, 37 -> очков), so this is required output shape,
// not decoration.
function pluralizePoints(value: number): string {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 14) return "очков";
  if (mod10 === 1) return "очко";
  if (mod10 >= 2 && mod10 <= 4) return "очка";
  return "очков";
}

// Never trust `place` blindly even though TournamentResult types it as a
// plain `number` -- historical/malformed rows are exactly the case this
// guards against (see this module's callers' doc comments on "handle
// safely"). A place that isn't a positive integer is never invented; the
// row is still included (ALL FINISHERS), just without a fabricated number.
function isValidPlace(place: number): boolean {
  return Number.isInteger(place) && place > 0;
}

function formatResultLine(result: TournamentResult, tournamentType: TournamentType): string {
  const parts = [`${result.display_name} — ${result.rating_points} ${pluralizePoints(result.rating_points)}`];

  if (supportsTournamentKnockouts(tournamentType) && result.knockouts > 0) {
    parts.push(`KO: ${result.knockouts}`);
  }

  if (supportsTournamentBossKnockouts(tournamentType) && (result.boss_knockouts ?? 0) > 0) {
    parts.push(`Boss KO: ${result.boss_knockouts}`);
  }

  // Frozen "current value" (see lib/db/schema/results.ts's mysteryBountyPoints
  // doc comment) -- a genuine persisted fact, not a placeholder like the old
  // pre-feature addons/free_reentries defaults, so it's safe to surface here
  // the same way KO/Boss KO are.
  if (supportsMysteryBounty(tournamentType) && (result.mystery_bounty_points ?? 0) > 0) {
    parts.push(`Mystery Bounty: ${result.mystery_bounty_points}`);
  }

  return parts.join(" — ");
}

export function formatTournamentResultsForCopy(
  tournament: { title: string; start_at: string; tournament_type: TournamentType },
  results: TournamentResult[]
): string {
  const validResults = results.filter((r) => isValidPlace(r.place)).sort((a, b) => a.place - b.place);
  const unplacedResults = results.filter((r) => !isValidPlace(r.place));

  const lines: string[] = [
    `Турнир: ${tournament.title}`,
    `Дата: ${formatCopyDate(tournament.start_at)}`,
    `Игроков: ${results.length}`,
    "",
    ...validResults.map(
      (result) => `${result.place}. ${formatResultLine(result, tournament.tournament_type)}`
    ),
    // Never a fabricated place number -- appended after every valid row,
    // still included so no real finisher silently disappears from the copy.
    ...unplacedResults.map((result) => `— ${formatResultLine(result, tournament.tournament_type)}`),
  ];

  return lines.join("\n");
}

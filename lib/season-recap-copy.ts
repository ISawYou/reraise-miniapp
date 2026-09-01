// Pure, client-safe text formatting for the "Скопировать данные для поста"
// button (app/admin/seasons/[id]/recap/page.tsx) -- plain factual TEXT, not
// HTML, and no generated marketing prose: a human pastes this into their
// own tool of choice to write the actual public post. Operates only on the
// already-fetched SeasonRecap JSON shape, so it never imports repositories/
// server code and is trivially unit-testable.
import type {
  SeasonRecap,
  SeasonRecapRecord,
  SeasonRecapSingleEventRecord,
  SeasonRecapTournamentRecord,
} from "@/features/season-recap";

function formatRecord(record: SeasonRecapRecord): string {
  if (!record.meaningful) return "—";
  const names = record.leaders.map((leader) => leader.displayName).join(", ");
  return `${names} — ${record.value}`;
}

function formatSingleEvent(record: SeasonRecapSingleEventRecord): string {
  if (!record.meaningful) return "—";
  const parts = record.leaders
    .map((leader) => `${leader.displayName} (${leader.tournamentTitle})`)
    .join(", ");
  return `${parts} — ${record.value}`;
}

function formatTournamentRecord(record: SeasonRecapTournamentRecord): string {
  if (!record.meaningful) return "—";
  const titles = record.tournaments.map((t) => t.tournamentTitle).join(", ");
  return `${titles} — ${record.value}`;
}

export function buildSeasonRecapCopyText(recap: SeasonRecap): string {
  const { season, summary, official, records, tournamentRecords } = recap;

  const lines: string[] = [
    `Сезон: ${season.title}`,
    `Турниров: ${summary.completedTournaments}`,
    `Уникальных игроков: ${summary.uniquePlayers}`,
    `Участий: ${summary.totalParticipations}`,
    `Re-entry: ${summary.totalReentries}`,
    `Начислено рейтинговых очков: ${summary.totalRatingPointsAwarded}`,
    `KO: ${summary.totalKnockouts}`,
    `Boss KO: ${summary.totalBossKnockouts}`,
    `Среднее поле: ${summary.averageFieldSize.toFixed(1)}`,
    `Самое большое поле: ${
      summary.largestField
        ? `${summary.largestField.tournamentTitle} — ${summary.largestField.playerCount}`
        : "—"
    }`,
    "",
    "ТОП-9:",
    ...(official.finalists.length > 0
      ? official.finalists.map((f) => `${f.officialRank}. ${f.displayName} — ${f.rating}`)
      : ["—"]),
    ...(official.pointsGapFirstToSecond !== null
      ? [`Отрыв 1 от 2: ${official.pointsGapFirstToSecond}`]
      : []),
    "",
    "РЕКОРДЫ:",
    `Больше турниров: ${formatRecord(records.mostTournaments)}`,
    `Больше побед: ${formatRecord(records.mostWins)}`,
    `Больше подиумов: ${formatRecord(records.mostPodiums)}`,
    `Больше TOP-9: ${formatRecord(records.mostTopNine)}`,
    `Больше KO: ${formatRecord(records.mostKnockouts)}`,
    `Boss KO: ${formatRecord(records.mostBossKnockouts)}`,
    `Mystery Bounty: ${formatRecord(records.mostMysteryBounty)}`,
    `Лучший результат за турнир: ${formatSingleEvent(records.bestSingleTournamentRating)}`,
    `Больше всего KO за турнир: ${formatSingleEvent(records.mostKnockoutsSingleTournament)}`,
    `Серия участий подряд: ${formatRecord(records.longestParticipationStreak)}`,
    "",
    "ТУРНИРЫ-РЕКОРДСМЕНЫ:",
    `Самое большое поле: ${formatTournamentRecord(tournamentRecords.largestField)}`,
    `Самый большой пул очков: ${formatTournamentRecord(tournamentRecords.highestRatingPool)}`,
    `Больше всего KO: ${formatTournamentRecord(tournamentRecords.highestKnockouts)}`,
  ];

  return lines.join("\n");
}

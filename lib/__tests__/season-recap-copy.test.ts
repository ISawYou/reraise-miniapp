import { describe, expect, it } from "vitest";
import { buildSeasonRecapCopyText } from "@/lib/season-recap-copy";
import type { SeasonRecap } from "@/features/season-recap";

function baseRecap(overrides: Partial<SeasonRecap> = {}): SeasonRecap {
  return {
    season: { id: "s1", title: "Открытие" },
    summary: {
      completedTournaments: 10,
      uniquePlayers: 25,
      totalParticipations: 120,
      totalReentries: 15,
      totalRatingPointsAwarded: 5400,
      totalKnockouts: 300,
      totalBossKnockouts: 12,
      averageFieldSize: 12.0,
      largestField: { tournamentId: "t1", tournamentTitle: "Big One", startAt: "2026-03-01T18:00:00.000Z", playerCount: 20 },
      tournamentTypeBreakdown: {
        classic: 5,
        phoenix: 1,
        deep_stack: 1,
        bounty: 1,
        boss_bounty: 1,
        win_the_button: 1,
        mystery_bounty: 0,
      },
    },
    official: {
      winner: { playerId: "p1", displayName: "Winner", rating: 900, officialRank: 1 },
      finalists: [{ playerId: "p1", displayName: "Winner", rating: 900, officialRank: 1 }],
      pointsGapFirstToSecond: 100,
      officialPlayersCount: 9,
      outOfCompetitionPlayersCount: 0,
    },
    records: {
      mostTournaments: { value: 10, leaders: [{ playerId: "p1", displayName: "Winner" }], meaningful: true },
      mostWins: { value: 0, leaders: [], meaningful: false },
      mostPodiums: { value: 0, leaders: [], meaningful: false },
      mostTopNine: { value: 0, leaders: [], meaningful: false },
      mostKnockouts: { value: 0, leaders: [], meaningful: false },
      mostBossKnockouts: { value: 0, leaders: [], meaningful: false },
      mostMysteryBounty: { value: 0, leaders: [], meaningful: false },
      bestSingleTournamentRating: { value: 0, leaders: [], meaningful: false },
      mostKnockoutsSingleTournament: { value: 0, leaders: [], meaningful: false },
      longestParticipationStreak: { value: 0, leaders: [], meaningful: false },
    },
    tournamentRecords: {
      largestField: { value: 20, tournaments: [{ tournamentId: "t1", tournamentTitle: "Big One", startAt: "2026-03-01T18:00:00.000Z" }], meaningful: true },
      highestRatingPool: { value: 0, tournaments: [], meaningful: false },
      highestKnockouts: { value: 0, tournaments: [], meaningful: false },
      distinctFormatsPlayed: 6,
    },
    ...overrides,
  };
}

describe("buildSeasonRecapCopyText", () => {
  it("produces plain text (no HTML) containing the key summary figures", () => {
    const text = buildSeasonRecapCopyText(baseRecap());
    expect(text).not.toMatch(/<[a-z]+>/i);
    expect(text).toContain("Сезон: Открытие");
    expect(text).toContain("Турниров: 10");
    expect(text).toContain("Начислено рейтинговых очков: 5400");
  });

  it("a tied record joins all leader names with a comma, still just one value", () => {
    const recap = baseRecap({
      records: {
        ...baseRecap().records,
        mostWins: { value: 3, leaders: [{ playerId: "a", displayName: "Anna" }, { playerId: "b", displayName: "Boris" }], meaningful: true },
      },
    });
    const text = buildSeasonRecapCopyText(recap);
    expect(text).toContain("Больше побед: Anna, Boris — 3");
  });

  it("a non-meaningful (zero) record renders as a dash, never a fake winner", () => {
    const text = buildSeasonRecapCopyText(baseRecap());
    expect(text).toContain("Boss KO: —");
  });
});

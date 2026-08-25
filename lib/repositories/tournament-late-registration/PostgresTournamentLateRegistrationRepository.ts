import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournamentLateRegistration } from "@/lib/db/schema";
import type {
  TournamentLateRegistrationInsert,
  TournamentLateRegistrationRepository,
  TournamentLateRegistrationRow,
} from "./TournamentLateRegistrationRepository";

function mapRow(
  row: typeof tournamentLateRegistration.$inferSelect
): TournamentLateRegistrationRow {
  return {
    tournament_id: row.tournamentId,
    arrived_players_count: row.arrivedPlayersCount,
    initial_stacks_count: row.initialStacksCount,
    total_entries_count: row.totalEntriesCount,
    rebuys_count: row.rebuysCount,
    addons_count: row.addonsCount,
    tournament_type: row.tournamentType as TournamentLateRegistrationRow["tournament_type"],
    rating_formula_version:
      row.ratingFormulaVersion as TournamentLateRegistrationRow["rating_formula_version"],
    rating_guarantee: row.ratingGuarantee,
    rating_places: row.ratingPlaces,
    closed_at: row.closedAt.toISOString(),
  };
}

export class PostgresTournamentLateRegistrationRepository
  implements TournamentLateRegistrationRepository
{
  async findByTournamentId(
    tournamentId: string
  ): Promise<TournamentLateRegistrationRow | null> {
    const [row] = await db
      .select()
      .from(tournamentLateRegistration)
      .where(eq(tournamentLateRegistration.tournamentId, tournamentId))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async insertIfAbsent(
    data: TournamentLateRegistrationInsert
  ): Promise<TournamentLateRegistrationRow> {
    const [inserted] = await db
      .insert(tournamentLateRegistration)
      .values({
        tournamentId: data.tournament_id,
        arrivedPlayersCount: data.arrived_players_count,
        initialStacksCount: data.initial_stacks_count,
        totalEntriesCount: data.total_entries_count,
        rebuysCount: data.rebuys_count,
        addonsCount: data.addons_count,
        tournamentType: data.tournament_type,
        ratingFormulaVersion: data.rating_formula_version,
        ratingGuarantee: data.rating_guarantee,
        ratingPlaces: data.rating_places,
      })
      .onConflictDoNothing({ target: tournamentLateRegistration.tournamentId })
      .returning();

    if (inserted) return mapRow(inserted);

    const existing = await this.findByTournamentId(data.tournament_id);
    if (!existing) {
      throw new Error("Failed to close Late Registration: snapshot was not returned");
    }
    return existing;
  }
}

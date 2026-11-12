import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournaments, tournamentLateRegistration } from "@/lib/db/schema";
import type { Tournament, TournamentStatus, TournamentType } from "@/types/domain";
import type { TournamentRepository, TournamentInsert, TournamentPatch } from "./TournamentRepository";

function mapRowToTournament(row: typeof tournaments.$inferSelect): Tournament {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    google_sheet_tab_name: row.googleSheetTabName ?? null,
    start_at: row.startAt.toISOString(),
    max_players: row.maxPlayers,
    starting_stack: row.startingStack,
    late_registration_ends_at: row.lateRegistrationEndsAt?.toISOString() ?? null,
    // Hardcoded, not row.kind -- matches SupabaseTournamentRepository's own
    // mapTournamentRow exactly: every tournament created through the app is
    // "free" today, the stored kind column isn't trusted as the source of
    // truth for this field.
    kind: "free",
    tournament_type: (row.tournamentType ?? "classic") as TournamentType,
    season_id: row.seasonId,
    status: row.status as TournamentStatus,
    created_at: row.createdAt.toISOString(),
    rating_formula_version: row.ratingFormulaVersion as Tournament["rating_formula_version"],
    rating_guarantee: row.ratingGuarantee,
    placement_points_multiplier: row.placementPointsMultiplier,
    is_final: row.isFinal,
  };
}

// TournamentInsert/TournamentPatch are both Partial<TournamentRow>
// (snake_case) -- only present keys are mapped, so create()'s omitted
// columns keep their table defaults and patch()/update()'s partial-update
// semantics match the Supabase implementation's plain `.insert(data)` /
// `.update(patch)` passthrough.
export function tournamentColumnValues(data: TournamentInsert | TournamentPatch): Partial<typeof tournaments.$inferInsert> {
  const values: Partial<typeof tournaments.$inferInsert> = {};
  if (data.id !== undefined) values.id = data.id;
  if (data.title !== undefined) values.title = data.title;
  if (data.description !== undefined) values.description = data.description;
  if (data.location !== undefined) values.location = data.location;
  if (data.google_sheet_tab_name !== undefined) values.googleSheetTabName = data.google_sheet_tab_name;
  if (data.start_at !== undefined) values.startAt = new Date(data.start_at);
  if (data.max_players !== undefined) values.maxPlayers = data.max_players;
  if (data.starting_stack !== undefined) values.startingStack = data.starting_stack;
  if (data.late_registration_ends_at !== undefined) values.lateRegistrationEndsAt = data.late_registration_ends_at ? new Date(data.late_registration_ends_at) : null;
  if (data.kind !== undefined) values.kind = data.kind;
  if (data.tournament_type !== undefined) values.tournamentType = data.tournament_type;
  if (data.season_id !== undefined) values.seasonId = data.season_id;
  if (data.status !== undefined) values.status = data.status;
  if (data.created_at !== undefined) values.createdAt = new Date(data.created_at);
  if (data.rating_formula_version !== undefined) values.ratingFormulaVersion = data.rating_formula_version;
  if (data.rating_guarantee !== undefined) values.ratingGuarantee = data.rating_guarantee;
  if (data.placement_points_multiplier !== undefined) {
    values.placementPointsMultiplier = data.placement_points_multiplier;
  }
  if (data.is_final !== undefined) values.isFinal = data.is_final;
  return values;
}

// Drizzle/Postgres counterpart of SupabaseTournamentRepository -- same
// contract, no new behavior. Same compensations as every other domain:
// `.limit(1)` + array-destructure standing in for `.single()` (throwing
// when the row is missing, since every read method here mirrors a
// `.single()` call, not `.maybeSingle()`), and timestamp columns converted
// to ISO strings.
export class PostgresTournamentRepository implements TournamentRepository {
  async findById(tournamentId: string): Promise<Tournament> {
    const rows = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
    const [row] = rows;
    if (!row) {
      throw new Error("Tournament not found");
    }
    return mapRowToTournament(row);
  }

  async findSeasonIdById(tournamentId: string): Promise<{ id: string; season_id: string | null }> {
    const rows = await db
      .select({ id: tournaments.id, season_id: tournaments.seasonId })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    const [row] = rows;
    if (!row) {
      throw new Error("Tournament not found");
    }
    return row;
  }

  async listOpen(): Promise<Tournament[]> {
    const rows = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.status, "open"))
      .orderBy(asc(tournaments.startAt));
    return rows.map(mapRowToTournament);
  }

  async listCompleted(): Promise<Tournament[]> {
    const rows = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.status, "completed"))
      .orderBy(desc(tournaments.startAt));
    return rows.map(mapRowToTournament);
  }

  async listCompletedInRange(from?: Date, to?: Date): Promise<Tournament[]> {
    const conditions = [eq(tournaments.status, "completed")];
    if (from) conditions.push(gte(tournaments.startAt, from));
    if (to) conditions.push(lte(tournaments.startAt, to));

    const rows = await db
      .select()
      .from(tournaments)
      .where(and(...conditions))
      .orderBy(desc(tournaments.startAt));
    return rows.map(mapRowToTournament);
  }

  async listExcludingStatus(status: TournamentStatus): Promise<Tournament[]> {
    const rows = await db
      .select()
      .from(tournaments)
      .where(ne(tournaments.status, status))
      .orderBy(asc(tournaments.startAt));
    return rows.map(mapRowToTournament);
  }

  async listByStatuses(statuses: TournamentStatus[]): Promise<Tournament[]> {
    const rows = await db
      .select()
      .from(tournaments)
      .where(inArray(tournaments.status, statuses))
      .orderBy(desc(tournaments.startAt));
    return rows.map(mapRowToTournament);
  }

  async create(data: TournamentInsert): Promise<Tournament> {
    const rows = await db
      .insert(tournaments)
      .values(tournamentColumnValues(data) as typeof tournaments.$inferInsert)
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create tournament: no rows returned");
    }
    return mapRowToTournament(row);
  }

  async update(tournamentId: string, patch: TournamentPatch): Promise<Tournament> {
    return db.transaction(async tx => {
      const [current] = await tx.select().from(tournaments).where(eq(tournaments.id,tournamentId)).for("update");
      if (!current) throw new Error("Tournament not found");
      if (current.tournamentType === "phoenix" || patch.tournament_type === "phoenix") {
        const changed = (patch.placement_points_multiplier != null && patch.placement_points_multiplier !== current.placementPointsMultiplier)
          || (patch.rating_guarantee !== undefined && patch.rating_guarantee !== current.ratingGuarantee)
          || (patch.tournament_type !== undefined && patch.tournament_type !== current.tournamentType)
          || (patch.rating_formula_version !== undefined && patch.rating_formula_version !== current.ratingFormulaVersion);
        if (changed) {
          const [frozen] = await tx.select({id:tournamentLateRegistration.tournamentId}).from(tournamentLateRegistration).where(eq(tournamentLateRegistration.tournamentId,tournamentId)).limit(1);
          if (frozen || current.status === "completed") throw new Error("Рейтинг PHOENIX зафиксирован. Изменение коэффициента требует отдельной исторической коррекции.");
        }
      }
      const [row] = await tx.update(tournaments).set(tournamentColumnValues(patch)).where(eq(tournaments.id,tournamentId)).returning();
      if (!row) throw new Error("Failed to update tournament: no rows returned");
      return mapRowToTournament(row);
    });
  }

  async patch(tournamentId: string, patch: TournamentPatch): Promise<void> {
    await db.update(tournaments).set(tournamentColumnValues(patch)).where(eq(tournaments.id, tournamentId));
  }

  async delete(tournamentId: string): Promise<void> {
    await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
  }
}

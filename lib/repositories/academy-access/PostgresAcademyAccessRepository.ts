import "server-only";

import { and, eq, exists, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { results, tournamentAttendance, tournaments } from "@/lib/db/schema";
import type { AcademyAccessRepository } from "./AcademyAccessRepository";

/**
 * One round-trip, two short-circuiting EXISTS probes (no rows are loaded
 * into JS, no per-tournament queries). Served by results_season_id_idx /
 * the results primary key and tournaments_season_id_idx / the attendance
 * primary key — no new index is needed at club volume.
 */
export class PostgresAcademyAccessRepository implements AcademyAccessRepository {
  async hasPlayerParticipatedInSeason(playerId: string, seasonId: string): Promise<boolean> {
    const completedResult = db
      .select({ one: sql`1` })
      .from(results)
      .where(and(
        eq(results.playerId, playerId),
        eq(results.seasonId, seasonId),
        sql`${results.arrived} IS DISTINCT FROM false`,
      ));

    const liveArrival = db
      .select({ one: sql`1` })
      .from(tournamentAttendance)
      .innerJoin(tournaments, eq(tournaments.id, tournamentAttendance.tournamentId))
      .where(and(
        eq(tournamentAttendance.playerId, playerId),
        eq(tournamentAttendance.arrived, true),
        eq(tournaments.seasonId, seasonId),
      ));

    const rows = await db.execute<{ participated: boolean }>(
      sql`SELECT ${or(exists(completedResult), exists(liveArrival))} AS participated`,
    );
    return rows[0]?.participated === true;
  }
}

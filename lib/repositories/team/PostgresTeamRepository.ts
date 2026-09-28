import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import type { TeamRepository, TeamRow, TeamStatus } from "./TeamRepository";

function mapRow(row: typeof teams.$inferSelect): TeamRow {
  return {
    id: row.id,
    name: row.name,
    emblem: row.emblem,
    captain_player_id: row.captainPlayerId,
    status: row.status as TeamStatus,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    disbanded_at: row.disbandedAt ? row.disbandedAt.toISOString() : null,
  };
}

// Postgres-only -- no Supabase counterpart, same recent-domain convention
// as dealer/club-activity/season-rating-exclusion/player-merge-intent (see
// CLAUDE.md: Supabase is legacy/compatibility debt, not a live target for
// new product features).
export class PostgresTeamRepository implements TeamRepository {
  async findById(teamId: string): Promise<TeamRow | null> {
    const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findByIdOrThrow(teamId: string): Promise<TeamRow> {
    const row = await this.findById(teamId);
    if (!row) {
      throw new Error("Команда не найдена");
    }
    return row;
  }

  async findByNameCaseInsensitive(name: string): Promise<TeamRow | null> {
    const rows = await db
      .select()
      .from(teams)
      .where(sql`lower(${teams.name}) = lower(${name})`)
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async listAll(): Promise<TeamRow[]> {
    const rows = await db.select().from(teams);
    return rows.map(mapRow);
  }
}

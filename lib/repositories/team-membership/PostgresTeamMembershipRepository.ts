import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamMemberships } from "@/lib/db/schema";
import type { TeamMembershipRepository, TeamMembershipRow } from "./TeamMembershipRepository";

function mapRow(row: typeof teamMemberships.$inferSelect): TeamMembershipRow {
  return {
    id: row.id,
    team_id: row.teamId,
    player_id: row.playerId,
    joined_at: row.joinedAt.toISOString(),
    left_at: row.leftAt ? row.leftAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

export class PostgresTeamMembershipRepository implements TeamMembershipRepository {
  async findActiveByPlayerId(playerId: string): Promise<TeamMembershipRow | null> {
    const rows = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, playerId), isNull(teamMemberships.leftAt)))
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findActiveByTeamId(teamId: string): Promise<TeamMembershipRow[]> {
    const rows = await db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt)));
    return rows.map(mapRow);
  }

  async countActiveByTeamId(teamId: string): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt)));
    return rows[0]?.value ?? 0;
  }

  async listAll(): Promise<TeamMembershipRow[]> {
    const rows = await db.select().from(teamMemberships);
    return rows.map(mapRow);
  }
}

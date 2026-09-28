import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamJoinRequests } from "@/lib/db/schema";
import type {
  TeamJoinRequestRepository,
  TeamJoinRequestRow,
  TeamJoinRequestStatus,
} from "./TeamJoinRequestRepository";

function mapRow(row: typeof teamJoinRequests.$inferSelect): TeamJoinRequestRow {
  return {
    id: row.id,
    team_id: row.teamId,
    player_id: row.playerId,
    status: row.status as TeamJoinRequestStatus,
    created_at: row.createdAt.toISOString(),
    responded_at: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

export class PostgresTeamJoinRequestRepository implements TeamJoinRequestRepository {
  async findById(id: string): Promise<TeamJoinRequestRow | null> {
    const rows = await db.select().from(teamJoinRequests).where(eq(teamJoinRequests.id, id)).limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findPendingByPlayerId(playerId: string): Promise<TeamJoinRequestRow[]> {
    const rows = await db
      .select()
      .from(teamJoinRequests)
      .where(and(eq(teamJoinRequests.playerId, playerId), eq(teamJoinRequests.status, "pending")));
    return rows.map(mapRow);
  }

  async findPendingByTeamAndPlayer(teamId: string, playerId: string): Promise<TeamJoinRequestRow | null> {
    const rows = await db
      .select()
      .from(teamJoinRequests)
      .where(
        and(
          eq(teamJoinRequests.teamId, teamId),
          eq(teamJoinRequests.playerId, playerId),
          eq(teamJoinRequests.status, "pending")
        )
      )
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findPendingByTeamId(teamId: string): Promise<TeamJoinRequestRow[]> {
    const rows = await db
      .select()
      .from(teamJoinRequests)
      .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.status, "pending")));
    return rows.map(mapRow);
  }
}

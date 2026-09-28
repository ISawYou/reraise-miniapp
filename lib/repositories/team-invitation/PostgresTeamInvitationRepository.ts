import "server-only";

import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamInvitations } from "@/lib/db/schema";
import type {
  TeamInvitationRepository,
  TeamInvitationRow,
  TeamInvitationStatus,
} from "./TeamInvitationRepository";

function mapRow(row: typeof teamInvitations.$inferSelect): TeamInvitationRow {
  return {
    id: row.id,
    team_id: row.teamId,
    invited_player_id: row.invitedPlayerId,
    invited_by_player_id: row.invitedByPlayerId,
    status: row.status as TeamInvitationStatus,
    created_at: row.createdAt.toISOString(),
    responded_at: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

export class PostgresTeamInvitationRepository implements TeamInvitationRepository {
  async findById(id: string): Promise<TeamInvitationRow | null> {
    const rows = await db.select().from(teamInvitations).where(eq(teamInvitations.id, id)).limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findPendingByPlayerId(playerId: string): Promise<TeamInvitationRow[]> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.invitedPlayerId, playerId), eq(teamInvitations.status, "pending")));
    return rows.map(mapRow);
  }

  async findPendingByTeamAndPlayer(teamId: string, playerId: string): Promise<TeamInvitationRow | null> {
    const rows = await db
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.teamId, teamId),
          eq(teamInvitations.invitedPlayerId, playerId),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async listByTeamId(teamId: string): Promise<TeamInvitationRow[]> {
    const rows = await db.select().from(teamInvitations).where(eq(teamInvitations.teamId, teamId));
    return rows.map(mapRow);
  }

  async countPendingByTeamId(teamId: string): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(teamInvitations)
      .where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.status, "pending")));
    return rows[0]?.value ?? 0;
  }
}

import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminShifts } from "@/lib/db/schema";
import { extractPostgresError } from "@/lib/db/postgres-error";
import {
  AdminShiftAlreadyOnShiftError,
  type AdminShiftRepository,
  type AdminShiftRow,
  type AdminShiftInsert,
  type AdminShiftClosePatch,
  type AdminShiftSuperAdminClosePatch,
  type AdminShiftCompletedInsert,
  type AdminShiftCorrectionPatch,
} from "./AdminShiftRepository";

function mapShiftRow(row: typeof adminShifts.$inferSelect): AdminShiftRow {
  return {
    id: row.id,
    admin_player_id: row.adminPlayerId,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt ? row.endedAt.toISOString() : null,
    amount_rub: row.amountRub,
    tournament_id: row.tournamentId,
    created_by_player_id: row.createdByPlayerId,
    ended_by_player_id: row.endedByPlayerId,
    updated_by_player_id: row.updatedByPlayerId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// Drizzle/Postgres implementation. Postgres-only -- same scoping decision
// as Dealer Payroll V1 (see PostgresDealerRepository.ts): Admin Shifts has
// no Supabase counterpart.
export class PostgresAdminShiftRepository implements AdminShiftRepository {
  async findOpenShiftByAdminId(adminPlayerId: string): Promise<AdminShiftRow | null> {
    const rows = await db
      .select()
      .from(adminShifts)
      .where(and(eq(adminShifts.adminPlayerId, adminPlayerId), isNull(adminShifts.endedAt)))
      .limit(1);
    const [row] = rows;
    return row ? mapShiftRow(row) : null;
  }

  async findShiftById(shiftId: string): Promise<AdminShiftRow | null> {
    const rows = await db.select().from(adminShifts).where(eq(adminShifts.id, shiftId)).limit(1);
    const [row] = rows;
    return row ? mapShiftRow(row) : null;
  }

  async createShift(data: AdminShiftInsert): Promise<AdminShiftRow> {
    try {
      const rows = await db
        .insert(adminShifts)
        .values({
          adminPlayerId: data.admin_player_id,
          startedAt: new Date(data.started_at),
          amountRub: data.amount_rub,
          tournamentId: data.tournament_id,
          createdByPlayerId: data.created_by_player_id,
        })
        .returning();
      const [row] = rows;
      if (!row) {
        throw new Error("Failed to create admin shift: no rows returned");
      }
      return mapShiftRow(row);
    } catch (error) {
      if (extractPostgresError(error)?.code === "23505") {
        throw new AdminShiftAlreadyOnShiftError(data.admin_player_id);
      }
      throw error;
    }
  }

  async closeShift(shiftId: string, patch: AdminShiftClosePatch): Promise<AdminShiftRow> {
    const rows = await db
      .update(adminShifts)
      .set({
        endedAt: new Date(patch.ended_at),
        endedByPlayerId: patch.ended_by_player_id,
      })
      .where(eq(adminShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to close admin shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async closeShiftAsSuperAdmin(
    shiftId: string,
    patch: AdminShiftSuperAdminClosePatch
  ): Promise<AdminShiftRow> {
    const rows = await db
      .update(adminShifts)
      .set({
        endedAt: new Date(patch.ended_at),
        endedByPlayerId: patch.ended_by_player_id,
        tournamentId: patch.tournament_id,
        amountRub: patch.amount_rub,
        updatedByPlayerId: patch.updated_by_player_id,
      })
      .where(eq(adminShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to close admin shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async createCompletedShift(data: AdminShiftCompletedInsert): Promise<AdminShiftRow> {
    const rows = await db
      .insert(adminShifts)
      .values({
        adminPlayerId: data.admin_player_id,
        tournamentId: data.tournament_id,
        startedAt: new Date(data.started_at),
        endedAt: new Date(data.ended_at),
        amountRub: data.amount_rub,
        createdByPlayerId: data.created_by_player_id,
        endedByPlayerId: data.ended_by_player_id,
      })
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create historical admin shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async updateCompletedShift(shiftId: string, patch: AdminShiftCorrectionPatch): Promise<AdminShiftRow> {
    const rows = await db
      .update(adminShifts)
      .set({
        tournamentId: patch.tournament_id,
        startedAt: new Date(patch.started_at),
        endedAt: new Date(patch.ended_at),
        amountRub: patch.amount_rub,
        updatedByPlayerId: patch.updated_by_player_id,
      })
      .where(eq(adminShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update admin shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async setShiftAmount(
    shiftId: string,
    amountRub: number,
    updatedByPlayerId: string | null
  ): Promise<AdminShiftRow> {
    const rows = await db
      .update(adminShifts)
      .set({ amountRub, updatedByPlayerId })
      .where(eq(adminShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update admin shift amount: no rows returned");
    }
    return mapShiftRow(row);
  }

  async listShiftsByAdminId(adminPlayerId: string): Promise<AdminShiftRow[]> {
    const rows = await db
      .select()
      .from(adminShifts)
      .where(eq(adminShifts.adminPlayerId, adminPlayerId))
      .orderBy(desc(adminShifts.startedAt));
    return rows.map(mapShiftRow);
  }

  async listRecentShifts(limit: number): Promise<AdminShiftRow[]> {
    const rows = await db
      .select()
      .from(adminShifts)
      .orderBy(desc(adminShifts.startedAt))
      .limit(limit);
    return rows.map(mapShiftRow);
  }

  async listShiftsByTournamentId(tournamentId: string): Promise<AdminShiftRow[]> {
    const rows = await db
      .select()
      .from(adminShifts)
      .where(eq(adminShifts.tournamentId, tournamentId))
      .orderBy(desc(adminShifts.startedAt));
    return rows.map(mapShiftRow);
  }
}

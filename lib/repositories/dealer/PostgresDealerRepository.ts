import "server-only";

import { and, desc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { dealerProfiles, dealerShifts } from "@/lib/db/schema";
import { extractPostgresError } from "@/lib/db/postgres-error";
import {
  DealerAlreadyOnShiftError,
  type DealerRepository,
  type DealerProfileRow,
  type DealerShiftRow,
  type DealerShiftInsert,
  type DealerShiftClosePatch,
  type DealerShiftTimestampPatch,
} from "./DealerRepository";

function mapProfileRow(row: typeof dealerProfiles.$inferSelect): DealerProfileRow {
  return {
    player_id: row.playerId,
    is_active: row.isActive,
    hourly_rate_rub: row.hourlyRateRub,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapShiftRow(row: typeof dealerShifts.$inferSelect): DealerShiftRow {
  return {
    id: row.id,
    dealer_player_id: row.dealerPlayerId,
    started_at: row.startedAt.toISOString(),
    ended_at: row.endedAt ? row.endedAt.toISOString() : null,
    hourly_rate_rub: row.hourlyRateRub,
    worked_minutes: row.workedMinutes,
    paid_hours: row.paidHours,
    amount_rub: row.amountRub,
    taxi_allowance_rub: row.taxiAllowanceRub,
    tournament_id: row.tournamentId,
    created_by_player_id: row.createdByPlayerId,
    ended_by_player_id: row.endedByPlayerId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// Drizzle/Postgres implementation. Postgres-only for now -- Dealer Payroll
// V1 has no Supabase counterpart (see the task's own scoping decision):
// unlike every other domain in this repository layer, dealer_profiles/
// dealer_shifts never existed in Supabase, and creating them there is out
// of scope for this migration (which is entirely Drizzle/Postgres-driven).
// The separate Vercel/Supabase-backed Telegram Mini App deployment
// (docker-compose.yml's own doc comment) does not get Dealer Payroll until
// a SupabaseDealerRepository is deliberately added later.
export class PostgresDealerRepository implements DealerRepository {
  async findProfileByPlayerId(playerId: string): Promise<DealerProfileRow | null> {
    const rows = await db
      .select()
      .from(dealerProfiles)
      .where(eq(dealerProfiles.playerId, playerId))
      .limit(1);
    const [row] = rows;
    return row ? mapProfileRow(row) : null;
  }

  async listActiveProfiles(): Promise<DealerProfileRow[]> {
    const rows = await db
      .select()
      .from(dealerProfiles)
      .where(eq(dealerProfiles.isActive, true));
    return rows.map(mapProfileRow);
  }

  async createProfile(playerId: string, hourlyRateRub: number): Promise<DealerProfileRow> {
    const rows = await db
      .insert(dealerProfiles)
      .values({ playerId, isActive: true, hourlyRateRub })
      .onConflictDoUpdate({
        target: dealerProfiles.playerId,
        set: { isActive: true },
      })
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create dealer profile: no rows returned");
    }
    return mapProfileRow(row);
  }

  async setProfileActive(playerId: string, isActive: boolean): Promise<DealerProfileRow> {
    const rows = await db
      .update(dealerProfiles)
      .set({ isActive })
      .where(eq(dealerProfiles.playerId, playerId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update dealer profile: no rows returned");
    }
    return mapProfileRow(row);
  }

  async setProfileHourlyRate(playerId: string, hourlyRateRub: number): Promise<DealerProfileRow> {
    const rows = await db
      .update(dealerProfiles)
      .set({ hourlyRateRub })
      .where(eq(dealerProfiles.playerId, playerId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update dealer profile: no rows returned");
    }
    return mapProfileRow(row);
  }

  async findOpenShiftByDealerId(dealerPlayerId: string): Promise<DealerShiftRow | null> {
    const rows = await db
      .select()
      .from(dealerShifts)
      .where(and(eq(dealerShifts.dealerPlayerId, dealerPlayerId), isNull(dealerShifts.endedAt)))
      .limit(1);
    const [row] = rows;
    return row ? mapShiftRow(row) : null;
  }

  async findShiftById(shiftId: string): Promise<DealerShiftRow | null> {
    const rows = await db.select().from(dealerShifts).where(eq(dealerShifts.id, shiftId)).limit(1);
    const [row] = rows;
    return row ? mapShiftRow(row) : null;
  }

  async createShift(data: DealerShiftInsert): Promise<DealerShiftRow> {
    try {
      const rows = await db
        .insert(dealerShifts)
        .values({
          dealerPlayerId: data.dealer_player_id,
          startedAt: new Date(data.started_at),
          hourlyRateRub: data.hourly_rate_rub,
          tournamentId: data.tournament_id,
          createdByPlayerId: data.created_by_player_id,
        })
        .returning();
      const [row] = rows;
      if (!row) {
        throw new Error("Failed to create dealer shift: no rows returned");
      }
      return mapShiftRow(row);
    } catch (error) {
      if (extractPostgresError(error)?.code === "23505") {
        throw new DealerAlreadyOnShiftError(data.dealer_player_id);
      }
      throw error;
    }
  }

  async closeShift(shiftId: string, patch: DealerShiftClosePatch): Promise<DealerShiftRow> {
    const rows = await db
      .update(dealerShifts)
      .set({
        endedAt: new Date(patch.ended_at),
        workedMinutes: patch.worked_minutes,
        paidHours: patch.paid_hours,
        amountRub: patch.amount_rub,
        endedByPlayerId: patch.ended_by_player_id,
      })
      .where(eq(dealerShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to close dealer shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async updateShiftTimestamps(shiftId: string, patch: DealerShiftTimestampPatch): Promise<DealerShiftRow> {
    const rows = await db
      .update(dealerShifts)
      .set({
        startedAt: new Date(patch.started_at),
        endedAt: new Date(patch.ended_at),
        hourlyRateRub: patch.hourly_rate_rub,
        workedMinutes: patch.worked_minutes,
        paidHours: patch.paid_hours,
        amountRub: patch.amount_rub,
      })
      .where(eq(dealerShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update dealer shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async updateShiftTournament(shiftId: string, tournamentId: string | null): Promise<DealerShiftRow> {
    const rows = await db
      .update(dealerShifts)
      .set({ tournamentId })
      .where(eq(dealerShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update dealer shift tournament: no rows returned");
    }
    return mapShiftRow(row);
  }

  async reassignShiftDealer(shiftId: string, dealerPlayerId: string): Promise<DealerShiftRow> {
    const rows = await db
      .update(dealerShifts)
      .set({ dealerPlayerId })
      .where(eq(dealerShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to reassign dealer shift: no rows returned");
    }
    return mapShiftRow(row);
  }

  async setShiftTaxiAllowance(shiftId: string, taxiAllowanceRub: number): Promise<DealerShiftRow> {
    const rows = await db
      .update(dealerShifts)
      .set({ taxiAllowanceRub })
      .where(eq(dealerShifts.id, shiftId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update dealer shift taxi allowance: no rows returned");
    }
    return mapShiftRow(row);
  }

  async listShiftsByDealerId(dealerPlayerId: string): Promise<DealerShiftRow[]> {
    const rows = await db
      .select()
      .from(dealerShifts)
      .where(eq(dealerShifts.dealerPlayerId, dealerPlayerId))
      .orderBy(desc(dealerShifts.startedAt));
    return rows.map(mapShiftRow);
  }

  async listShiftsByTournamentId(tournamentId: string): Promise<DealerShiftRow[]> {
    const rows = await db
      .select()
      .from(dealerShifts)
      .where(eq(dealerShifts.tournamentId, tournamentId))
      .orderBy(desc(dealerShifts.startedAt));
    return rows.map(mapShiftRow);
  }

  async listAllShifts(): Promise<DealerShiftRow[]> {
    const rows = await db.select().from(dealerShifts).orderBy(desc(dealerShifts.startedAt));
    return rows.map(mapShiftRow);
  }

  async listShiftsStartedBetween(startInclusive: string, endExclusive: string): Promise<DealerShiftRow[]> {
    const rows = await db
      .select()
      .from(dealerShifts)
      .where(
        and(
          gte(dealerShifts.startedAt, new Date(startInclusive)),
          lt(dealerShifts.startedAt, new Date(endExclusive))
        )
      )
      .orderBy(desc(dealerShifts.startedAt));
    return rows.map(mapShiftRow);
  }

  async listRecentCompletedShifts(limit: number): Promise<DealerShiftRow[]> {
    const rows = await db
      .select()
      .from(dealerShifts)
      .where(isNotNull(dealerShifts.endedAt))
      .orderBy(desc(dealerShifts.startedAt))
      .limit(limit);
    return rows.map(mapShiftRow);
  }
}

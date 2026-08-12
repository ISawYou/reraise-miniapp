import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournamentMysteryBounty } from "@/lib/db/schema";
import type {
  TournamentMysteryBountyRepository,
  MysteryBountyRow,
  MysteryBountyInsert,
  MysteryBountyPatch,
} from "./TournamentMysteryBountyRepository";

function mapRow(row: typeof tournamentMysteryBounty.$inferSelect): MysteryBountyRow {
  return {
    tournament_id: row.tournamentId,
    status: row.status as MysteryBountyRow["status"],
    players_count: row.playersCount,
    total_entries_count: row.totalEntriesCount,
    rebuys_count: row.rebuysCount,
    addons_count: row.addonsCount,
    active_players_count: row.activePlayersCount,
    mystery_pool: row.mysteryPool,
    envelope_count: row.envelopeCount,
    small_count: row.smallCount,
    small_value: row.smallValue,
    medium_count: row.mediumCount,
    medium_value: row.mediumValue,
    jackpot_value: row.jackpotValue,
    closed_at: row.closedAt.toISOString(),
    activated_at: row.activatedAt ? row.activatedAt.toISOString() : null,
    recalculated_at: row.recalculatedAt ? row.recalculatedAt.toISOString() : null,
  };
}

// Drizzle/Postgres counterpart of SupabaseTournamentMysteryBountyRepository
// -- same contract, no new behavior.
export class PostgresTournamentMysteryBountyRepository
  implements TournamentMysteryBountyRepository
{
  async findByTournamentId(tournamentId: string): Promise<MysteryBountyRow | null> {
    const rows = await db
      .select()
      .from(tournamentMysteryBounty)
      .where(eq(tournamentMysteryBounty.tournamentId, tournamentId))
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async insert(data: MysteryBountyInsert): Promise<MysteryBountyRow> {
    const rows = await db
      .insert(tournamentMysteryBounty)
      .values({
        tournamentId: data.tournament_id,
        status: data.status,
        playersCount: data.players_count,
        totalEntriesCount: data.total_entries_count,
        rebuysCount: data.rebuys_count,
        addonsCount: data.addons_count,
        activePlayersCount: data.active_players_count,
        mysteryPool: data.mystery_pool,
        envelopeCount: data.envelope_count,
        smallCount: data.small_count,
        smallValue: data.small_value,
        mediumCount: data.medium_count,
        mediumValue: data.medium_value,
        jackpotValue: data.jackpot_value,
      })
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create Mystery Bounty snapshot: no rows returned");
    }
    return mapRow(row);
  }

  async update(tournamentId: string, patch: MysteryBountyPatch): Promise<MysteryBountyRow> {
    const values: Partial<typeof tournamentMysteryBounty.$inferInsert> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.players_count !== undefined) values.playersCount = patch.players_count;
    if (patch.total_entries_count !== undefined) values.totalEntriesCount = patch.total_entries_count;
    if (patch.rebuys_count !== undefined) values.rebuysCount = patch.rebuys_count;
    if (patch.addons_count !== undefined) values.addonsCount = patch.addons_count;
    if (patch.active_players_count !== undefined) values.activePlayersCount = patch.active_players_count;
    if (patch.mystery_pool !== undefined) values.mysteryPool = patch.mystery_pool;
    if (patch.envelope_count !== undefined) values.envelopeCount = patch.envelope_count;
    if (patch.small_count !== undefined) values.smallCount = patch.small_count;
    if (patch.small_value !== undefined) values.smallValue = patch.small_value;
    if (patch.medium_count !== undefined) values.mediumCount = patch.medium_count;
    if (patch.medium_value !== undefined) values.mediumValue = patch.medium_value;
    if (patch.jackpot_value !== undefined) values.jackpotValue = patch.jackpot_value;
    if (patch.activated_at !== undefined) {
      values.activatedAt = patch.activated_at ? new Date(patch.activated_at) : null;
    }
    if (patch.recalculated_at !== undefined) {
      values.recalculatedAt = patch.recalculated_at ? new Date(patch.recalculated_at) : null;
    }

    const rows = await db
      .update(tournamentMysteryBounty)
      .set(values)
      .where(eq(tournamentMysteryBounty.tournamentId, tournamentId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update Mystery Bounty snapshot: no rows returned");
    }
    return mapRow(row);
  }
}

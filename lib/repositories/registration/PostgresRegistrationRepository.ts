import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, registrations, tournaments } from "@/lib/db/schema";
import type { Registration, RegistrationStatus } from "@/types/domain";
import type { RegistrationRow } from "@/types/database";
import type {
  RegistrationRepository,
  RegistrationInsert,
  RegistrationWithTournamentRow,
  ExportParticipantRow,
  ParticipantWithRatingRow,
  ResultsDraftParticipantRow,
  AdminParticipantRow,
  LiveEligibleRow,
  NotificationRecipientRow,
} from "./RegistrationRepository";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Registration and RegistrationRow are structurally identical (both
// {id, player_id, tournament_id, status, created_at}) -- one mapper covers
// every read method's return shape.
function mapRow(row: typeof registrations.$inferSelect): RegistrationRow {
  return {
    id: row.id,
    player_id: row.playerId,
    tournament_id: row.tournamentId,
    status: row.status as RegistrationRow["status"],
    created_at: row.createdAt.toISOString(),
  };
}

// Drizzle/Postgres counterpart of SupabaseRegistrationRepository -- same
// contract, no new behavior. Compensations: `.limit(1)` + array-destructure
// standing in for `.maybeSingle()`/`.single()` (throwing only where the
// Supabase original used `.single()`), timestamp columns converted to ISO
// strings, and embedded Supabase joins (`players (...)`, `tournament:
// tournaments (...)`) replaced with Drizzle leftJoin + a nested-object
// select. Confirmed by reading drizzle-orm's own mapResultRow (utils.js):
// when a nested object's columns come from the *outer* side of a leftJoin
// and are all null, Drizzle already collapses that whole nested key to a
// bare `null` -- exactly flattenEmbedded's behavior -- so no extra
// null-coercion helper is needed here, unlike an earlier draft of this file
// that (incorrectly) assumed it would come back as an all-null-fields
// object. insertMany-style bulk writes are left as plain inserts/updates
// with no added onConflict logic the Supabase original didn't have.
export class PostgresRegistrationRepository implements RegistrationRepository {
  async findActiveByPlayerId(playerId: string): Promise<Registration[]> {
    const rows = await db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.playerId, playerId),
          inArray(registrations.status, ["registered", "waitlist", "attended"])
        )
      );
    return rows.map(mapRow);
  }

  async findActiveByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<Registration | null> {
    const rows = await db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.playerId, playerId),
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "waitlist", "attended"])
        )
      )
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async findRegisteredTournamentIds(): Promise<{ tournament_id: string }[]> {
    return db
      .select({ tournament_id: registrations.tournamentId })
      .from(registrations)
      .where(eq(registrations.status, "registered"));
  }

  async findLatestByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<RegistrationRow[]> {
    const rows = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.playerId, playerId), eq(registrations.tournamentId, tournamentId)))
      .orderBy(desc(registrations.createdAt))
      .limit(1);
    return rows.map(mapRow);
  }

  async findActiveOrWaitlistByPlayerAndTournamentOrThrow(
    playerId: string,
    tournamentId: string
  ): Promise<Registration> {
    const rows = await db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.playerId, playerId),
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "waitlist"])
        )
      )
      .orderBy(desc(registrations.createdAt))
      .limit(1);
    const [row] = rows;
    if (!row) {
      throw new Error("Registration not found");
    }
    return mapRow(row);
  }

  async findOldestWaitlisted(tournamentId: string): Promise<RegistrationRow[]> {
    const rows = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.status, "waitlist")))
      .orderBy(asc(registrations.createdAt))
      .limit(1);
    return rows.map(mapRow);
  }

  async findStatusAndTournamentById(
    registrationId: string
  ): Promise<{ status: string; tournament_id: string }> {
    const rows = await db
      .select({ status: registrations.status, tournament_id: registrations.tournamentId })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .limit(1);
    const [row] = rows;
    if (!row) {
      throw new Error("Registration not found");
    }
    return row;
  }

  async create(data: RegistrationInsert): Promise<Registration> {
    const rows = await db
      .insert(registrations)
      .values({ playerId: data.player_id, tournamentId: data.tournament_id, status: data.status })
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create registration: no rows returned");
    }
    return mapRow(row);
  }

  async createSilent(data: RegistrationInsert): Promise<void> {
    await db
      .insert(registrations)
      .values({ playerId: data.player_id, tournamentId: data.tournament_id, status: data.status });
  }

  async updateStatus(registrationId: string, status: RegistrationStatus): Promise<Registration> {
    const rows = await db
      .update(registrations)
      .set({ status })
      .where(eq(registrations.id, registrationId))
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to update registration: no rows returned");
    }
    return mapRow(row);
  }

  async updateStatusSilent(registrationId: string, status: RegistrationStatus): Promise<void> {
    await db.update(registrations).set({ status }).where(eq(registrations.id, registrationId));
  }

  async markAttendedBulk(
    tournamentId: string,
    playerIds: string[],
    fromStatuses: RegistrationStatus[]
  ): Promise<void> {
    await db
      .update(registrations)
      .set({ status: "attended" })
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.playerId, playerIds),
          inArray(registrations.status, fromStatuses)
        )
      );
  }

  async delete(registrationId: string): Promise<void> {
    await db.delete(registrations).where(eq(registrations.id, registrationId));
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    try {
      await db.delete(registrations).where(eq(registrations.playerId, playerId));
    } catch (err) {
      throw new Error(`Ошибка удаления registrations: ${errorMessage(err)}`);
    }
  }

  async findWithTournamentByPlayerId(playerId: string): Promise<RegistrationWithTournamentRow[]> {
    const rows = await db
      .select({
        id: registrations.id,
        player_id: registrations.playerId,
        tournament_id: registrations.tournamentId,
        status: registrations.status,
        created_at: registrations.createdAt,
        tournament: {
          id: tournaments.id,
          title: tournaments.title,
          description: tournaments.description,
          location: tournaments.location,
          google_sheet_tab_name: tournaments.googleSheetTabName,
          start_at: tournaments.startAt,
          max_players: tournaments.maxPlayers,
          kind: tournaments.kind,
          tournament_type: tournaments.tournamentType,
          season_id: tournaments.seasonId,
          status: tournaments.status,
          created_at: tournaments.createdAt,
        },
      })
      .from(registrations)
      .leftJoin(tournaments, eq(registrations.tournamentId, tournaments.id))
      .where(
        and(
          eq(registrations.playerId, playerId),
          inArray(registrations.status, ["registered", "waitlist", "attended"])
        )
      )
      .orderBy(desc(registrations.createdAt));

    return rows.map((row) => ({
      id: row.id,
      player_id: row.player_id,
      tournament_id: row.tournament_id,
      status: row.status as RegistrationRow["status"],
      created_at: row.created_at.toISOString(),
      tournament: row.tournament
        ? {
            ...row.tournament,
            start_at: row.tournament.start_at.toISOString(),
            created_at: row.tournament.created_at.toISOString(),
          }
        : null,
    })) as RegistrationWithTournamentRow[];
  }

  async findExportParticipants(tournamentId: string): Promise<ExportParticipantRow[]> {
    const rows = await db
      .select({
        id: registrations.id,
        status: registrations.status,
        created_at: registrations.createdAt,
        player_id: registrations.playerId,
        players: {
          id: players.id,
          username: players.username,
          admin_display_name: players.adminDisplayName,
          display_name: players.displayName,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "waitlist", "attended"])
        )
      )
      .orderBy(asc(registrations.createdAt));

    return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
  }

  async findParticipantsWithRating(tournamentId: string): Promise<ParticipantWithRatingRow[]> {
    const rows = await db
      .select({
        id: registrations.id,
        status: registrations.status,
        created_at: registrations.createdAt,
        tournament_id: registrations.tournamentId,
        player_id: registrations.playerId,
        players: {
          id: players.id,
          username: players.username,
          display_name: players.displayName,
          telegram_avatar_url: players.telegramAvatarUrl,
          custom_avatar_url: players.customAvatarUrl,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "attended", "waitlist"])
        )
      )
      .orderBy(asc(registrations.createdAt));

    return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
  }

  async findResultsDraftParticipants(tournamentId: string): Promise<ResultsDraftParticipantRow[]> {
    const rows = await db
      .select({
        id: registrations.id,
        status: registrations.status,
        created_at: registrations.createdAt,
        tournament_id: registrations.tournamentId,
        player_id: registrations.playerId,
        players: {
          id: players.id,
          username: players.username,
          admin_display_name: players.adminDisplayName,
          display_name: players.displayName,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "attended"])
        )
      )
      .orderBy(asc(registrations.createdAt));

    return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
  }

  async findAdminParticipants(tournamentId: string): Promise<AdminParticipantRow[]> {
    return db
      .select({
        id: registrations.id,
        status: registrations.status,
        player_id: registrations.playerId,
        players: {
          admin_display_name: players.adminDisplayName,
          display_name: players.displayName,
          telegram_avatar_url: players.telegramAvatarUrl,
          custom_avatar_url: players.customAvatarUrl,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "attended", "waitlist"])
        )
      )
      .orderBy(asc(registrations.createdAt));
  }

  async findLiveEligible(tournamentId: string): Promise<LiveEligibleRow[]> {
    return db
      .select({
        id: registrations.id,
        status: registrations.status,
        player_id: registrations.playerId,
        players: {
          id: players.id,
          username: players.username,
          admin_display_name: players.adminDisplayName,
          display_name: players.displayName,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(
        and(
          eq(registrations.tournamentId, tournamentId),
          inArray(registrations.status, ["registered", "attended"])
        )
      )
      .orderBy(asc(registrations.createdAt));
  }

  async findNotificationRecipients(
    tournamentId: string,
    statuses: RegistrationStatus[]
  ): Promise<NotificationRecipientRow[]> {
    return db
      .select({
        player_id: registrations.playerId,
        status: registrations.status,
        players: {
          telegram_id: players.telegramId,
          display_name: players.displayName,
        },
      })
      .from(registrations)
      .leftJoin(players, eq(registrations.playerId, players.id))
      .where(and(eq(registrations.tournamentId, tournamentId), inArray(registrations.status, statuses)));
  }
}

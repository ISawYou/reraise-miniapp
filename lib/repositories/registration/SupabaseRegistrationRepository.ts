import "server-only";

import { getSupabaseServer } from "@/lib/database";
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

// Moved here from features/tournaments.ts.
function mapRegistrationRow(row: RegistrationRow): Registration {
  return {
    id: row.id,
    player_id: row.player_id,
    tournament_id: row.tournament_id,
    status: row.status as RegistrationRow["status"],
    created_at: row.created_at,
  };
}

function flattenEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

// Current, active implementation — wraps the exact same Supabase queries
// that were previously spread across features/tournaments.ts. No new
// behavior.
export class SupabaseRegistrationRepository implements RegistrationRepository {
  async findActiveByPlayerId(playerId: string): Promise<Registration[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("player_id", playerId)
      .in("status", ["registered", "waitlist", "attended"]);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapRegistrationRow(row as RegistrationRow));
  }

  async findActiveByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<Registration | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("player_id", playerId)
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "waitlist", "attended"])
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data ? mapRegistrationRow(data as RegistrationRow) : null;
  }

  async findRegisteredTournamentIds(): Promise<{ tournament_id: string }[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("tournament_id, status")
      .eq("status", "registered");

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as { tournament_id: string }[];
  }

  async findLatestByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<RegistrationRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("player_id", playerId)
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as RegistrationRow[];
  }

  async findActiveOrWaitlistByPlayerAndTournamentOrThrow(
    playerId: string,
    tournamentId: string
  ): Promise<Registration> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("player_id", playerId)
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "waitlist"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapRegistrationRow(data as RegistrationRow);
  }

  async findOldestWaitlisted(tournamentId: string): Promise<RegistrationRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .eq("tournament_id", tournamentId)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as RegistrationRow[];
  }

  async findStatusAndTournamentById(
    registrationId: string
  ): Promise<{ status: string; tournament_id: string }> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select("status, tournament_id")
      .eq("id", registrationId)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as { status: string; tournament_id: string };
  }

  async create(data: RegistrationInsert): Promise<Registration> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("registrations")
      .insert(data)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapRegistrationRow(row as RegistrationRow);
  }

  async createSilent(data: RegistrationInsert): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from("registrations").insert(data);

    if (error) {
      throw new Error(error.message);
    }
  }

  async updateStatus(
    registrationId: string,
    status: RegistrationStatus
  ): Promise<Registration> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .update({ status })
      .eq("id", registrationId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapRegistrationRow(data as RegistrationRow);
  }

  async updateStatusSilent(
    registrationId: string,
    status: RegistrationStatus
  ): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("registrations")
      .update({ status })
      .eq("id", registrationId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async markAttendedBulk(
    tournamentId: string,
    playerIds: string[],
    fromStatuses: RegistrationStatus[]
  ): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("registrations")
      .update({ status: "attended" })
      .eq("tournament_id", tournamentId)
      .in("player_id", playerIds)
      .in("status", fromStatuses);

    if (error) {
      throw new Error(error.message);
    }
  }

  async delete(registrationId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("registrations")
      .delete()
      .eq("id", registrationId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("registrations")
      .delete()
      .eq("player_id", playerId);

    if (error) {
      throw new Error(`Ошибка удаления registrations: ${error.message}`);
    }
  }

  async findWithTournamentByPlayerId(
    playerId: string
  ): Promise<RegistrationWithTournamentRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        *,
        tournament:tournaments (*)
      `
      )
      .eq("player_id", playerId)
      .in("status", ["registered", "waitlist", "attended"])
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      tournament: flattenEmbedded(row.tournament),
    })) as RegistrationWithTournamentRow[];
  }

  async findExportParticipants(tournamentId: string): Promise<ExportParticipantRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        id,
        status,
        created_at,
        player_id,
        players (
          id,
          username,
          admin_display_name,
          display_name
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "waitlist", "attended"])
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as ExportParticipantRow[];
  }

  async findParticipantsWithRating(
    tournamentId: string
  ): Promise<ParticipantWithRatingRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        id,
        status,
        created_at,
        tournament_id,
        player_id,
        players (
          id,
          username,
          display_name,
          telegram_avatar_url,
          custom_avatar_url
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "attended", "waitlist"])
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as ParticipantWithRatingRow[];
  }

  async findResultsDraftParticipants(
    tournamentId: string
  ): Promise<ResultsDraftParticipantRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        id,
        status,
        created_at,
        tournament_id,
        player_id,
        players (
          id,
          username,
          admin_display_name,
          display_name
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "attended"])
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as ResultsDraftParticipantRow[];
  }

  async findAdminParticipants(tournamentId: string): Promise<AdminParticipantRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        id,
        status,
        player_id,
        players (
          admin_display_name,
          display_name,
          telegram_avatar_url,
          custom_avatar_url
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "attended", "waitlist"])
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as AdminParticipantRow[];
  }

  async findLiveEligible(tournamentId: string): Promise<LiveEligibleRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        id,
        status,
        player_id,
        players (
          id,
          username,
          admin_display_name,
          display_name
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", ["registered", "attended"])
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as LiveEligibleRow[];
  }

  async findNotificationRecipients(
    tournamentId: string,
    statuses: RegistrationStatus[]
  ): Promise<NotificationRecipientRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("registrations")
      .select(
        `
        player_id,
        status,
        players (
          telegram_id,
          display_name
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .in("status", statuses);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: any) => ({
      ...row,
      players: flattenEmbedded(row.players),
    })) as NotificationRecipientRow[];
  }
}

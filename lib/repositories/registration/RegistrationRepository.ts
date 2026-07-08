import type { Registration, RegistrationStatus } from "@/types/domain";
import type { RegistrationRow } from "@/types/database";

// Data-access boundary for `registrations` — who is signed up for what.
// Deliberately a thin CRUD surface: waitlist-vs-registered capacity
// decisions, promoting the next waitlisted player, and every bit of
// orchestration around registering/cancelling stay in
// features/tournaments.ts, exactly as before.
//
// Several methods below embed a `players (...)` join exactly as today's
// queries do — each mirrors one specific call site's exact select list
// (they differ enough — sometimes with `id`/`username`, sometimes not —
// that collapsing them into one generic method would either over-fetch in
// a way that risks new behavior or force a parameter-driven column list,
// which is its own kind of complexity this migration avoids).
export type RegistrationInsert = {
  player_id: string;
  tournament_id: string;
  status: RegistrationStatus;
};

export type PlayerJoin = {
  id?: string;
  username?: string | null;
  display_name?: string;
  admin_display_name?: string | null;
  telegram_avatar_url?: string | null;
  custom_avatar_url?: string | null;
  telegram_id?: number | null;
} | null;

export type RegistrationWithTournamentRow = RegistrationRow & {
  tournament: unknown;
};

export type ExportParticipantRow = {
  id: string;
  status: string;
  created_at: string;
  player_id: string;
  players: PlayerJoin;
};

export type ParticipantWithRatingRow = {
  id: string;
  status: string;
  created_at: string;
  tournament_id: string;
  player_id: string;
  players: PlayerJoin;
};

export type ResultsDraftParticipantRow = {
  id: string;
  status: string;
  created_at: string;
  tournament_id: string;
  player_id: string;
  players: PlayerJoin;
};

export type AdminParticipantRow = {
  id: string;
  status: string;
  player_id: string;
  players: PlayerJoin;
};

export type LiveEligibleRow = {
  id: string;
  status: string;
  player_id: string;
  players: PlayerJoin;
};

export type NotificationRecipientRow = {
  player_id: string;
  status: string;
  players: PlayerJoin;
};

export interface RegistrationRepository {
  findActiveByPlayerId(playerId: string): Promise<Registration[]>;
  findActiveByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<Registration | null>;
  // Mirrors getTournamentRegistrationCounts' exact select — used to derive
  // per-tournament registered counts in the feature layer.
  findRegisteredTournamentIds(): Promise<{ tournament_id: string }[]>;
  // Array, not single — mirrors registerPlayerForTournament's /
  // addExistingPlayerToTournament's "most recent registration regardless
  // of status" lookup, which never used .single()/.maybeSingle().
  findLatestByPlayerAndTournament(
    playerId: string,
    tournamentId: string
  ): Promise<RegistrationRow[]>;
  // Throws on 0 rows — mirrors cancelPlayerRegistration's `.single()` fetch.
  findActiveOrWaitlistByPlayerAndTournamentOrThrow(
    playerId: string,
    tournamentId: string
  ): Promise<Registration>;
  findOldestWaitlisted(tournamentId: string): Promise<RegistrationRow[]>;
  findStatusAndTournamentById(
    registrationId: string
  ): Promise<{ status: string; tournament_id: string }>;

  create(data: RegistrationInsert): Promise<Registration>;
  createSilent(data: RegistrationInsert): Promise<void>;
  updateStatus(registrationId: string, status: RegistrationStatus): Promise<Registration>;
  updateStatusSilent(registrationId: string, status: RegistrationStatus): Promise<void>;
  // Bulk transition used when a tournament completes — mirrors the
  // identical update in completeTournamentFromLiveEntries and
  // saveTournamentResults.
  markAttendedBulk(
    tournamentId: string,
    playerIds: string[],
    fromStatuses: RegistrationStatus[]
  ): Promise<void>;
  delete(registrationId: string): Promise<void>;
  // Cascading delete used by deleteManualPlayer — removes every
  // registration for a player being deleted entirely, as opposed to
  // `delete`, which removes one registration by its own id.
  deleteByPlayerId(playerId: string): Promise<void>;

  findWithTournamentByPlayerId(playerId: string): Promise<RegistrationWithTournamentRow[]>;
  findExportParticipants(tournamentId: string): Promise<ExportParticipantRow[]>;
  findParticipantsWithRating(tournamentId: string): Promise<ParticipantWithRatingRow[]>;
  findResultsDraftParticipants(tournamentId: string): Promise<ResultsDraftParticipantRow[]>;
  findAdminParticipants(tournamentId: string): Promise<AdminParticipantRow[]>;
  findLiveEligible(tournamentId: string): Promise<LiveEligibleRow[]>;
  findNotificationRecipients(
    tournamentId: string,
    statuses: RegistrationStatus[]
  ): Promise<NotificationRecipientRow[]>;
}

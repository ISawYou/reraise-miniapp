import { PostgresTournamentNotificationBroadcastRepository } from "./PostgresTournamentNotificationBroadcastRepository";
import type { TournamentNotificationBroadcastRepository } from "./TournamentNotificationBroadcastRepository";

export type {
  TournamentNotificationBroadcastRepository,
  TournamentNotificationBroadcastRow,
  TournamentNotificationBroadcastClaim,
  TournamentNotificationBroadcastClaimResult,
  TournamentNotificationBroadcastCounts,
  TournamentNotificationBroadcastError,
  TournamentNotificationBroadcastStatus,
} from "./TournamentNotificationBroadcastRepository";

// Postgres-only -- the broadcast idempotency ledger has no Supabase
// counterpart (Supabase is not a live target; see CLAUDE.md).
export const tournamentNotificationBroadcastRepository: TournamentNotificationBroadcastRepository =
  new PostgresTournamentNotificationBroadcastRepository();

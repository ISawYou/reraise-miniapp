// Data-access boundary for `tournament_notification_broadcasts` -- the
// durable idempotency ledger behind POST /api/admin/tournaments/notify.
// Thin persistence only; the claim/duplicate/fingerprint policy lives in
// features/tournament-notification-broadcast.ts.

export type TournamentNotificationBroadcastStatus = "processing" | "completed" | "failed";

export type TournamentNotificationBroadcastError = {
  player_id: string;
  telegram_id: number | null;
  display_name: string;
  error: string;
};

export type TournamentNotificationBroadcastRow = {
  id: string;
  broadcast_id: string;
  payload_fingerprint: string;
  tournament_id: string;
  audience: "registered" | "access";
  test_mode: boolean;
  status: TournamentNotificationBroadcastStatus;
  total_recipients: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  errors: TournamentNotificationBroadcastError[];
  created_at: string;
  completed_at: string | null;
};

export type TournamentNotificationBroadcastClaim = {
  broadcast_id: string;
  payload_fingerprint: string;
  tournament_id: string;
  audience: "registered" | "access";
  test_mode: boolean;
  total_recipients: number;
  skipped_count: number;
};

export type TournamentNotificationBroadcastCounts = {
  success_count: number;
  failed_count: number;
  skipped_count: number;
  errors: TournamentNotificationBroadcastError[];
};

export type TournamentNotificationBroadcastClaimResult =
  | { claimed: true; row: TournamentNotificationBroadcastRow }
  | { claimed: false; existing: TournamentNotificationBroadcastRow };

export interface TournamentNotificationBroadcastRepository {
  findByBroadcastId(broadcastId: string): Promise<TournamentNotificationBroadcastRow | null>;

  // Atomic claim: a single INSERT ... ON CONFLICT (broadcast_id) DO NOTHING
  // RETURNING. Exactly one caller per broadcast_id ever gets
  // { claimed: true } -- concurrent callers block on the unique index until
  // the winner's insert commits, then get { claimed: false } with the
  // winner's committed row.
  claim(data: TournamentNotificationBroadcastClaim): Promise<TournamentNotificationBroadcastClaimResult>;

  // processing -> completed/failed. Only transitions a row that is still
  // 'processing' (a finished row is never rewritten). Returns false if no
  // row was updated.
  markCompleted(broadcastId: string, counts: TournamentNotificationBroadcastCounts): Promise<boolean>;
  markFailed(broadcastId: string, counts: TournamentNotificationBroadcastCounts): Promise<boolean>;
}

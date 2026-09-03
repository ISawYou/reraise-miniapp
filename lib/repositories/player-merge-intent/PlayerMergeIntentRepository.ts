// Data-access boundary for player_merge_intents. Thin CRUD surface, no
// business logic -- eligibility rules, the reconciliation transaction, and
// every error type live in lib/player-merge.ts, same split every other
// domain in this repository layer uses.
export type MergeIntentStatus = "pending" | "conflict" | "completed" | "expired" | "cancelled";

export type PlayerMergeIntentRow = {
  id: string;
  target_player_id: string;
  source_player_id: string;
  email: string;
  otp_verification_id: string | null;
  status: MergeIntentStatus;
  conflict_reason: string | null;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};

export type PlayerMergeIntentInsert = {
  target_player_id: string;
  source_player_id: string;
  email: string;
  otp_verification_id: string | null;
  status: MergeIntentStatus;
  conflict_reason: string | null;
  expires_at: string;
};

export interface PlayerMergeIntentRepository {
  findById(id: string): Promise<PlayerMergeIntentRow | null>;
  create(data: PlayerMergeIntentInsert): Promise<PlayerMergeIntentRow>;
  // Feeds the /admin/account-merges read-only review queue.
  listConflicts(): Promise<PlayerMergeIntentRow[]>;
}

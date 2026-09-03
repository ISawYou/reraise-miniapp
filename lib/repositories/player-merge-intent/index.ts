import { PostgresPlayerMergeIntentRepository } from "./PostgresPlayerMergeIntentRepository";
import type { PlayerMergeIntentRepository } from "./PlayerMergeIntentRepository";

export type {
  PlayerMergeIntentRepository,
  PlayerMergeIntentRow,
  PlayerMergeIntentInsert,
  MergeIntentStatus,
} from "./PlayerMergeIntentRepository";

// Account merging is Postgres-only (see lib/player-merge.ts's
// assertPostgresMode) -- no Supabase implementation exists, same reasoning
// lib/repositories/dealer/index.ts already applies to Dealer Payroll V1.
export const playerMergeIntentRepository: PlayerMergeIntentRepository = new PostgresPlayerMergeIntentRepository();

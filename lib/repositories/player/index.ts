import { SupabasePlayerRepository } from "./SupabasePlayerRepository";
import { PostgresPlayerRepository } from "./PostgresPlayerRepository";
import type { PlayerRepository } from "./PlayerRepository";

export type {
  PlayerRepository,
  PlayerInsert,
  PlayerPatch,
  PlayerActivitySummary,
  DisplayNameCandidate,
  AccessRecipient,
  ReferralFields,
} from "./PlayerRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const playerRepository: PlayerRepository = usePostgres
  ? new PostgresPlayerRepository()
  : new SupabasePlayerRepository();

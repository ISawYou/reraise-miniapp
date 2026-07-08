import { SupabasePlayerRepository } from "./SupabasePlayerRepository";
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

export const playerRepository: PlayerRepository = new SupabasePlayerRepository();

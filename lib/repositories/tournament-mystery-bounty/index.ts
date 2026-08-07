import { SupabaseTournamentMysteryBountyRepository } from "./SupabaseTournamentMysteryBountyRepository";
import { PostgresTournamentMysteryBountyRepository } from "./PostgresTournamentMysteryBountyRepository";
import type { TournamentMysteryBountyRepository } from "./TournamentMysteryBountyRepository";

export type {
  TournamentMysteryBountyRepository,
  MysteryBountyRow,
  MysteryBountyInsert,
  MysteryBountyPatch,
  MysteryBountyStatusRow,
} from "./TournamentMysteryBountyRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const tournamentMysteryBountyRepository: TournamentMysteryBountyRepository = usePostgres
  ? new PostgresTournamentMysteryBountyRepository()
  : new SupabaseTournamentMysteryBountyRepository();

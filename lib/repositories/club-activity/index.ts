import { PostgresClubActivityRepository } from "./PostgresClubActivityRepository";

export type {
  ClubActivityEventRecord,
  ClubActivityRepository,
  CreateAutomaticClubActivityEvent,
  CreateManualClubActivityEvent,
  UpdateManualClubActivityEvent,
} from "./ClubActivityRepository";

// Club Activity Feed is a PostgreSQL-only production feature. Legacy
// Supabase is intentionally not a deployment target for this domain.
export const clubActivityRepository = new PostgresClubActivityRepository();

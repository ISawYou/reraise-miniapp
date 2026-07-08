import { SupabaseActivityRepository } from "./SupabaseActivityRepository";
import { PostgresActivityRepository } from "./PostgresActivityRepository";
import type { ActivityRepository } from "./ActivityRepository";

export type {
  ActivityRepository,
  ActivityEventInsert,
  ActivityEventDetail,
  ActivityEventSummary,
} from "./ActivityRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const activityRepository: ActivityRepository = usePostgres
  ? new PostgresActivityRepository()
  : new SupabaseActivityRepository();

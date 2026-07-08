import { SupabaseActivityRepository } from "./SupabaseActivityRepository";
import type { ActivityRepository } from "./ActivityRepository";

export type {
  ActivityRepository,
  ActivityEventInsert,
  ActivityEventDetail,
  ActivityEventSummary,
} from "./ActivityRepository";

export const activityRepository: ActivityRepository =
  new SupabaseActivityRepository();

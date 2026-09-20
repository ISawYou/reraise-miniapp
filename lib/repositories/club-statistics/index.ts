import { PostgresClubStatisticsRepository } from "./PostgresClubStatisticsRepository";
import type { ClubStatisticsRepository } from "./ClubStatisticsRepository";

export type {
  ClubStatisticsRepository,
  ClubStatisticRow,
  AchievementHolderRow,
} from "./ClubStatisticsRepository";

// Club Statistics (RELEASE C1) is Postgres-only -- read-only aggregation,
// no Supabase parity obligation. Same scoping decision as Dealer Payroll /
// Admin Shifts (see lib/repositories/dealer/index.ts).
export const clubStatisticsRepository: ClubStatisticsRepository = new PostgresClubStatisticsRepository();

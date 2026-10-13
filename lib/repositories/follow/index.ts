import { PostgresFollowRepository } from "./PostgresFollowRepository";
import type { FollowRepository } from "./FollowRepository";

export type { FollowPlayerSummary, FollowRepository } from "./FollowRepository";

// Player following is a PostgreSQL-only production feature. Legacy Supabase
// is intentionally not a deployment target for this domain.
export const followRepository: FollowRepository = new PostgresFollowRepository();

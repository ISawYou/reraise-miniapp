import { PostgresAcademyAccessRepository } from "./PostgresAcademyAccessRepository";
import type { AcademyAccessRepository } from "./AcademyAccessRepository";

export type { AcademyAccessRepository } from "./AcademyAccessRepository";

/**
 * Postgres-only (production runs DATABASE_PROVIDER=postgres; Supabase is
 * legacy and not a live target). Under any other provider nobody can be
 * proven to have participated, so eligibility fails CLOSED (staff are still
 * FULL — see features/academy-access.ts) instead of guessing.
 */
const failClosedAcademyAccessRepository: AcademyAccessRepository = {
  async hasPlayerParticipatedInSeason() {
    return false;
  },
};

export const academyAccessRepository: AcademyAccessRepository = process.env.DATABASE_PROVIDER === "postgres"
  ? new PostgresAcademyAccessRepository()
  : failClosedAcademyAccessRepository;

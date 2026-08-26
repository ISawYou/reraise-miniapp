import { PostgresDealerRepository } from "./PostgresDealerRepository";
import type { DealerRepository } from "./DealerRepository";

export type {
  DealerRepository,
  DealerProfileRow,
  DealerShiftRow,
  DealerShiftInsert,
  DealerShiftClosePatch,
  DealerShiftTimestampPatch,
} from "./DealerRepository";
export { DealerAlreadyOnShiftError } from "./DealerRepository";

// Dealer Payroll V1 is Postgres-only -- no Supabase implementation exists
// (see PostgresDealerRepository.ts's doc comment for why). Every other
// domain in this repository layer branches on DATABASE_PROVIDER between a
// Postgres and a Supabase implementation; this one deliberately does not.
export const dealerRepository: DealerRepository = new PostgresDealerRepository();

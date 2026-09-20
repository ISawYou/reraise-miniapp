import { PostgresAdminShiftRepository } from "./PostgresAdminShiftRepository";
import type { AdminShiftRepository } from "./AdminShiftRepository";

export type {
  AdminShiftRepository,
  AdminShiftRow,
  AdminShiftInsert,
  AdminShiftClosePatch,
  AdminShiftSuperAdminClosePatch,
  AdminShiftCompletedInsert,
  AdminShiftCorrectionPatch,
} from "./AdminShiftRepository";
export { AdminShiftAlreadyOnShiftError } from "./AdminShiftRepository";

// Admin Shifts V1 is Postgres-only -- no Supabase implementation exists,
// same scoping decision as Dealer Payroll V1 (see
// lib/repositories/dealer/index.ts).
export const adminShiftRepository: AdminShiftRepository = new PostgresAdminShiftRepository();

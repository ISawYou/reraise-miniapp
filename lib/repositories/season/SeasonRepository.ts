// Data-access boundary for `seasons`. Read-only today — nothing in the app
// creates/updates/deletes seasons through this codebase (that happens
// outside the app). No domain type exists for Season in types/domain.ts,
// so this returns the raw row shape as-is, matching what the four current
// call sites already do.
export type SeasonRow = {
  id: string;
  title: string;
  is_active: boolean;
};

export interface SeasonRepository {
  // Returns null both on a genuine "not found" (0 rows) and lets the
  // caller decide what error/response to produce — every one of today's
  // four call sites reacts differently (thrown fixed message, HTTP 404,
  // HTTP 400 vs 500 depending on cause), so that stays at the call site.
  findActive(): Promise<SeasonRow | null>;
}

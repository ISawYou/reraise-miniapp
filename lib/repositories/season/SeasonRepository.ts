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

// Full row shape (every column) — distinct from SeasonRow (which only
// carries what findActive()'s four existing callers use) so the
// backfill script can read/write a complete row without widening the
// narrower, already-relied-upon SeasonRow contract.
export type SeasonFullRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
};

export type SeasonInsert = SeasonFullRow;

// Admin-provided fields for a genuinely NEW season (season management v2 --
// see features/seasons.ts::createSeason). Distinct from SeasonInsert: id/
// created_at are DB-generated here, not caller-supplied, and this is a real
// insert (errors on failure), not the backfill script's idempotent upsert.
export type SeasonCreateInput = {
  title: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

export type SeasonUpdateInput = Partial<Pick<SeasonFullRow, "title" | "start_date" | "end_date">>;

export interface SeasonRepository {
  // Returns null both on a genuine "not found" (0 rows) and lets the
  // caller decide what error/response to produce — every one of today's
  // four call sites reacts differently (thrown fixed message, HTTP 404,
  // HTTP 400 vs 500 depending on cause), so that stays at the call site.
  findActive(): Promise<SeasonRow | null>;
  // Both added for the Supabase→PostgreSQL backfill script. Seasons have
  // never had a write path through this codebase — they're managed
  // outside the app (see the module comment above) — so `create` is the
  // first one; it's idempotent (upsert keyed on id) so a re-run backfill
  // doesn't duplicate or error. Not used by any route/feature today.
  listAll(): Promise<SeasonFullRow[]>;
  create(data: SeasonInsert): Promise<void>;
  // Narrow, single-purpose write -- season finalization
  // (features/seasons.ts::closeSeason) is the only caller today. No
  // schema change: `is_active` already exists, this is the first place
  // the app itself flips it (previously only ever set by the external
  // process that manages seasons -- see the module comment above).
  setActive(seasonId: string, isActive: boolean): Promise<void>;

  // Season management v2 -- genuine admin-facing writes, distinct from the
  // backfill-only `create` above.
  insert(data: SeasonCreateInput): Promise<SeasonFullRow>;
  update(seasonId: string, patch: SeasonUpdateInput): Promise<SeasonFullRow>;
  // Atomically deactivate one season and activate another -- required by
  // the seasons_one_active_key partial unique index (migration 0020): two
  // separate non-transactional UPDATEs risk a moment where either zero or
  // two rows are active, and a crash between them could leave production
  // with zero active seasons. `deactivateId: null` activates `activateId`
  // alone (rollover retry after the old season was already deactivated in
  // a prior, partially-failed attempt -- see features/seasons.ts::
  // rolloverSeason).
  setActivePair(deactivateId: string | null, activateId: string): Promise<void>;
}

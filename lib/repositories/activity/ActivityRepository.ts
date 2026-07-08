// Data-access boundary for activity_events. Deliberately a thin CRUD
// surface: the admin-activity toggle check, KPI aggregation (active
// today/7d, admin filtering, per-player grouping) all stay exactly where
// they are today — lib/activity-logger.ts and
// app/api/admin/activity/route.ts.
export type ActivityEventInsert = {
  player_id: string;
  event_type: string;
  event_label: string | null;
  metadata: Record<string, unknown> | null;
  platform: string;
  session_id: string | null;
};

// Mirrors the exact column list app/api/admin/activity/route.ts selects
// for a single player's history.
export type ActivityEventDetail = {
  event_type: string;
  event_label: string | null;
  metadata: Record<string, unknown> | null;
  platform: string;
  session_id: string | null;
  created_at: string;
};

// Mirrors the exact (narrower) column list the same route selects for the
// 7-day KPI aggregation — a different shape, not a subset reused, because
// today's code runs two different queries with two different `select`s.
export type ActivityEventSummary = {
  player_id: string;
  event_type: string;
  created_at: string;
};

export interface ActivityRepository {
  create(event: ActivityEventInsert): Promise<void>;
  findByPlayerId(playerId: string, limit: number): Promise<ActivityEventDetail[]>;
  findSince(sinceIso: string, limit: number): Promise<ActivityEventSummary[]>;
}

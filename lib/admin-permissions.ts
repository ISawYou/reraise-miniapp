// Server-side authorization allowlist for /api/admin/** -- the ONE central
// permission mapping, per this task's explicit instruction, rather than
// scattered `if role` checks across route handlers. middleware.ts is the
// only caller.
//
// Model:
// - role 'admin' (Super Admin): every /api/admin/** route, unrestricted --
//   exactly today's behavior, unchanged.
// - role 'operator': ONLY the routes explicitly listed below. FAIL CLOSED
//   -- a new /api/admin/** route with no entry here is denied to operator
//   by default, even if it looks tournament-related (see the doc comment
//   on OPERATOR_ALLOWED_ROUTES for why /api/admin/tournaments/** is NOT
//   blanket-allowed).
// - role 'player' (or unauthenticated): no /api/admin/** access at all.
//
// Audited directly against the real route files (Graphify + direct
// inspection), not guessed from naming:
// - Tournament CREATE goes through POST /api/admin/tournaments (a route,
//   covered here). Tournament UPDATE/DELETE do NOT go through any
//   /api/admin/** route at all -- they are Server Actions
//   (updateTournament/deleteTournament in features/tournaments.ts) invoked
//   directly from admin client components, which bypass this matcher
//   entirely. Those are separately guarded at the point of definition via
//   lib/admin-auth.ts's assertServerActorRole -- see that file's doc
//   comment and the call sites in features/tournaments.ts.
type OperatorRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  // Matches a pathname exactly, with `:id`-style path segments as `*`.
  pattern: RegExp;
};

function route(method: OperatorRoute["method"], path: string): OperatorRoute {
  // Turns "/api/admin/tournaments/:id/attendance" into a regex matching
  // exactly one non-slash segment for every ":id"-style placeholder.
  const escaped = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return { method, pattern: new RegExp(`^${escaped}$`) };
}

const OPERATOR_ALLOWED_ROUTES: OperatorRoute[] = [
  // Tournaments -- normal tournament-day operational flow.
  route("GET", "/api/admin/tournaments"),
  route("POST", "/api/admin/tournaments"),
  route("POST", "/api/admin/tournaments/:id/attendance"),
  route("POST", "/api/admin/tournaments/:id/eliminate"),
  route("POST", "/api/admin/tournaments/:id/return-to-game"),
  route("POST", "/api/admin/tournaments/:id/reorder-eliminations"),
  route("POST", "/api/admin/tournaments/:id/rebuy-state"),
  route("POST", "/api/admin/tournaments/:id/pull-sheet"),
  route("POST", "/api/admin/tournaments/:id/export-sheet"),
  route("POST", "/api/admin/tournaments/:id/live-sync"),
  route("GET", "/api/admin/tournaments/:id/late-registration"),
  route("POST", "/api/admin/tournaments/:id/late-registration"),
  route("GET", "/api/admin/tournaments/:id/mystery-bounty"),
  route("POST", "/api/admin/tournaments/:id/mystery-bounty/activate"),
  route("POST", "/api/admin/tournaments/:id/mystery-bounty/close-late-registration"),
  route("POST", "/api/admin/tournaments/:id/mystery-bounty/recalculate"),
  route("POST", "/api/admin/tournaments/:id/complete-free"),
  route("POST", "/api/admin/tournaments/:id/complete-live"),

  // Player directory read -- reused by the tournament-edit "add existing
  // player" search. Read-only, no PII beyond what the tournament-roster
  // search already needs; NOT the same as nickname moderation
  // (/api/admin/nicknames/pending, /api/admin/nicknames/:id), which stays
  // denied.
  route("GET", "/api/admin/nicknames/players"),

  // Dealers -- operational flow only (see app/admin/dealers/page.tsx's
  // operator branch). Listing dealers is allowed but the route itself
  // strips hourly_rate_rub from the response for a non-admin caller --
  // "allowed route" here is not the same as "sees the full payload".
  // Dealer activation/deactivation, rate edits, historical shift edits,
  // and payroll totals/history/stats are deliberately absent below.
  route("GET", "/api/admin/dealers"),
  route("POST", "/api/admin/dealers/shifts"),
  route("POST", "/api/admin/dealers/shifts/:shiftId/end"),
];

export function isAdminRouteAllowedForOperator(method: string, pathname: string): boolean {
  return OPERATOR_ALLOWED_ROUTES.some(
    (allowed) => allowed.method === method && allowed.pattern.test(pathname)
  );
}

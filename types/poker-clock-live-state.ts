// Shared shape for the read-only Re-Raise -> Poker Clock live-state summary.
// Deliberately framework-agnostic (no "server-only" import here) so both the
// server side (lib/poker-clock-client.ts, app/api/tournaments/live-state)
// and the client-side polling hook (lib/hooks/use-tournament-live-state.ts)
// can import the same types.
export type PokerClockClockStatus = "draft" | "running" | "paused" | "finished";

// Mirrors Poker Clock's GET /api/integrations/v1/tournaments/:id/live-state
// contract exactly. `startedAt` is carried through for completeness even
// though the home page card does not currently render it.
export type PokerClockClockState = {
  status: PokerClockClockStatus;
  startedAt: string | null;
  currentLevel: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  lateRegistrationRemainingSeconds: number | null;
  // Real BlindLevel.is_break from Poker Clock. `null` for "draft" (no level
  // is active yet); running/paused/finished carry the actual value. Never
  // inferred client-side from smallBlind/bigBlind being 0 -- see
  // lib/poker-clock-client.ts's parseLiveState.
  isBreak: boolean | null;
};

export type TournamentAttendanceSummary = {
  arrived: number;
  active: number;
};

// Re-Raise's own authoritative late-registration status (from
// features/late-registration.ts) -- `null` means "not applicable" (e.g. a
// paid/cash tournament, which has no late-registration concept) or "could
// not be determined this poll", not "open".
export type TournamentLateRegistrationStatus = {
  status: "open" | "closed";
  closedAt: string | null;
};

export type TournamentLiveSummary = {
  clock: PokerClockClockState | null;
  attendance: TournamentAttendanceSummary | null;
  lateRegistration: TournamentLateRegistrationStatus | null;
};

// Public, sanitized live-roster read model -- arrived players, active AND
// eliminated -- the player-facing counterpart of features/tournaments.ts's
// IntegrationPlayer, stripped of every admin/integration-only field
// (rebuys, addons, initial stack, KO counts, eliminatedAt). Lives here
// rather than in features/tournaments.ts (a "use server" file) so the
// client-side polling hook can import the type without pulling in
// server-action machinery.
//
// `eliminated`/`place` -- added alongside the existing fields, not a new
// concept: same canonical elimination/derived-place state
// getActiveTournamentPlayersForPublicView already reads from
// IntegrationPlayer (see features/tournaments.ts), just passed through
// instead of being filtered away. The player-facing "В игре" tab splits
// this one list into "В игре" (eliminated === false) and "Выбыли"
// (eliminated === true) itself -- see app/tournaments/[id]/page.tsx.
export type PublicActiveTournamentPlayer = {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  eliminated: boolean;
  place: number | null;
};

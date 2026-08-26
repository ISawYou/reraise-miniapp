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

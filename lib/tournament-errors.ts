// Shared tournament-domain error types. Deliberately NOT in
// features/tournaments.ts: that file has a top-level "use server" directive,
// and Next.js only allows async function exports from a "use server" file --
// exporting a class (even just to `throw`/`instanceof` it from elsewhere)
// breaks the whole module at build time. Same reason
// ResultPlaceValidationError already lives in
// lib/tournament-results-validation.ts rather than in features/tournaments.ts.

// Deliberately its own error type rather than sniffing the message text of
// whatever tournamentRepository.findById throws: the two Repository
// implementations throw different messages for "no such row" (Postgres:
// literal "Tournament not found"; Supabase: `.single()`'s raw PostgREST
// text) -- see docs/architecture.md section 8, both are live simultaneously
// against different deployments of this exact codebase. Catching once in
// features/tournaments.ts and re-throwing this keeps the 404-vs-500
// decision in the route handler correct on either deployment without
// changing TournamentRepository's existing throw behavior for any of its
// other callers.
export class TournamentNotFoundError extends Error {
  constructor(tournamentId: string) {
    super(`Tournament ${tournamentId} not found`);
    this.name = "TournamentNotFoundError";
  }
}

// Re-completion guard (features/tournament-completion-commit.ts). Once a
// tournament is `completed`, neither completion path (complete-free /
// complete-live) may run again: re-running full completion USED to be the
// informal way finishing places were corrected, and is now superseded by
// the Super-Admin place correction (features/
// completed-tournament-place-correction.ts). Thrown before any write (or
// inside the locked completion transaction, before its first write). Mapped
// to 409 by lib/tournament-completion-errors.ts::resolveCompletionError.
export const TOURNAMENT_ALREADY_COMPLETED_MESSAGE = "Турнир уже завершён";

export class TournamentAlreadyCompletedError extends Error {
  constructor() {
    super(TOURNAMENT_ALREADY_COMPLETED_MESSAGE);
    this.name = "TournamentAlreadyCompletedError";
  }
}

// Same Postgres-only precedent as lib/player-merge.ts's assertPostgresMode /
// CompletedPlaceCorrectionUnavailableError: the locked completion
// transaction is implemented against Drizzle/Postgres only.
export class TournamentCompletionUnavailableError extends Error {
  constructor() {
    super("Tournament completion requires DATABASE_PROVIDER=postgres");
    this.name = "TournamentCompletionUnavailableError";
  }
}

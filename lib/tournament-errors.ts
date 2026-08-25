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

// Per-player serialized + coalesced write queue for the "Пришёл" checkbox
// (app/admin/results/[id]/page.tsx::handleToggleFreeArrived).
//
// Why this exists: a real DB-level race was found and reproduced against a
// live Postgres instance -- two rapid clicks (true, then false) fire two
// independent HTTP requests, and nothing guarantees their DB round-trips
// complete in click order. Whichever write physically lands last in
// Postgres would silently win, even if it came from the OLDER click.
//
// The first fix tried was a server-side monotonic revision: the client
// would stamp each write with Date.now() and the server would reject any
// write whose stamp was lower than what's already stored. That was
// reverted -- trusting a client device's wall clock as an authoritative
// DB-level ordering token is unsound: clock skew between an admin's own
// laptop and phone can make a genuinely later action look "older" and get
// silently rejected, and nothing stops a client from sending an
// arbitrarily large stamp that permanently blocks every future write for
// that player (accidentally or otherwise).
//
// This is the actual fix: never let two writes for the same player be in
// flight at the same time IN THE FIRST PLACE. If the browser only ever
// sends one HTTP request per player at a time, there is no "out of order
// completion" for the server to get wrong -- Postgres processes them
// strictly in the order the browser sent them, which is exactly click
// order. The server-side upsert goes back to a plain, ordinary atomic
// upsert (no client-supplied revision, no rejection logic) -- see
// PostgresTournamentLiveStateRepository.ts::upsertAttendance. Across two
// different browser tabs/devices (each running its OWN independent
// instance of this queue), the server simply applies whichever write it
// processes last -- accepted as normal, sufficient semantics for an
// admin-facing checkbox; nothing here tries to solve THAT case.
//
// A plain, framework-agnostic class (no React) so its sequencing/coalescing
// behavior can be unit-tested directly with controllable, manually-resolved
// promises -- see __tests__/attendance-write-queue.test.ts. The class only
// knows "send one value, report the outcome"; optimistic UI updates, error
// display, and rollback-on-failure state all stay in the page component
// that owns this queue.
export class AttendanceWriteQueue<TResult> {
  private readonly pending = new Map<string, boolean>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly send: (key: string, arrived: boolean) => Promise<TResult>,
    private readonly onSettled: (key: string, result: TResult) => void,
    private readonly onError: (key: string, error: unknown) => void
  ) {}

  // True while a send is in flight for this key, or a value is queued to be
  // sent next once the in-flight one finishes. The caller uses this to
  // decide whether a click starts a brand new "burst" (and should capture a
  // fresh rollback baseline) or continues one already in progress.
  isActive(key: string): boolean {
    return this.inFlight.has(key) || this.pending.has(key);
  }

  // Records the caller's desired value and, if nothing is already in
  // flight for this key, starts sending it. If something IS already in
  // flight, this simply overwrites whatever was pending -- intermediate
  // desired values that get superseded before they're ever sent are never
  // sent at all (coalescing).
  push(key: string, arrived: boolean): void {
    this.pending.set(key, arrived);
    if (!this.inFlight.has(key)) {
      void this.pump(key);
    }
  }

  private async pump(key: string): Promise<void> {
    this.inFlight.add(key);
    try {
      for (;;) {
        const toSend = this.pending.get(key);
        if (toSend === undefined) {
          return;
        }
        this.pending.delete(key);

        let result: TResult;
        try {
          result = await this.send(key, toSend);
        } catch (error) {
          // Abandon the whole burst on failure -- matches this queue's
          // predecessor's per-click behavior (stop and surface the error;
          // the admin can just click again). Any value queued during the
          // failed attempt is dropped rather than silently retried, so a
          // failure never results in a surprise write the admin didn't
          // just explicitly ask for.
          this.pending.delete(key);
          this.onError(key, error);
          return;
        }

        // Only report this confirmation to the caller -- and let the UI
        // reflect it -- if nothing newer has been queued while we were
        // sending. Otherwise a confirmation for an already-superseded
        // value would visibly flash the UI back to stale state before the
        // next, already-queued send corrects it. If what's queued is
        // identical to what we just confirmed (a click that round-tripped
        // back to the same value), there is nothing left to send either.
        const stillDesired = this.pending.get(key);
        if (stillDesired === undefined || stillDesired === toSend) {
          this.pending.delete(key);
          this.onSettled(key, result);
          return;
        }
        // else: loop again with the newer desired value.
      }
    } finally {
      this.inFlight.delete(key);
    }
  }
}

// Per-player serialized + coalesced write queue for the "Re-buy"/"Add-on"
// inputs on a free-tournament results row
// (app/admin/results/[id]/page.tsx::handleCommitFreeRebuyState).
//
// Same shape and same reasoning as lib/attendance-write-queue.ts: never let
// two writes for the same player be in flight at once, so Postgres always
// processes them in the order the browser committed them (here: in the
// order the admin blurred each input), with no client-supplied ordering
// token needed. See that file's doc comment for the full history of why
// this pattern exists (a real out-of-order-completion race, and why a
// client wall-clock timestamp is the wrong fix for it).
//
// A free-typed number input can't reuse AttendanceWriteQueue<TResult>
// as-is -- that class is hardcoded to a boolean value (the "Пришёл"
// checkbox has exactly one bit to send). This is the same class shape,
// generalized over the value type instead of duplicating the queue logic
// with a second hardcoded shape.
export type RebuyStateValue = { rebuys: number; addons: number };

export class RebuyWriteQueue<TResult> {
  private readonly pending = new Map<string, RebuyStateValue>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly send: (key: string, value: RebuyStateValue) => Promise<TResult>,
    private readonly onSettled: (key: string, result: TResult) => void,
    private readonly onError: (key: string, error: unknown) => void
  ) {}

  isActive(key: string): boolean {
    return this.inFlight.has(key) || this.pending.has(key);
  }

  push(key: string, value: RebuyStateValue): void {
    this.pending.set(key, value);
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
          // Abandon the whole burst on failure, same as AttendanceWriteQueue
          // -- surface the error and let the admin retry (the next blur/edit
          // starts a fresh burst), rather than silently retrying a write the
          // admin didn't just explicitly commit.
          this.pending.delete(key);
          this.onError(key, error);
          return;
        }

        const stillDesired = this.pending.get(key);
        if (
          stillDesired === undefined ||
          (stillDesired.rebuys === toSend.rebuys && stillDesired.addons === toSend.addons)
        ) {
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

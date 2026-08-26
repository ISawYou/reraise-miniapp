// Boots the Google Sheets -> ReRaise live-sync background loop inside the
// existing persistent `node server.js` process (Docker CMD ["node",
// "server.js"], output: "standalone", restart: unless-stopped) -- no new
// container, no new worker, no external scheduler. Next.js calls
// register() exactly once per server runtime instance at boot.
//
// Runs only in the real Node runtime (never edge, never during `next
// build`'s static analysis). A `globalThis` flag additionally guards
// against double-registration within the same process, since Next.js can
// invoke register() more than once in some dev/HMR scenarios.
//
// No naive setInterval: the next tick is only scheduled from inside the
// current tick's `finally`, after runTournamentSheetSyncPass() has fully
// settled -- so two passes can never overlap. There is exactly one app
// replica in production today (docker-compose.yml has a single `app`
// service); if that ever changes, this loop will need leader
// election/advisory locking first -- not built here.
const SYNC_INTERVAL_MS = 15000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const globalScope = globalThis as typeof globalThis & {
    __reraiseTournamentSheetSyncStarted__?: boolean;
  };

  if (globalScope.__reraiseTournamentSheetSyncStarted__) {
    return;
  }
  globalScope.__reraiseTournamentSheetSyncStarted__ = true;

  const { runTournamentSheetSyncPass } = await import(
    "@/features/tournament-sheet-sync"
  );

  function scheduleNextTick() {
    setTimeout(runTick, SYNC_INTERVAL_MS);
  }

  async function runTick() {
    try {
      await runTournamentSheetSyncPass();
    } catch (error) {
      // A Google/DB failure must never crash the process -- each
      // tournament inside the pass already catches its own error;
      // this is a last-resort guard around the pass itself.
      console.error("[tournament-sheet-sync] pass failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scheduleNextTick();
    }
  }

  scheduleNextTick();
}

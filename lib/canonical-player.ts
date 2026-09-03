import { playerRepository } from "@/lib/repositories";
import type { Player } from "@/types/domain";

// Ported from Sterling/spb-poker (lib/canonical-player.ts, commit 9c11688 --
// a real production-incident fix there: a still-validly-signed session for
// an already-merged player kept resolving to the dead row). Bounds how many
// merged_into_player_id hops resolveCanonicalPlayer() will follow. The
// normal API can never actually produce a chain longer than one hop --
// lib/player-merge.ts's checkMergeEligibility() rejects any target that is
// itself already merged, so merging INTO a non-canonical player is not
// something the app's own endpoints can create. This bound exists purely as
// defense-in-depth against direct DB corruption or a future data migration
// mistake, not because multi-hop chains are an expected case.
const MAX_MERGE_HOPS = 10;

// The one place a raw players.id resolved from a session credential (a
// signed reraise_session cookie, or a Telegram telegram_id lookup) gets
// turned into the row that should actually carry authority for the rest of
// the request. A player row can be soft-merged into another one
// (players.merged_into_player_id -- see lib/player-merge.ts's executeMerge())
// without ever being deleted, so a still-valid, still-correctly-signed old
// session can keep resolving to that now-non-canonical row forever unless
// every consumer explicitly follows the pointer.
//
// Takes the already-fetched starting player (not just an id) so callers
// that already had to do one lookup to get here (features/auth-server.ts's
// getPlayerFromSessionServer, lib/admin-auth.ts's resolveAuthenticatedCaller)
// don't pay for a redundant first query -- the common case (a player who
// was never merged) costs nothing beyond the lookup that already happened.
//
// Fails closed: a cycle (corrupted A -> B -> A), a self-reference, a
// dangling merged_into_player_id pointing at a row that no longer exists, or
// a chain longer than MAX_MERGE_HOPS all return null rather than silently
// falling back to the raw, possibly-non-canonical starting player. Callers
// must treat a null return exactly like "no session" -- never substitute the
// original player as a fallback identity.
export async function resolveCanonicalPlayer(
  initial: Player | null
): Promise<Player | null> {
  if (!initial) {
    return null;
  }

  const visited = new Set<string>();
  let current = initial;

  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    if (visited.has(current.id)) {
      // A cycle (or a self-reference) -- the DB's own CHECK constraint and
      // checkMergeEligibility() should make this unreachable through the
      // app's own API, but resolution itself must never trust that and loop
      // forever on corrupted data.
      return null;
    }
    visited.add(current.id);

    if (!current.merged_into_player_id) {
      return current;
    }

    const next = await playerRepository.findById(current.merged_into_player_id);
    if (!next) {
      // Dangling merge pointer -- the row it points at no longer exists.
      // Fail closed rather than guess.
      return null;
    }

    current = next;
  }

  // Exceeded MAX_MERGE_HOPS without reaching a non-merged row -- treat as
  // unsafe/corrupted rather than trust an unbounded chain.
  return null;
}

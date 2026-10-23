// Operational-write guard for merged-away ("tombstone") player rows.
//
// PRODUCT INVARIANT: once players.merged_into_player_id IS NOT NULL the row
// is a historical identity only (see lib/player-merge.ts). It must never
// again receive a tournament registration, be selected as a live
// operational player, or receive new operational state (dealer profile,
// admin shift, manual achievement, referral counters, block/discount
// flags) as an independent person. The canonical target is the only live
// account; tombstones stay in the DB for audit/history.
//
// This is the STAFF-facing variant: a stale admin UI (or a direct call)
// submitted a merged-away id. It fails closed -- the submitted id is never
// silently redirected to the canonical target, because that could hide a
// stale-UI mistake or register the wrong person. The admin reloads and
// picks the canonical account.
//
// Deliberately dependency-free (no repositories, no "server-only"): it is
// imported by the Postgres-only tournament capacity module and by several
// feature modules whose unit tests mock @/features/auth-server wholesale.
// The player-facing equivalent (session/self-registration paths) stays
// features/auth-server.ts's PlayerMergedAwayError / assertPlayerActive --
// unchanged.

export const MERGED_AWAY_PLAYER_SELECTION_MESSAGE =
  "Этот аккаунт уже объединён с другим. Выберите основной аккаунт.";

export class MergedAwayPlayerSelectionError extends Error {
  readonly playerId: string;

  constructor(playerId: string, message = MERGED_AWAY_PLAYER_SELECTION_MESSAGE) {
    super(message);
    this.name = "MergedAwayPlayerSelectionError";
    this.playerId = playerId;
  }
}

// Check-then-write guard for single-row admin mutations that already load
// the player. NOT race-proof against a concurrent account merge on its own
// (the tournament admission path uses an in-transaction row lock instead --
// see features/tournament-waitlist-capacity.ts's
// lockOperationalEntrantPlayer); for these low-frequency admin actions the
// residual window is the merge committing between this read and the write.
export function assertNotMergedAwayPlayer(player: {
  id: string;
  merged_into_player_id?: string | null;
}): void {
  if (player.merged_into_player_id != null) {
    throw new MergedAwayPlayerSelectionError(player.id);
  }
}

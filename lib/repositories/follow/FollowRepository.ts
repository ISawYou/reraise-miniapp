// Data-access boundary for `follows` -- a directed "follower follows
// followed" edge. Structural invariants (no self-follow, one row per
// directed pair, cascade on player delete) are enforced by the database.
// Business rules (target exists, not merged away, viewer is authenticated
// and not blocked, error mapping) deliberately live in features/follows.ts,
// not here; this layer throws raw database errors.
//
// PostgreSQL-only domain -- there is no Supabase implementation.

// The only player fields a follow list exposes. Deliberately NO username /
// telegram_id / email: follower and following lists are public.
export type FollowPlayerSummary = {
  id: string;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

export interface FollowRepository {
  // Idempotent: an existing edge is left untouched (no error, no duplicate).
  create(followerPlayerId: string, followedPlayerId: string): Promise<void>;
  // Removes exactly the directed edge follower -> followed. A missing edge is
  // a no-op.
  delete(followerPlayerId: string, followedPlayerId: string): Promise<void>;
  // Directional: exists(A, B) says nothing about B -> A.
  exists(followerPlayerId: string, followedPlayerId: string): Promise<boolean>;
  // Incoming edges (followed_player_id = playerId).
  countFollowers(playerId: string): Promise<number>;
  // Outgoing edges (follower_player_id = playerId).
  countFollowing(playerId: string): Promise<number>;
  // Players who follow playerId, newest edge first (created_at DESC, id DESC).
  listFollowers(playerId: string, limit: number, offset: number): Promise<FollowPlayerSummary[]>;
  // Players that playerId follows, newest edge first (created_at DESC, id DESC).
  listFollowing(playerId: string, limit: number, offset: number): Promise<FollowPlayerSummary[]>;
  // EVERY followed player id for playerId -- intentionally unbounded (no
  // LIMIT), so the season leaderboard filter never silently drops follows
  // beyond a UI page size.
  listFollowingIds(playerId: string): Promise<string[]>;
}

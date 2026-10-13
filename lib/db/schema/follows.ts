import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { players } from "./players";

// Player following -- a directed "follower follows followed" edge. One row
// per edge; deleting either player removes the edge (ON DELETE CASCADE, same
// as club_activity_likes). Structural invariants live here in the DB (no
// self-follow, one row per directed pair); business rules (target exists,
// not merged away, viewer allowed) belong to features/follows.ts, not to the
// repository.
//
// PostgreSQL-only domain: there is deliberately no Supabase counterpart.
export const follows = pgTable("follows", {
  id: uuid().primaryKey().defaultRandom(),
  followerPlayerId: uuid("follower_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  followedPlayerId: uuid("followed_player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("follows_no_self_follow", sql`${table.followerPlayerId} <> ${table.followedPlayerId}`),

  // One row per directed pair. Its leading column also serves every
  // follower-side lookup (exists / delete / countFollowing / listFollowing /
  // listFollowingIds), so there is intentionally NO separate
  // follower_player_id index.
  uniqueIndex("follows_follower_followed_key").on(table.followerPlayerId, table.followedPlayerId),

  // Followers count + newest-first page: WHERE followed_player_id = $1
  // ORDER BY created_at DESC, id DESC. A follower-side
  // (follower_player_id, created_at DESC, id DESC) index is deliberately
  // deferred until real volume / EXPLAIN justifies it.
  index("follows_followed_created_idx").on(
    table.followedPlayerId,
    // nullsFirst() is the Postgres default for DESC; Drizzle would otherwise
    // emit DESC NULLS LAST, which would NOT match `ORDER BY ... DESC` and the
    // planner could not use the index for the sort (columns are NOT NULL, but
    // the planner does not exploit that).
    table.createdAt.desc().nullsFirst(),
    table.id.desc().nullsFirst(),
  ),
]);

import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";

// Teams v1 -- a player-created social/competitive layer on top of the
// existing individual rating. A team never stores or caches a points
// total (no team_points column anywhere): standings are always DERIVED at
// read time from results.rating_points + team_memberships history (see
// lib/team-scoring.ts). This table is identity/roster metadata only.
//
// status: 'active' | 'disbanded'. A disbanded team is never deleted (see
// disband's doc comment in features/teams.ts) -- it stays read-only and
// keeps whatever historical/current-season points its former members
// earned while they were on it, so standings remain reproducible.
export const teams = pgTable("teams", {
  id: uuid().primaryKey().defaultRandom(),

  // Trimmed, 2..40 chars, case-insensitive unique across EVERY team
  // regardless of status (see the lower(name) unique index below) -- a
  // disbanded team's name is never silently freed for reuse, since its row
  // is never deleted.
  name: text().notNull(),

  // One of config/team-emblems.ts's TEAM_EMBLEMS -- the one canonical
  // allowlist, enforced again here via the CHECK below (kept in sync with
  // that file by hand, same convention as tournaments.tournament_type's
  // CHECK vs the TournamentType union).
  emblem: text().notNull().default("♠️"),

  // Must always be a CURRENT active member of this team -- enforced
  // transactionally in features/teams.ts (create/transferCaptain), never
  // by a DB constraint alone (a DB CHECK can't reference team_memberships).
  // No onDelete override (defaults to NO ACTION/restrict): a player row is
  // never hard-deleted by this app in practice, and if it ever were, it
  // must not silently orphan a team's captaincy.
  captainPlayerId: uuid("captain_player_id").notNull().references(() => players.id),

  status: text().notNull().default("active"),

  // Optional captain-uploaded photo, normalized (Sharp, 512x512 WebP) and
  // stored via the existing avatarStorageRepository -- see
  // lib/team-avatar-derivative.ts and features/teams.ts's uploadTeamAvatar.
  // NULL means "no photo yet" -- the emblem above remains the fallback and
  // is never cleared when a photo is set, so removing the photo restores it
  // (features/teams.ts's resetTeamAvatar only ever nulls this column).
  avatarUrl: text("avatar_url"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  disbandedAt: timestamp("disbanded_at", { withTimezone: true }),
}, (table) => [
  check(
    "teams_name_length_check",
    sql`char_length(btrim(${table.name})) BETWEEN 2 AND 40`,
  ),
  check("teams_status_check", sql`${table.status} IN ('active', 'disbanded')`),
  check(
    "teams_emblem_check",
    sql`${table.emblem} IN ('♠️', '♥️', '♦️', '♣️', '👑', '🔥', '⚡', '🐺', '🦈', '🐉', '💎', '🏆')`,
  ),
  // disbanded_at is set iff status = 'disbanded' -- the two columns can
  // never drift into an inconsistent combination.
  check(
    "teams_disbanded_at_consistency_check",
    sql`(${table.status} = 'disbanded' AND ${table.disbandedAt} IS NOT NULL) OR (${table.status} = 'active' AND ${table.disbandedAt} IS NULL)`,
  ),

  // Case-insensitive global uniqueness -- see the name doc comment above.
  uniqueIndex("teams_name_lower_unique_idx").on(sql`lower(${table.name})`),
  index("teams_status_idx").on(table.status),
  index("teams_captain_player_id_idx").on(table.captainPlayerId),
]);

// One row per membership INTERVAL, never mutated in place except to close
// it (left_at). Rejoining after leaving creates a NEW row -- this table is
// the one and only source of "who was on which team, when", and
// lib/team-scoring.ts's temporal attribution reads it as immutable history.
// NEVER delete a row here as part of ordinary leave/kick/disband.
export const teamMemberships = pgTable("team_memberships", {
  id: uuid().primaryKey().defaultRandom(),

  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  // NULL = currently active. Set once, at leave/kick/disband time -- never
  // cleared or reused; rejoining is always a brand new row.
  leftAt: timestamp("left_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "team_memberships_left_after_joined_check",
    sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.joinedAt}`,
  ),

  // THE capacity/single-team invariant, enforced at the DB level so no
  // race (concurrent invitation acceptance, concurrent create) can ever
  // give one player two simultaneous active memberships (see
  // features/teams.ts's transactional accept/create for the row-lock
  // discipline that works together with this index, not instead of it).
  uniqueIndex("team_memberships_one_active_per_player_idx")
    .on(table.playerId)
    .where(sql`${table.leftAt} IS NULL`),

  index("team_memberships_team_id_idx").on(table.teamId),
  index("team_memberships_player_id_idx").on(table.playerId),
  index("team_memberships_joined_at_idx").on(table.joinedAt),
  index("team_memberships_left_at_idx").on(table.leftAt),
]);

// One row per invitation ATTEMPT -- accepting/declining/cancelling always
// updates status in place and stamps responded_at; nothing here is ever
// deleted, so a captain's invitation history stays fully auditable.
export const teamInvitations = pgTable("team_invitations", {
  id: uuid().primaryKey().defaultRandom(),

  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  invitedPlayerId: uuid("invited_player_id").notNull().references(() => players.id),
  invitedByPlayerId: uuid("invited_by_player_id").notNull().references(() => players.id),

  status: text().notNull().default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (table) => [
  check(
    "team_invitations_status_check",
    sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled')`,
  ),
  // responded_at is set iff status has actually been resolved -- a
  // still-pending invitation never carries a response timestamp, and a
  // resolved one is never missing one.
  check(
    "team_invitations_responded_at_consistency_check",
    sql`(${table.status} = 'pending' AND ${table.respondedAt} IS NULL) OR (${table.status} != 'pending' AND ${table.respondedAt} IS NOT NULL)`,
  ),

  // At most one PENDING invitation per (team, player) -- re-inviting after
  // a decline/cancel is allowed (that prior row just keeps its resolved
  // status; a new row is inserted for the new attempt).
  uniqueIndex("team_invitations_one_pending_per_team_player_idx")
    .on(table.teamId, table.invitedPlayerId)
    .where(sql`${table.status} = 'pending'`),

  index("team_invitations_team_id_idx").on(table.teamId),
  index("team_invitations_invited_player_id_idx").on(table.invitedPlayerId),
  index("team_invitations_status_idx").on(table.status),
]);

// Player -> team join requests -- the MIRROR direction of team_invitations
// (captain -> player), deliberately a SEPARATE table rather than reusing
// team_invitations with reversed semantics: an invitation and a request
// have different actors, different capacity-reservation rules (an
// invitation reserves a seat; a request never does), and different
// accept/decline authorities. Same "never delete, always update status in
// place" discipline as team_invitations.
export const teamJoinRequests = pgTable("team_join_requests", {
  id: uuid().primaryKey().defaultRandom(),

  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id),

  status: text().notNull().default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (table) => [
  check(
    "team_join_requests_status_check",
    sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled')`,
  ),
  check(
    "team_join_requests_responded_at_consistency_check",
    sql`(${table.status} = 'pending' AND ${table.respondedAt} IS NULL) OR (${table.status} != 'pending' AND ${table.respondedAt} IS NOT NULL)`,
  ),

  // At most one PENDING request per (team, player) -- same shape as
  // team_invitations' own uniqueness rule.
  uniqueIndex("team_join_requests_one_pending_per_team_player_idx")
    .on(table.teamId, table.playerId)
    .where(sql`${table.status} = 'pending'`),

  index("team_join_requests_team_id_idx").on(table.teamId),
  index("team_join_requests_player_id_idx").on(table.playerId),
  index("team_join_requests_status_idx").on(table.status),
]);

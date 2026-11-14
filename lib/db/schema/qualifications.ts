import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players } from "./players";
import { tournaments } from "./tournaments";

export const qualificationEvents = pgTable("qualification_events", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull(), title: text().notNull(), rules: text().notNull(),
  timezone: text().notNull().default("Europe/Moscow"),
  finalDate: date("final_date").notNull(),
  bestResultsCount: integer("best_results_count").notNull().default(3),
  status: text().notNull().default("draft"),
  version: integer().notNull().default(1),
  finalTournamentId: uuid("final_tournament_id").references(() => tournaments.id),
  winnerPlayerId: uuid("winner_player_id").references(() => players.id),
  rankingFingerprint: text("ranking_fingerprint"),
  finalOutcome: jsonb("final_outcome").$type<{ survivorIds: string[]; arrivedIds: string[]; eliminations: { playerId: string; place: number }[]; completedAt: string }>(),
  tieResolution: jsonb("tie_resolution").$type<{ fingerprint: string; playerOrder: string[] }>(),
  qualificationClosedAt: timestamp("qualification_closed_at", { withTimezone: true }),
  finalRosterLockedAt: timestamp("final_roster_locked_at", { withTimezone: true }),
  squadConfirmedAt: timestamp("squad_confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("qualification_event_slug_key").on(t.slug),
  uniqueIndex("qualification_final_tournament_key").on(t.finalTournamentId),
  check("qualification_event_status_check", sql`${t.status} IN ('draft','qualifying','inviting','final','completed')`),
  check("qualification_best_count_check", sql`${t.bestResultsCount} BETWEEN 1 AND 6`),
  check("qualification_event_version_check", sql`${t.version}>0`),
  check("qualification_event_title_check", sql`char_length(btrim(${t.title})) BETWEEN 2 AND 120`),
  check("qualification_event_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("qualification_locked_phase_check", sql`${t.status} NOT IN ('final','completed') OR (${t.finalRosterLockedAt} IS NOT NULL AND ${t.finalTournamentId} IS NOT NULL AND ${t.winnerPlayerId} IS NOT NULL)`),
  check("qualification_completed_check", sql`${t.status} <> 'completed' OR ${t.squadConfirmedAt} IS NOT NULL`),
]);
export const qualificationSlots = pgTable("qualification_tournament_slots", {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => qualificationEvents.id),
  scheduledDate: date("scheduled_date").notNull(),
  tournamentId: uuid("tournament_id").references(() => tournaments.id),
  displayOrder: integer("display_order").notNull(),
}, t => [uniqueIndex("qualification_slot_date_key").on(t.eventId,t.scheduledDate),uniqueIndex("qualification_slot_order_key").on(t.eventId,t.displayOrder),uniqueIndex("qualification_slot_tournament_key").on(t.eventId,t.tournamentId),check("qualification_slot_order_check",sql`${t.displayOrder} BETWEEN 0 AND 5`)]);
export const qualificationInvitations = pgTable("qualification_invitations", {
  id: uuid().primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => qualificationEvents.id),
  playerId: uuid("player_id").notNull().references(() => players.id),
  qualifyingRank: integer("qualifying_rank"), manualAdmission:boolean("manual_admission").notNull().default(false), seat: integer().notNull(),
  status: text().notNull().default("pending"),
  invitedAt: timestamp("invited_at",{withTimezone:true}).notNull().defaultNow(),
  respondedAt: timestamp("responded_at",{withTimezone:true}),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => qualificationInvitations.id),
}, t => [
  uniqueIndex("qualification_active_player_key").on(t.eventId,t.playerId).where(sql`${t.status} IN ('pending','accepted')`),
  uniqueIndex("qualification_active_seat_key").on(t.eventId,t.seat).where(sql`${t.status} IN ('pending','accepted')`),
  index("qualification_invitation_history_idx").on(t.eventId,t.playerId),
  check("qualification_invitation_status_check",sql`${t.status} IN ('pending','accepted','declined','cancelled','replaced')`),
  check("qualification_invitation_seat_check",sql`${t.seat} BETWEEN 1 AND 18`),
  check("qualification_invitation_rank_check",sql`${t.qualifyingRank} >=2`),
  check("qualification_invitation_admission_check",sql`(${t.manualAdmission} AND ${t.qualifyingRank} IS NULL) OR (NOT ${t.manualAdmission} AND ${t.qualifyingRank} IS NOT NULL AND ${t.qualifyingRank}>=2)`),
]);
export const qualificationSquad = pgTable("qualification_squad_members", {
  id:uuid().primaryKey().defaultRandom(),eventId:uuid("event_id").notNull().references(()=>qualificationEvents.id),
  playerId:uuid("player_id").notNull().references(()=>players.id),
  source:text("selection_source").notNull(),slot:integer().notNull(),
  finalPlace:integer("final_place"),confirmedAt:timestamp("confirmed_at",{withTimezone:true}),
}, t=>[uniqueIndex("qualification_squad_player_key").on(t.eventId,t.playerId),uniqueIndex("qualification_squad_slot_key").on(t.eventId,t.source,t.slot),check("qualification_squad_source_slot_check",sql`(${t.source} IN ('qualification_winner','captain') AND ${t.slot}=0) OR (${t.source}='final_top3' AND ${t.slot} BETWEEN 1 AND 3)`)]);
// Domain audit trail: actor, action and IDs/reasons only. Never point snapshots.
export const qualificationAudit = pgTable("qualification_audit", {
  id:uuid().primaryKey().defaultRandom(),eventId:uuid("event_id").notNull().references(()=>qualificationEvents.id),
  actorId:uuid("actor_id").notNull().references(()=>players.id),action:text().notNull(),
  detail:jsonb().$type<Record<string,unknown>>().notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("qualification_audit_event_idx").on(t.eventId,t.createdAt)]);

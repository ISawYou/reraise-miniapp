import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, boolean, bigint, jsonb, check } from 'drizzle-orm/pg-core';
// Private operational audit/transaction-scoped permit, never public activity.
export const adminAdmissions = pgTable('admin_tournament_admissions', {
    requestId: uuid('request_id').primaryKey(), tournamentId: uuid('tournament_id').notNull(), playerId: uuid('player_id').notNull(), actorId: uuid('actor_id').notNull(), registrationId: uuid('registration_id'), phase: text().notNull(), arrivalConfirmed: boolean('arrival_confirmed').notNull().default(false), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), state: text().notNull().default('pending'), transactionId: bigint('transaction_id', { mode: 'bigint' }).notNull(), backendPid: bigint('backend_pid', { mode: 'number' }).notNull(), input: jsonb().notNull(), snapshotBefore: jsonb('snapshot_before'), rulesBefore: jsonb('rules_before').notNull(),
}, t => [check('admin_admission_phase', sql `${t.phase} in ('normal','after_time','after_snapshot')`), check('admin_admission_state', sql `${t.state} in ('pending','succeeded')`)]);

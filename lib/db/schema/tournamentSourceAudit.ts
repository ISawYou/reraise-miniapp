import {pgTable,uuid,jsonb,timestamp} from "drizzle-orm/pg-core";
export const tournamentSourceAudit=pgTable("tournament_source_audit",{
 requestId:uuid("request_id").primaryKey(),tournamentId:uuid("tournament_id").notNull(),actorId:uuid("actor_id").notNull(),comparison:jsonb().notNull(),imported:jsonb().notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

import {bigint,boolean,integer,jsonb,pgTable,primaryKey,timestamp,uuid} from "drizzle-orm/pg-core";
// Private, transaction/backend-bound authorization plus audit. No client API.
export const accountMergeMaintenance=pgTable("account_merge_maintenance",{
 transactionId:bigint("transaction_id",{mode:"bigint"}).notNull(),backendPid:integer("backend_pid").notNull(),
 sourceId:uuid("source_id").notNull(),targetId:uuid("target_id").notNull(),actorId:uuid("actor_id").notNull(),intentId:uuid("intent_id"),
 scope:jsonb().notNull(),finished:boolean().notNull().default(false),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.transactionId,t.backendPid]})]);

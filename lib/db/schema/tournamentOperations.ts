import {sql} from "drizzle-orm";
import {pgTable,uuid,boolean,text,integer,timestamp,jsonb,primaryKey,check} from "drizzle-orm/pg-core";
import {tournaments} from "./tournaments";
import {players} from "./players";
export const tournamentOperations=pgTable("tournament_operations",{
 tournamentId:uuid("tournament_id").notNull().references(()=>tournaments.id,{onDelete:"cascade"}),
 playerId:uuid("player_id").notNull().references(()=>players.id,{onDelete:"cascade"}),
 paid:boolean(),paymentMethod:text("payment_method"),freeReentries:integer("free_reentries"),
 knockouts:integer(),bossKnockouts:integer("boss_knockouts"),mysteryPoints:integer("mystery_points"),mysteryEnvelopesWon:integer("mystery_envelopes_won"),place:integer(),
 version:integer().notNull().default(1),updatedBy:uuid("updated_by").notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tournamentId,t.playerId]}),check("operations_envelopes_nonnegative",sql`${t.mysteryEnvelopesWon} is null or ${t.mysteryEnvelopesWon}>=0`),check("operations_nonnegative",sql`(${t.freeReentries} is null or ${t.freeReentries}>=0) and (${t.knockouts} is null or ${t.knockouts}>=0) and (${t.bossKnockouts} is null or ${t.bossKnockouts}>=0) and (${t.mysteryPoints} is null or ${t.mysteryPoints}>=0) and (${t.place} is null or ${t.place}>0) and ${t.version}>0`),check("operations_payment_method",sql`${t.paymentMethod} is null or ${t.paymentMethod} in ('cash','card','mixed')`)]);
export const tournamentOperationAudit=pgTable("tournament_operation_audit",{
 id:uuid().primaryKey().defaultRandom(),tournamentId:uuid("tournament_id").notNull(),playerId:uuid("player_id").notNull(),actorId:uuid("actor_id").notNull(),before:jsonb(),after:jsonb().notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

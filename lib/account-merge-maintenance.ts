import "server-only";
import {sql} from "drizzle-orm";
import type {db} from "@/lib/db";
import type {CollisionPlan} from "@/lib/player-merge-reconciliation";
export async function beginMergeMaintenance(tx:typeof db,input:{sourceId:string;targetId:string;actorId:string;intentId?:string;plan:CollisionPlan}){
 const plan=input.plan.tournaments.map(t=>({tournamentId:t.tournamentId,
  tournament_attendance:t.attendance?{arrived:t.attendance.arrived,arrived_at:t.attendance.arrivedAt}:null,
  tournament_player_eliminations:t.elimination?{eliminated:t.elimination.eliminated,eliminated_at:t.elimination.eliminatedAt}:null,
  tournament_rebuy_state:t.rebuyState?{rebuys:t.rebuyState.rebuys,addons:t.rebuyState.addons}:null,
 }));
 await tx.execute(sql`select public.issue_account_merge_maintenance(${input.sourceId}::uuid,${input.targetId}::uuid,${input.actorId}::uuid,${input.intentId??null}::uuid,${JSON.stringify(plan)}::jsonb)`);
}
export async function finishMergeMaintenance(tx:typeof db){
 await tx.execute(sql`update public.account_merge_maintenance set finished=true where transaction_id=txid_current() and backend_pid=pg_backend_pid()`);
}

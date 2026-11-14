import type {OperationFields} from './tournament-operation-fields';
type DisplayOperations=Partial<Omit<OperationFields,'paymentMethod'>>&{paymentMethod?:string|null;playerId:string;version:number};
export type FrozenConsoleResult={playerId:string;place:number|null;reentries:number|null;addons:number|null;knockouts:number|null;bossKnockouts:number|null;freeReentries:number|null;mysteryPoints:number|null;ratingPoints:number|null};
// Display-only overlay. Never infer unknown facts or persist effective defaults.
export function completedConsoleResults<R extends {id:string;rebuys:number;addons:number;derivedPlace?:number|null;entriesKnown?:boolean},O extends DisplayOperations>(rows:R[],operations:O[],results:FrozenConsoleResult[]){
 const byPlayer=new Map(results.map(r=>[r.playerId,r]));
 return {
 rows:rows.map(row=>{const r=byPlayer.get(row.id);return !r?row:{...row,...(r.reentries!=null?{rebuys:r.reentries,entriesKnown:true}:{}),...(r.addons!=null?{addons:r.addons}:{}),derivedPlace:r.place??row.derivedPlace,ratingPoints:r.ratingPoints};}),
 operations:rows.map(row=>{const raw=operations.find(o=>o.playerId===row.id),r=byPlayer.get(row.id);const op:DisplayOperations={...raw,playerId:row.id,version:raw?.version??0};if(r)for(const field of ['knockouts','bossKnockouts','freeReentries','mysteryPoints','place'] as const)if(r[field]!=null)op[field]=r[field];return op;}),
 };
}

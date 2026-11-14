import {completedConsoleResults} from "@/lib/completed-console-results";
import {NextResponse} from "next/server";
import {assertServerActorRole,ForbiddenActionError,UnauthorizedActionError} from "@/lib/admin-auth";
import {OperationsError,tournamentOperationsRepository} from "@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository";
import {parseOperationPatch} from "@/lib/tournament-operation-fields";
type Context={params:Promise<{id:string}>};
function failure(e:unknown){
 const status=e instanceof UnauthorizedActionError?401:e instanceof ForbiddenActionError?403:e instanceof OperationsError?e.status:500;
 return NextResponse.json({error:status===500?"Не удалось сохранить или загрузить операционные данные":(e as Error).message},{status});
}
export async function GET(_request:Request,{params}:Context){try{
 await assertServerActorRole(["admin","operator"]);
 if(process.env.DATABASE_PROVIDER!=="postgres")return NextResponse.json({error:"Требуется PostgreSQL"},{status:503});
 const id=(await params).id;
 const f=await import("@/features/tournaments");
 const [rows,players,a,b,e]=await Promise.all([tournamentOperationsRepository.read(id),f.getAdminTournamentParticipants(id),f.getTournamentAttendance(id),f.getTournamentRebuyState(id),f.getTournamentEliminations(id)]);
 const derived=await f.getDerivedEliminationPlaces(id);
 const liveRows=players.map(p=>({id:p.player_id,name:p.admin_nick,status:p.status,arrived:a.get(p.player_id)?.arrived??false,eliminated:e.get(p.player_id)?.eliminated??false,time:e.get(p.player_id)?.eliminated_at??null,rebuys:b.get(p.player_id)?.rebuys??0,addons:b.get(p.player_id)?.addons??0,derivedPlace:derived.get(p.player_id)??null,attendanceKnown:a.has(p.player_id),entriesKnown:b.has(p.player_id)}));
 const tournament=await f.getTournamentById(id);
 const display=tournament.status==="completed"?completedConsoleResults(liveRows,rows,await tournamentOperationsRepository.readFrozenResults(id)):{rows:liveRows,operations:rows};
 return NextResponse.json({rows:display.operations,liveRows:display.rows},{headers:{"Cache-Control":"no-store"}});
}catch(e){return failure(e);}}
export async function PATCH(request:Request,{params}:Context){try{
 const actor=await assertServerActorRole(["admin","operator"]);
 if(process.env.DATABASE_PROVIDER!=="postgres")return NextResponse.json({error:"Требуется PostgreSQL"},{status:503});
 const body=await request.json().catch(()=>null);
 if(!body||typeof body.playerId!=="string"||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=2147483647)return NextResponse.json({error:"Требуются playerId и expectedVersion"},{status:400});
 let patch;try{patch=parseOperationPatch(body.patch);}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
 return NextResponse.json({row:await tournamentOperationsRepository.patch({tournamentId:(await params).id,playerId:body.playerId,actorId:actor.id,expectedVersion:body.expectedVersion,patch})});
}catch(e){return failure(e);}}

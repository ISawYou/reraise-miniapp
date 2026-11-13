import {NextResponse} from "next/server";
import {assertServerActorRole,UnauthorizedActionError,ForbiddenActionError} from "@/lib/admin-auth";
import {previewPostgresCompletion,completePostgresTournament} from "@/features/postgres-tournament-completion";
type C={params:Promise<{id:string}>};
async function run(request:Request,{params}:C,commit:boolean){try{
 await assertServerActorRole(["admin","operator"]);
 if(process.env.DATABASE_PROVIDER!=="postgres")return NextResponse.json({error:"Требуется PostgreSQL"},{status:503});
 const {id}=await params;
 if(!commit)return NextResponse.json(await previewPostgresCompletion(id),{headers:{"Cache-Control":"no-store"}});
 const body=await request.json().catch(()=>null);
 if(body?.confirmed!==true||typeof body.fingerprint!=="string")return NextResponse.json({error:"Подтвердите проверенный предварительный расчёт"},{status:400});
 return NextResponse.json(await completePostgresTournament(id,body.fingerprint));
 }catch(e){return NextResponse.json({error:(e as Error).message},{status:e instanceof UnauthorizedActionError?401:e instanceof ForbiddenActionError?403:409});}}
export const GET=(r:Request,c:C)=>run(r,c,false);
export const POST=(r:Request,c:C)=>run(r,c,true);

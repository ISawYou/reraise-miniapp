import {NextResponse} from "next/server";
import {assertServerActorRole,UnauthorizedActionError,ForbiddenActionError} from "@/lib/admin-auth";
import {previewCutover,applyCutover} from "@/features/tournament-source-cutover";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type C={params:Promise<{id:string}>};
async function run(request:Request,{params}:C,commit:boolean){try{
 const actor=await assertServerActorRole(["admin"]);
 if(process.env.DATABASE_PROVIDER!=="postgres")return NextResponse.json({error:"Требуется PostgreSQL"},{status:503});
 const {id}=await params;if(!commit)return NextResponse.json(await previewCutover(id),{headers:{"Cache-Control":"no-store"}});
 const body=await request.json().catch(()=>null);
 if(!body||!uuid.test(body.requestId??"")||body.confirmed!==true||typeof body.fingerprint!=="string"||typeof body.sheetHash!=="string"||!body.choices||typeof body.choices!=="object"||Array.isArray(body.choices))return NextResponse.json({error:"Подтвердите сравнение и выберите разрешение конфликтов"},{status:400});
 return NextResponse.json(await applyCutover({id,actorId:actor.id,requestId:body.requestId,confirmed:true,fingerprint:body.fingerprint,sheetHash:body.sheetHash,choices:body.choices}));
 }catch(e){return NextResponse.json({error:(e as Error).message},{status:e instanceof UnauthorizedActionError?401:e instanceof ForbiddenActionError?403:409});}}
export const GET=(r:Request,c:C)=>run(r,c,false);
export const POST=(r:Request,c:C)=>run(r,c,true);

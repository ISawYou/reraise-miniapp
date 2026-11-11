import { NextResponse } from "next/server";
import { getAdminQualification, mutateQualification } from "@/features/qualifications";
import { qualificationFailure } from "@/lib/qualification-http";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{return NextResponse.json(await getAdminQualification((await context.params).id,new URL(request.url).searchParams.get("finalDate")??undefined));}catch(e){return qualificationFailure(e);}}
export async function POST(request:Request,context:Context){try{return NextResponse.json(await mutateQualification((await context.params).id,await request.json()));}catch(e){return qualificationFailure(e);}}

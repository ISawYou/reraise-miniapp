import { NextResponse } from "next/server";
import { getOwnQualificationInvitation,respondToQualificationInvitation } from "@/features/qualifications";
import { qualificationFailure } from "@/lib/qualification-http";
export const dynamic="force-dynamic";
type Context={params:Promise<{slug:string}>};
export async function GET(_request:Request,context:Context){try{return NextResponse.json(await getOwnQualificationInvitation((await context.params).slug));}catch(e){return qualificationFailure(e);}}
export async function POST(request:Request,context:Context){try{return NextResponse.json(await respondToQualificationInvitation((await context.params).slug,await request.json()));}catch(e){return qualificationFailure(e);}}

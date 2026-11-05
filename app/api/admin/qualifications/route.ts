import { NextResponse } from "next/server";
import { listAdminQualifications, createQualification, searchQualificationPlayers } from "@/features/qualifications";
import { qualificationFailure } from "@/lib/qualification-http";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const q=new URL(request.url).searchParams.get("q");return NextResponse.json(q!==null?{players:await searchQualificationPlayers(q)}:{events:await listAdminQualifications()});}catch(e){return qualificationFailure(e);}}
export async function POST(request:Request){try{return NextResponse.json({event:await createQualification(await request.json())},{status:201});}catch(e){return qualificationFailure(e);}}

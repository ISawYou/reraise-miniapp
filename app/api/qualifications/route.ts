import { NextResponse } from "next/server";
import { listQualifications } from "@/features/qualifications";
import { qualificationFailure } from "@/lib/qualification-http";
export const dynamic="force-dynamic";
export async function GET(){try{return NextResponse.json({events:await listQualifications()});}catch(e){return qualificationFailure(e);}}

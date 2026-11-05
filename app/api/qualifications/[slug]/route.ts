import { NextResponse } from "next/server";
import { getPublicQualification } from "@/features/qualifications";
import { qualificationFailure } from "@/lib/qualification-http";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{slug:string}>}){try{return NextResponse.json(await getPublicQualification((await context.params).slug));}catch(e){return qualificationFailure(e);}}

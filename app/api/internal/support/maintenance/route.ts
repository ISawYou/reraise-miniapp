import {timingSafeEqual} from "node:crypto";
import {maintainNativeSupport} from "@/features/native-support";
import {NativeSupportError} from "@/lib/native-support";
import {supportResponse,supportBody} from "@/lib/native-support-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const POST=(r:Request)=>supportResponse(async()=>{const secret=process.env.SUPPORT_MAINTENANCE_TOKEN,header=r.headers.get("authorization")??"";if(!secret||secret.length<32)throw new NativeSupportError("Недоступно",503);const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(header);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new NativeSupportError("Не авторизовано",401);const b=await supportBody(r);if(typeof b?.dryRun!=="boolean")throw new NativeSupportError("Явно задайте dryRun");return maintainNativeSupport(b.dryRun,b.limit??50);});

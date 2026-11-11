import {ownSupport,writeOwnSupport,reopenOwnSupport} from "@/features/native-support";
import {supportBody,supportPage,supportResponse,supportNoticeAfter} from "@/lib/native-support-http";
export const dynamic="force-dynamic";
export const GET=(r:Request)=>supportResponse(()=>ownSupport(supportPage(r)));
export const POST=(r:Request)=>supportResponse(async()=>{const saved=await writeOwnSupport(await supportBody(r));supportNoticeAfter();return saved;});
export const PATCH=(r:Request)=>supportResponse(async()=>{const b=await supportBody(r);if(b?.action!=="reopen")throw new (await import('@/lib/native-support')).NativeSupportError("Неизвестное действие");return reopenOwnSupport();});

import {staffSupportHistory,stateStaffSupport} from "@/features/native-support";
import {supportResponse,supportPage,supportBody} from "@/lib/native-support-http";
export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export const GET=(r:Request,c:C)=>supportResponse(async()=>staffSupportHistory((await c.params).id,supportPage(r)));
export const PATCH=(r:Request,c:C)=>supportResponse(async()=>stateStaffSupport((await c.params).id,(await supportBody(r))?.action));

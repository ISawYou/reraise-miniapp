import {readStaffSupport} from "@/features/native-support";
import {supportResponse,supportBody} from "@/lib/native-support-http";
export const POST=(r:Request,c:{params:Promise<{id:string}>})=>supportResponse(async()=>readStaffSupport((await c.params).id,(await supportBody(r))?.throughId));

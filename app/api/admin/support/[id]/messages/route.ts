import {writeStaffSupport} from "@/features/native-support";
import {supportResponse,supportBody} from "@/lib/native-support-http";
export const POST=(r:Request,c:{params:Promise<{id:string}>})=>supportResponse(async()=>writeStaffSupport((await c.params).id,await supportBody(r)));

import {staffSupportInbox} from "@/features/native-support";
import {supportResponse} from "@/lib/native-support-http";
import {supportCursor} from "@/lib/native-support";
export const dynamic="force-dynamic";
export const GET=(r:Request)=>supportResponse(()=>{const u=new URL(r.url);return staffSupportInbox(supportCursor(u.searchParams.get("offset"))??0,u.searchParams.get("summary")==="1");});

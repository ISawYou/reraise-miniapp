import {fetchAdminJson} from "@/lib/client-request";
export async function redirectPostgresCompletion(id:string,navigate:(url:string)=>void):Promise<boolean>{
 const {sourceMode}=await fetchAdminJson<{sourceMode:string}>(`/api/admin/tournaments/${encodeURIComponent(id)}/complete-free`,undefined,{retries:0});
 if(sourceMode==="POSTGRESQL"){navigate(`/admin/tournaments/${encodeURIComponent(id)}/control`);return true;}
 if(sourceMode!=="LEGACY_GOOGLE_SHEETS")throw Error("Не удалось определить источник данных турнира");
 return false;
}

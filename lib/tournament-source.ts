import "server-only";
import {eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {tournaments} from "@/lib/db/schema";
export async function getTournamentSource(id:string){
 if(process.env.DATABASE_PROVIDER!=="postgres")return "LEGACY_GOOGLE_SHEETS";
 const [t]=await db.select({mode:tournaments.sourceMode}).from(tournaments).where(eq(tournaments.id,id));
 if(!t)throw Error("Турнир не найден");return t.mode;
}

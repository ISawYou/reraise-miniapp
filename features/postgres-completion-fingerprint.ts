import "server-only";
import {sql} from "drizzle-orm";
import {db} from "@/lib/db";
import type {Executor} from "@/features/tournament-row-lock";
export async function postgresCompletionFingerprint(id:string,executor:Pick<Executor,"execute">=db){
 const rows=await executor.execute(sql`select md5(jsonb_build_object(
 't',(select to_jsonb(t) from tournaments t where t.id=${id}::uuid),
 'r',(select jsonb_agg(to_jsonb(r) order by r.id) from registrations r where r.tournament_id=${id}::uuid),
 'a',(select jsonb_agg(to_jsonb(a) order by a.player_id) from tournament_attendance a where a.tournament_id=${id}::uuid),
 'e',(select jsonb_agg(to_jsonb(e) order by e.player_id) from tournament_player_eliminations e where e.tournament_id=${id}::uuid),
 'b',(select jsonb_agg(to_jsonb(b) order by b.player_id) from tournament_rebuy_state b where b.tournament_id=${id}::uuid),
 'o',(select jsonb_agg(to_jsonb(o) order by o.player_id) from tournament_operations o where o.tournament_id=${id}::uuid),
 'l',(select to_jsonb(l) from tournament_late_registration l where l.tournament_id=${id}::uuid),
 'm',(select to_jsonb(m) from tournament_mystery_bounty m where m.tournament_id=${id}::uuid)
 )::text) as fingerprint`);
 return (rows as unknown as {fingerprint:string}[])[0].fingerprint;
}

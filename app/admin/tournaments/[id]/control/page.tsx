import { assertServerActorRole } from "@/lib/admin-auth";
import { getAdminTournamentParticipants, getTournamentById, getTournamentAttendance, getTournamentEliminations, getTournamentRebuyState } from "@/features/tournaments";
import { TournamentConsole } from "./table";
import {tournamentOperationsRepository} from "@/lib/repositories/tournament-operations/PostgresTournamentOperationsRepository";
import {getMysteryBountySnapshot} from "@/features/mystery-bounty";
import {getTournamentLateRegistrationSnapshot} from "@/features/late-registration";
import {SourceAction} from "./source-action";
import {getTournamentSource} from "@/lib/tournament-source";

export default async function Control({params}: {params: Promise<{id:string}>}) {
  const actor=await assertServerActorRole(["admin", "operator"]);
  const {id}=await params;
  const [tournament,players,attendance,eliminations,rebuys]=await Promise.all([getTournamentById(id),getAdminTournamentParticipants(id),getTournamentAttendance(id),getTournamentEliminations(id),getTournamentRebuyState(id)]);
  const operations=await tournamentOperationsRepository.read(id);
  const [mystery,frozen]=await Promise.all([getMysteryBountySnapshot(id),getTournamentLateRegistrationSnapshot(id)]);
  const mode=await getTournamentSource(id);
  return <TournamentConsole id={id} title={tournament.title} type={tournament.tournament_type} sourceAction={actor.role==="admin"&&mode==="LEGACY_GOOGLE_SHEETS"&&tournament.status!=="completed"?<SourceAction id={id}/>:null} mystery={mystery} frozenPool={frozen?.rating_places.reduce((s,p)=>s+p.points,0)??null} operations={operations.map(o=>({...o,paymentMethod:o.paymentMethod as "cash"|"card"|"mixed"|null}))} locked={tournament.status === "completed" || mode!=="POSTGRESQL"} rows={players.map(p=>({id:p.player_id,name:p.admin_nick,status:p.status,arrived:attendance.get(p.player_id)?.arrived??false,eliminated:eliminations.get(p.player_id)?.eliminated??false,time:eliminations.get(p.player_id)?.eliminated_at??null,rebuys:rebuys.get(p.player_id)?.rebuys??0,addons:rebuys.get(p.player_id)?.addons??0}))}/>;
}

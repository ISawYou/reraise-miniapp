import { assertServerActorRole } from "@/lib/admin-auth";
import { getAdminTournamentParticipants, getTournamentById, getTournamentAttendance, getTournamentEliminations, getTournamentRebuyState } from "@/features/tournaments";
import { TournamentConsole } from "./table";

export default async function Control({params}: {params: Promise<{id:string}>}) {
  await assertServerActorRole(["admin", "operator"]);
  const {id}=await params;
  const [tournament,players,attendance,eliminations,rebuys]=await Promise.all([getTournamentById(id),getAdminTournamentParticipants(id),getTournamentAttendance(id),getTournamentEliminations(id),getTournamentRebuyState(id)]);
  return <TournamentConsole id={id} title={tournament.title} locked={tournament.status === "completed" || Boolean(tournament.google_sheet_tab_name)} rows={players.map(p=>({id:p.player_id,name:p.admin_nick,status:p.status,arrived:attendance.get(p.player_id)?.arrived??false,eliminated:eliminations.get(p.player_id)?.eliminated??false,time:eliminations.get(p.player_id)?.eliminated_at??null,rebuys:rebuys.get(p.player_id)?.rebuys??0,addons:rebuys.get(p.player_id)?.addons??0}))}/>;
}

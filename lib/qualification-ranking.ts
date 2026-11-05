export type QualificationFact = {
  player_id: string; display_name: string; custom_avatar_url: string | null; telegram_avatar_url: string | null;
  tournament_id: string; title: string; date: string; points: number;
};
export type QualificationStanding = {
  player_id: string; display_name: string; custom_avatar_url: string | null; telegram_avatar_url: string | null;
  qualification_rank: number; qualification_total: number; appearances: number;
  counted_results: QualificationFact[]; other_results: QualificationFact[];
  qualification_status: "leader" | "final_zone" | "outside_zone";
  unresolved_tie: boolean;
};
export function rankQualification(facts: QualificationFact[], bestCount: number, resolvedOrder: string[] = []) {
  if (!Number.isInteger(bestCount) || bestCount<1 || bestCount>6) throw new Error("Некорректное число лучших результатов");
  const groups = new Map<string, QualificationFact[]>();
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!Number.isSafeInteger(fact.points) || fact.points<0 || seen.has(`${fact.player_id}/${fact.tournament_id}`)) throw new Error("Некорректные результаты квалификации");
    seen.add(`${fact.player_id}/${fact.tournament_id}`);
    const group=groups.get(fact.player_id)??[];group.push(fact);groups.set(fact.player_id,group);
  }
  const order=new Map(resolvedOrder.map((id,i)=>[id,i]));
  const rows=[...groups.values()].map(group=>{
    group.sort((a,b)=>b.points-a.points || a.date.localeCompare(b.date) || a.tournament_id.localeCompare(b.tournament_id));
    const counted=group.slice(0,bestCount);
    return {player_id:group[0].player_id,display_name:group[0].display_name,custom_avatar_url:group[0].custom_avatar_url,telegram_avatar_url:group[0].telegram_avatar_url,qualification_total:counted.reduce((s,r)=>s+r.points,0),appearances:group.length,counted_results:counted,other_results:group.slice(bestCount)};
  });
  function compare(a:typeof rows[number],b:typeof rows[number]) {
    if(a.qualification_total!==b.qualification_total)return b.qualification_total-a.qualification_total;
    for(let i=0;i<bestCount;i++){const d=(b.counted_results[i]?.points??0)-(a.counted_results[i]?.points??0);if(d)return d;}
    return 0;
  }
  rows.sort((a,b)=>compare(a,b) || (order.get(a.player_id)??1e9)-(order.get(b.player_id)??1e9) || a.display_name.localeCompare(b.display_name,"ru") || a.player_id.localeCompare(b.player_id));
  const consequentialGroups:string[][]=[];
  const tieGroups:string[][]=[];
  const unresolved=new Set<string>();
  for(let start=0;start<rows.length;){let end=start+1;while(end<rows.length&&compare(rows[start],rows[end])===0)end++;
    if(end-start>1)tieGroups.push(rows.slice(start,end).map(r=>r.player_id));
    if(end-start>1 && (start===0 || (start<19 && end>19))){const ids=rows.slice(start,end).map(r=>r.player_id);consequentialGroups.push(ids);if(!ids.every(id=>order.has(id)))ids.forEach(id=>unresolved.add(id));}
    start=end;
  }
  const standings:QualificationStanding[]=rows.map((r,i)=>({...r,qualification_rank:i+1,qualification_status:i===0?"leader":i<19?"final_zone":"outside_zone",unresolved_tie:unresolved.has(r.player_id)}));
  return {standings,consequentialGroups,tieGroups,hasUnresolvedTie:unresolved.size>0};
}

"use client";
import Link from "next/link";
import {useRef, useState} from "react";
import {fetchAdminJson} from "@/lib/client-request";
export type Row={id:string;name:string;status:string;arrived:boolean;eliminated:boolean;time:string|null;rebuys:number;addons:number};
type Field="arrived"|"eliminated"|"rebuys"|"addons";
const participant=(r:Row)=>["registered","attended"].includes(r.status);
function PlayerRow({row,id,locked,onPersist}:{row:Row;id:string;locked:boolean;onPersist:(r:Row)=>void}) {
 const [draft,setDraft]=useState({arrived:row.arrived,eliminated:row.eliminated,rebuys:String(row.rebuys),addons:String(row.addons)});
 const [states,setStates]=useState<Partial<Record<Field,string>>>({});
 const persisted=useRef(row),queue=useRef(Promise.resolve()),pending=useRef<Partial<Record<Field,string|boolean>>>({}),revision=useRef<Partial<Record<Field,number>>>({});
 const readonly=locked||!participant(row);
 const currentDraft=useRef(draft);currentDraft.current=draft;
 function save(field:Field,value:string|boolean){
  if(readonly||pending.current[field]===value)return;
  const numeric=field==="rebuys"||field==="addons",parsed=numeric?Number(value):value;
  if(numeric&&(String(value).trim()===""||!Number.isSafeInteger(parsed)||Number(parsed)<0)){setStates(s=>({...s,[field]:"Не сохранено: введите целое неотрицательное число"}));return;}
  if(pending.current[field]===undefined&&persisted.current[field]===parsed)return;
  pending.current[field]=value;const version=(revision.current[field]??0)+1;revision.current[field]=version;
  setStates(s=>({...s,[field]:"Сохранение…"}));
  // Serialize a player's edits: entries/add-ons share a single API payload.
  // Independent players save concurrently; no input is disabled or remounted.
  queue.current=queue.current.then(async()=>{
   const next={...persisted.current,[field]:parsed};
   try{
    const result=await fetchAdminJson<{eliminated_at?:string|null}>(`/api/admin/tournaments/${id}/${field==="arrived"?"attendance":field==="eliminated"?"eliminate":"rebuy-state"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({player_id:row.id,...(field==="arrived"?{arrived:parsed}:field==="eliminated"?{eliminated:parsed}:{rebuys:next.rebuys,addons:next.addons})})},{retries:0});
    if(field==="eliminated")next.time=result.eliminated_at??null;
    persisted.current=next;onPersist(next);
    if(revision.current[field]===version)setStates(s=>({...s,[field]:currentDraft.current[field]===value?"Сохранено":"Не сохранено"}));
   }catch(e){if(revision.current[field]===version)setStates(s=>({...s,[field]:`Не сохранено: ${e instanceof Error?e.message:"Ошибка сохранения"}`}));}
   finally{if(revision.current[field]===version)delete pending.current[field];}
  });
 }
 return <tr><td className="sticky left-0 z-10 w-56 min-w-56 max-w-56 border border-zinc-700 bg-zinc-900 p-2 break-words">{row.name}</td><td className="border border-zinc-700 p-2">{row.status}</td>
 {(["arrived","eliminated","rebuys","addons"] as const).map(field=><td key={field} className="border border-zinc-700 p-2 align-top">
  {field==="arrived"||field==="eliminated"?<input aria-label={`${row.name}: ${field}`} type="checkbox" checked={draft[field]} disabled={readonly} onChange={e=>{const value=e.target.checked;setDraft(d=>({...d,[field]:value}));save(field,value);}}/>:
  <input aria-label={`${row.name}: ${field}`} aria-invalid={states[field]?.startsWith("Не сохранено")||undefined} type="number" min="0" step="1" value={draft[field]} disabled={readonly} className="w-20 rounded border border-zinc-600 bg-zinc-900 p-1 focus:outline-2 focus:outline-emerald-400" onChange={e=>{const value=e.target.value;setDraft(d=>({...d,[field]:value}));setStates(s=>({...s,[field]:"Не сохранено"}));}} onBlur={()=>save(field,draft[field])}/>}
  <span aria-live="polite" className={`block max-w-48 text-xs ${states[field]?.startsWith("Не сохранено")?"text-amber-200":"text-zinc-300"}`}>{states[field]}</span>
  {states[field]?.startsWith("Не сохранено:")&&<button className="text-xs underline" onClick={()=>save(field,draft[field])}>Повторить</button>}
 </td>)}
 <td className="whitespace-nowrap border border-zinc-700 p-2">{row.time?new Date(row.time).toLocaleTimeString("ru-RU"):"—"}</td>{Array.from({length:7},(_,i)=><td key={i} title="Недоступно в V1: только чтение" className="border border-zinc-700 p-2 text-zinc-400">—</td>)}</tr>;
}
export function TournamentConsole({id,title,locked,rows:initial}:{id:string;title:string;locked:boolean;rows:Row[]}) {
 const [rows,setRows]=useState(initial),[search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[sort,setSort]=useState(false);
 const counted=rows.filter(participant);
 const visible=rows.filter(r=>r.name.toLowerCase().includes(search.toLowerCase())&&(filter==="all"||filter==="arrived"&&participant(r)&&r.arrived||filter==="active"&&participant(r)&&r.arrived&&!r.eliminated)).sort((a,b)=>sort?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
 return <main className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 p-6 text-white">
 <Link href={`/admin/tournaments/${id}/edit`}>← Турнир / добавить существующего игрока</Link><h1 className="my-4 shrink-0 text-2xl font-semibold">{title} · Управление турниром</h1>
 <p data-testid="totals" className="mb-4">Игроки: {counted.length} · Пришли: {counted.filter(r=>r.arrived).length} · Входы: {counted.reduce((s,r)=>s+r.rebuys,0)} · Add-on: {counted.reduce((s,r)=>s+r.addons,0)} · Выбыли: {counted.filter(r=>r.eliminated).length}</p>
 {locked&&<p className="mb-4 text-amber-200">Только просмотр: завершённый турнир или управление через Google Sheets.</p>}
 <div className="mb-4 flex shrink-0 flex-wrap gap-4"><input aria-label="Поиск игрока" placeholder="Поиск игрока" value={search} onChange={e=>setSearch(e.target.value)} className="rounded border border-zinc-600 bg-zinc-900 p-2"/><select aria-label="Фильтр" value={filter} onChange={e=>setFilter(e.target.value)} className="bg-zinc-900"><option value="all">Все игроки</option><option value="arrived">Пришли</option><option value="active">В игре</option></select></div>
 <div data-testid="grid-scroll" className="min-h-0 flex-1 overflow-auto border border-zinc-700"><table className="w-full min-w-[1650px] border-separate border-spacing-0 text-sm" onKeyDown={e=>{if(e.key==="Enter"&&e.target instanceof HTMLInputElement){e.preventDefault();const controls=Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input:not(:disabled)'));const index=controls.indexOf(e.target);if(controls[index+1])controls[index+1].focus();else e.target.blur();}}}>
 <thead className="sticky top-0 z-20 bg-zinc-800"><tr>{["Никнейм","Регистрация","Пришёл","Выбыл","Всего входов","Add-on","Время выбытия","Оплачен","Способ оплаты","Беспл. re-entry","KO","Boss / Mystery","Место","Рейтинг"].map((h,i)=><th scope="col" key={h} className={`whitespace-nowrap border border-zinc-700 bg-zinc-800 p-2 text-left ${i===0?"sticky left-0 z-30":""}`}>{i===0?<button onClick={()=>setSort(!sort)}>{h} ↕</button>:h}</th>)}</tr></thead>
 <tbody>{visible.map(r=><PlayerRow key={r.id} row={r} id={id} locked={locked} onPersist={next=>setRows(old=>old.map(r=>r.id===next.id?next:r))}/>)}</tbody></table></div><p className="mt-3 shrink-0 text-sm text-zinc-400">Tab / Enter — следующая ячейка и сохранение. — данные недоступны в V1. Для обновления состояния перезагрузите страницу.</p>
 </main>;
}

"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef, useState} from "react";
import {fetchAdminJson} from "@/lib/client-request";
import {OperationCells,operationLabels,consoleFieldsFor,operationGroup,type Operations} from "./operation-cells";
import styles from "./console.module.css";
import type {TournamentType} from "@/types/domain";
import {OperationalWarnings} from "./operational-warnings";
import type {CompletionBlocker} from "@/features/postgres-tournament-completion";
import {resolveOperationalNumbers,usesNumericDefaults,operationFieldsFor} from "@/lib/tournament-operation-fields";
import {MobilePlayerList} from "./mobile-player-list";
import {CompletionAction} from "./completion-action";
import type {ReactNode} from "react";
export type Row={id:string;name:string;status:string;arrived:boolean;eliminated:boolean;time:string|null;rebuys:number;addons:number;derivedPlace?:number|null;attendanceKnown?:boolean;entriesKnown?:boolean;ratingPoints?:number|null};
type Field="arrived"|"eliminated"|"rebuys"|"addons";
const participant=(r:Row)=>["registered","attended"].includes(r.status);
const registrationLabel=(status:string)=>({registered:"Зарегистрирован",attended:"Участник",waitlist:"Лист ожидания",cancelled:"Отменена"}[status]??status);
const typeLabels:Record<string,string>={classic:"CLASSIC",bounty:"BOUNTY",boss_bounty:"BOSS BOUNTY",mystery_bounty:"MYSTERY",phoenix:"PHOENIX",free_roll:"FREE ROLL",qualification_final:"ФИНАЛ ОТБОРА"};
const typeLabel=(type:TournamentType)=>typeLabels[type]??type.replaceAll("_"," ").toUpperCase();
function PlayerRow({row,id,locked,onPersist,type,operations,hidden,rating,onOperationSaved,missing=[],onEliminationSaved,defaultsEnabled=false,finalLiveEditable=false}:{row:Row;id:string;locked:boolean;onPersist:(r:Row)=>void;type:TournamentType;operations?:Operations;hidden?:boolean;rating?:number;onOperationSaved?:(row:Operations)=>void;missing?:string[];onEliminationSaved?:()=>void;defaultsEnabled?:boolean;finalLiveEditable?:boolean}) {
 const [draft,setDraft]=useState({arrived:row.arrived,eliminated:row.eliminated,rebuys:row.entriesKnown===false?"":String(row.rebuys),addons:row.entriesKnown===false?"":String(row.addons)});
 const [states,setStates]=useState<Partial<Record<Field,string>>>({});
 const persisted=useRef(row),queue=useRef(Promise.resolve()),pending=useRef<Partial<Record<Field,string|boolean>>>({}),revision=useRef<Partial<Record<Field,number>>>({});
 const readonly=locked||!participant(row)||(type==="qualification_final"&&!finalLiveEditable);
 const dirty=useRef(new Set<Field>());
 const currentDraft=useRef(draft);currentDraft.current=draft;
 useEffect(()=>{if(dirty.current.size||Object.keys(pending.current).length||document.activeElement?.getAttribute("aria-label")?.startsWith(`${row.name}:`))return;persisted.current=row;setDraft({arrived:row.arrived,eliminated:row.eliminated,rebuys:row.entriesKnown===false?"":String(row.rebuys),addons:row.entriesKnown===false?"":String(row.addons)});},[row]);
 function save(field:Field,value:string|boolean){
  if(readonly||(type==="qualification_final"&&field!=="arrived"&&field!=="eliminated")||pending.current[field]===value)return;
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
    if(field==="arrived")next.attendanceKnown=true;if(field==="rebuys"||field==="addons")next.entriesKnown=true;persisted.current=next;onPersist(next);if(field==="eliminated")onEliminationSaved?.();
    if(revision.current[field]===version){const clean=currentDraft.current[field]===value;if(clean)dirty.current.delete(field);setStates(s=>({...s,[field]:clean?"Сохранено":"Не сохранено"}));}
   }catch(e){if(revision.current[field]===version)setStates(s=>({...s,[field]:`Не сохранено: ${e instanceof Error?e.message:"Ошибка сохранения"}`}));}
   finally{if(revision.current[field]===version)delete pending.current[field];}
  });
 }
 return <tr hidden={hidden} data-player-id={row.id}><td>{row.name}<span data-registration>{registrationLabel(row.status)}</span></td>
 {(["arrived","eliminated","rebuys","addons"] as const).filter(field=>field!=="addons"||!["phoenix","qualification_final"].includes(type)).map(field=><td key={field} data-live-field={field} data-missing={missing.some(f=>field==="arrived"?f==="Приход":field==="rebuys"?f.includes("Вход")||f.includes("вход"):field==="eliminated"?f.includes("порядок"):false)||undefined} data-group-start={field==="rebuys"||undefined}>
  {field==="arrived"||field==="eliminated"?<input aria-label={`${row.name}: ${field}`} type="checkbox" ref={node=>{if(node)node.indeterminate=field==="arrived"&&row.attendanceKnown===false&&!dirty.current.has(field);}} checked={draft[field]} disabled={readonly} onChange={e=>{const value=e.target.checked;dirty.current.add(field);setDraft(d=>({...d,[field]:value}));save(field,value);}}/>:
  <input aria-label={`${row.name}: ${field}`} aria-invalid={states[field]?.startsWith("Не сохранено")||undefined} type="number" min="0" step="1" value={draft[field]} disabled={readonly||type==="qualification_final"} className="w-20 rounded border border-zinc-600 bg-zinc-900 p-1 focus:outline-2 focus:outline-emerald-400" onChange={e=>{const value=e.target.value;dirty.current.add(field);setDraft(d=>({...d,[field]:value}));setStates(s=>({...s,[field]:"Не сохранено"}));}} onBlur={()=>save(field,draft[field])}/>}
  {field==="arrived"&&row.attendanceKnown===false&&<small data-unknown>Не отмечено</small>}{field==="eliminated"&&row.time&&<time data-time dateTime={row.time}>{new Date(row.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Moscow"})} МСК</time>}
  <span aria-live="polite" data-save={states[field]?.startsWith("Не сохранено:")?"error":states[field]==="Не сохранено"?"unsaved":"saved"}>{states[field]}</span>
  {states[field]?.startsWith("Не сохранено:")&&<button data-retry onClick={()=>save(field,draft[field])}>Повторить</button>}
 </td>)}
 <OperationCells id={id} playerId={row.id} type={type} locked={locked||!participant(row)} initial={operations} eliminated={row.eliminated} rating={rating} derivedPlace={row.derivedPlace} missing={missing} defaultsEnabled={defaultsEnabled} onSaved={onOperationSaved}/></tr>;
}
export function TournamentConsole({id,title,locked,rows:initial,type="classic",operations=[],frozenPool,mystery,sourceAction,status,source}:{id:string;title:string;locked:boolean;rows:Row[];type?:TournamentType;operations?:Operations[];frozenPool?:number|null;mystery?:{envelope_count:number;mystery_pool:number}|null;sourceAction?:ReactNode;status?:string;source?:string}) {
 const [fullGrid,setFullGrid]=useState(false);
 const defaultsEnabled=usesNumericDefaults(status,source);
 const [rows,setRows]=useState(initial),[search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[sort,setSort]=useState(false);
 const [liveOperations,setLiveOperations]=useState(operations);
 const [ratings,setRatings]=useState<Record<string,number>>({});
 const writeEpoch=useRef(0);
 const [blockers,setBlockers]=useState<CompletionBlocker[]>([]),[completionRevision,setCompletionRevision]=useState(0);
 const signature=useRef("");
 const refresh=useCallback(async()=>{const epoch=writeEpoch.current;try{const result=await fetchAdminJson<{rows:Operations[];liveRows?:Row[]}>(`/api/admin/tournaments/${id}/operations`,undefined,{retries:0});if(epoch!==writeEpoch.current)return;setLiveOperations(result.rows);if(result.liveRows){const current=result.liveRows;setRows(previous=>[...current,...previous.filter(r=>!current.some(c=>c.id===r.id)).map(r=>({...r,status:"cancelled"}))]);}const next=JSON.stringify(result);if(signature.current!==next){signature.current=next;setCompletionRevision(v=>v+1);}}catch{/* Keep drafts and existing data on refresh failure. */}},[id,setLiveOperations,setRows,setCompletionRevision]);
 useEffect(()=>{const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[refresh]);
 const counted=rows.filter(participant);
 const visible=rows.filter(r=>r.name.toLowerCase().includes(search.toLowerCase())&&(filter==="all"||filter==="review"&&blockers.some(b=>b.player_id===r.id)||filter==="arrived"&&participant(r)&&r.arrived||filter==="active"&&participant(r)&&r.arrived&&!r.eliminated||filter==="eliminated"&&participant(r)&&r.eliminated)).sort((a,b)=>sort?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
 const applicable=counted.map(r=>resolveOperationalNumbers(type,liveOperations.find(o=>o.playerId===r.id),defaultsEnabled));
 const assignedEnvelopes=applicable.reduce((s,o)=>s+(o.mysteryEnvelopesWon??0),0),assignedPoints=applicable.reduce((s,o)=>s+(o.mysteryPoints??0),0);
 const entryMetric=(sum:number)=>counted.some(r=>r.entriesKnown===false)?`${sum} + ?`:sum;
 const metrics:[string,number|string][]=[['Игроки',counted.length],['Пришли',counted.filter(r=>r.arrived).length],['В игре',counted.filter(r=>r.arrived&&!r.eliminated).length],['Выбыли',counted.filter(r=>r.arrived&&r.eliminated).length],['Первые входы',entryMetric(counted.reduce((s,r)=>s+Math.min(r.rebuys,1),0))],['Входы',entryMetric(counted.reduce((s,r)=>s+r.rebuys,0))],...(type!=='qualification_final'?[['Re-entry',entryMetric(counted.reduce((s,r)=>s+Math.max(0,r.rebuys-1),0))] as [string,number|string]]:[]),...(!['phoenix','qualification_final'].includes(type)?[['Add-on',entryMetric(counted.reduce((s,r)=>s+r.addons,0))] as [string,number|string]]:[])];
 const knownTotal=(field:'knockouts'|'bossKnockouts'|'freeReentries')=>{const known=applicable.filter(o=>o[field]!=null);return `${known.reduce((s,o)=>s+o[field]!,0)}${known.length<counted.length?' + ?':''}`;};
 if(operationFieldsFor(type).includes('freeReentries'))metrics.push(['Беспл. re-entry',knownTotal('freeReentries')]);
 if(['bounty','boss_bounty'].includes(type))metrics.push(['KO',knownTotal('knockouts')]);
 if(type==='boss_bounty')metrics.push(['Boss KO',knownTotal('bossKnockouts')]);
 if(type==='mystery_bounty')metrics.push(['Конверты',`${assignedEnvelopes} / ${mystery?.envelope_count??'?'}`],['Mystery очки',`${assignedPoints} / ${mystery?.mystery_pool??'?'}`]);
 const headers=[{label:'Никнейм',group:'Участник'},{label:'Пришёл',group:'Участие'},{label:'Выбыл',group:'Участие'},{label:'Всего входов',group:'Входы'},...(!['phoenix','qualification_final'].includes(type)?[{label:'Add-on',group:'Входы'}]:[]),...consoleFieldsFor(type).flatMap(f=>[{label:operationLabels[f],group:operationGroup(f)},...(f==='place'?[{label:'Рейтинг',group:'Результат'}]:[])])];
 return <main className={styles.workspace} data-full-grid={fullGrid}>
 <header><div><Link href="/admin/tournaments">← К турнирам</Link><h1>{title}<small>{typeLabel(type)}</small></h1></div><div data-badges><span>{status==='completed'?'Завершён':status==='open'?'Открыт':status??'Управление турниром'}</span><span>{source==='LEGACY_GOOGLE_SHEETS'?'Google Sheets':source==='POSTGRESQL'?'PostgreSQL':'Источник не указан'}</span>{locked&&<span>Только просмотр</span>}</div></header>
 <section data-kpis data-testid="totals" aria-label="Сводка турнира">{metrics.map(([label,value])=><div data-kpi key={label}><span>{label}: </span><strong>{value}</strong></div>)}</section>
 <div data-context>{defaultsEnabled&&<span>Незаполненные числовые показатели учитываются как 0.</span>}{type!=="qualification_final"&&<span>Фонд мест: {frozenPool==null?'не зафиксирован':`${frozenPool} очков · зафиксирован`}</span>}{type==='mystery_bounty'&&<span>Распределение Mystery должно совпасть с зафиксированным пулом.</span>}{locked&&<span>Изменения недоступны: завершённый турнир или источник Google Sheets.</span>}</div>
 <div data-toolbar><input aria-label="Поиск игрока" placeholder="Найти по никнейму…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Фильтр" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все игроки</option><option value="review">Требуют проверки</option><option value="arrived">Пришли</option><option value="active">В игре</option><option value="eliminated">Выбыли</option></select><span data-count>Показано {visible.length} из {rows.length}</span><nav><Link href={`/admin/results/${id}`}>Выбытия и регистрация</Link><Link href={`/admin/tournaments/${id}/edit`}>Состав / добавить игрока</Link></nav></div>
 <OperationalWarnings rows={rows} operations={liveOperations} type={type}/><div data-actions>{sourceAction}{type==='qualification_final'&&<Link href="/admin/qualifications">Состав и завершение финала отбора →</Link>}{!locked&&type!=='qualification_final'&&<CompletionAction id={id} refreshKey={completionRevision} onBlockers={setBlockers} onJump={(playerId,field)=>{setFullGrid(true);setSearch("");setFilter("all");requestAnimationFrame(()=>{const tr=Array.from(document.querySelectorAll<HTMLTableRowElement>("tr[data-player-id]")).find(r=>r.dataset.playerId===playerId);const labels:Record<string,string>={"Бесплатные re-entry":"freeReentries",KO:"knockouts","Boss KO":"bossKnockouts","Место / порядок выбытия":"place","Приход":"arrived","Входы / Add-on":"rebuys"};const cell=tr?.querySelector<HTMLElement>(`[data-operation-field="${labels[field]??"place"}"], [data-live-field="${labels[field]??"rebuys"}"]`);tr?.scrollIntoView({block:"nearest",inline:"nearest"});const input=cell?.querySelector<HTMLElement>("input:not(:disabled),button:not(:disabled)");if(input)input.focus();else{tr?.setAttribute("tabindex","-1");tr?.focus();}});}} provisionalWinner={counted.length>0&&counted.every(r=>r.arrived&&r.eliminated)?counted.find(r=>r.derivedPlace===1)?.name:undefined} onPreview={results=>setRatings(Object.fromEntries(results.map(r=>[r.player_id,r.rating_points])))}/>}</div>
 <div data-mobile-switch><button type="button" data-action-button aria-pressed={fullGrid} onClick={()=>setFullGrid(v=>!v)}>{fullGrid?"Список игроков":"Полная таблица"}</button><span>Карточки — просмотр. Редактирование — в общей таблице.</span></div>
 <MobilePlayerList rows={visible} type={type} operations={liveOperations} defaultsEnabled={defaultsEnabled}/><div data-grid data-testid="grid-scroll"><table aria-label="Управление игроками турнира" onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();const controls=Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input:not(:disabled)')).filter(i=>!i.closest('tr')?.hidden);const index=controls.indexOf(e.target);if(controls[index+1])controls[index+1].focus();else e.target.blur();}}}>
 <thead><tr>{headers.map((h,i)=><th scope="col" key={h.label} data-group-start={i>0&&h.group!==headers[i-1].group||undefined}><small>{h.group}</small>{i===0?<button aria-label="Сортировать по никнейму" onClick={()=>setSort(!sort)}>{h.label} {sort?'↓':'↑'}</button>:h.label}</th>)}</tr></thead>
 <tbody>{rows.slice().sort((a,b)=>sort?b.name.localeCompare(a.name):a.name.localeCompare(b.name)).map(r=><PlayerRow finalLiveEditable={status==="open"&&source==="POSTGRESQL"} defaultsEnabled={defaultsEnabled} key={r.id} hidden={!visible.some(v=>v.id===r.id)} row={r} id={id} locked={locked} type={type} rating={r.ratingPoints??ratings[r.id]} missing={blockers.find(b=>b.player_id===r.id)?.fields} onEliminationSaved={()=>void refresh()} onOperationSaved={saved=>{writeEpoch.current++;setLiveOperations(old=>[...old.filter(o=>o.playerId!==saved.playerId),saved]);setCompletionRevision(v=>v+1);}} operations={liveOperations.find(o=>o.playerId===r.id)} onPersist={next=>{writeEpoch.current++;setRows(old=>old.map(r=>r.id===next.id?next:r));setCompletionRevision(v=>v+1);}}/>)}</tbody></table>{visible.length===0&&<p className="p-6 text-center text-zinc-400">По выбранным условиям игроков нет</p>}</div><footer>Tab / Enter — следующая ячейка · Сохранение при выходе из поля · Время МСК · Числовые defaults: 0 только в активном PostgreSQL; место и оплата не подставляются</footer>
 </main>;
}

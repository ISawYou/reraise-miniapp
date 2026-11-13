"use client";
import {useEffect,useRef,useState} from "react";
import {fetchAdminJson} from "@/lib/client-request";
import {operationFieldsFor,type OperationFields} from "@/lib/tournament-operation-fields";
import type {TournamentType} from "@/types/domain";
export type Operations=Partial<OperationFields>&{version:number;playerId:string};
export const operationLabels:Record<keyof OperationFields,string>={paid:"Оплачен",paymentMethod:"Оплата",freeReentries:"Беспл. re-entry",knockouts:"KO",bossKnockouts:"Boss KO",mysteryEnvelopesWon:"Конверты",mysteryPoints:"Mystery очки",place:"Место"};
export function OperationCells({id,playerId,type,locked,initial,eliminated}:{id:string;playerId:string;type:TournamentType;locked:boolean;initial?:Operations;eliminated?:boolean}){
 const [values,setValues]=useState<Partial<OperationFields>>(initial??{}),[messages,setMessages]=useState<Partial<Record<keyof OperationFields,string>>>({});
 const persisted=useRef<Operations>(initial??{version:0,playerId}),dirty=useRef(new Set<keyof OperationFields>()),queue=useRef(Promise.resolve()),pending=useRef(new Set<string>()),blocked=useRef(false);
 const latest=useRef(values);latest.current=values;
 const fields=operationFieldsFor(type);
 useEffect(()=>{
  const focused=document.activeElement?.getAttribute("aria-label")?.startsWith(`${playerId}:`);
  if(initial&&initial.version>=persisted.current.version&&!focused&&!dirty.current.size&&!pending.current.size){persisted.current=initial;setValues(initial);blocked.current=false;}
 },[initial,playerId]);
 function save(field:keyof OperationFields,value:OperationFields[keyof OperationFields]){
  if(locked||blocked.current)return;const key=JSON.stringify([field,value]);if(pending.current.has(key))return;
  if(persisted.current[field]===value){dirty.current.delete(field);return;}
  pending.current.add(key);setMessages(m=>({...m,[field]:"Сохранение…"}));
  queue.current=queue.current.then(async()=>{
   if(blocked.current){setMessages(m=>({...m,[field]:"Не сохранено: обновите данные после конфликта"}));pending.current.delete(key);return;}
   try{const {row}=await fetchAdminJson<{row:Operations}>(`/api/admin/tournaments/${id}/operations`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId,expectedVersion:persisted.current.version,patch:{[field]:value}})},{retries:0});persisted.current=row;const clean=(latest.current[field]??null)===value;if(clean)dirty.current.delete(field);setMessages(m=>({...m,[field]:clean?"Сохранено":"Не сохранено"}));}
   catch(e){blocked.current=true;setMessages(m=>({...m,[field]:`Не сохранено: ${(e as Error).message}. Обновите страницу после проверки правок.`}));}
   finally{pending.current.delete(key);}
  });
 }
 async function retry(field:keyof OperationFields){
  try{const {rows}=await fetchAdminJson<{rows:Operations[]}>(`/api/admin/tournaments/${id}/operations`,undefined,{retries:0});const fresh=rows.find(r=>r.playerId===playerId)??{version:0,playerId};
   if(!window.confirm(`В базе: ${String(fresh[field]??"неизвестно")}. Сохранить ваше значение: ${String(latest.current[field]??"неизвестно")}?`))return;
   persisted.current=fresh;blocked.current=false;save(field,latest.current[field]??null);
  }catch(e){setMessages(m=>({...m,[field]:`Не сохранено: ${(e as Error).message}`}));}
 }
 return <>{fields.map(field=><td key={field} className="min-w-28 border border-zinc-700 p-2 align-top">
 {field==="paid"||field==="paymentMethod"?<select aria-label={`${playerId}: ${operationLabels[field]}`} value={values[field]==null?"":String(values[field])} disabled={locked} className="max-w-32 bg-zinc-900 p-1" onChange={e=>{const value=e.target.value===""?null:field==="paid"?e.target.value==="true":e.target.value;setValues(v=>({...v,[field]:value}));dirty.current.add(field);save(field,value as OperationFields[typeof field]);}}><option value="">Неизвестно</option>{field==="paid"?<><option value="true">Да</option><option value="false">Нет</option></>:<><option value="cash">Наличные</option><option value="card">Карта</option><option value="mixed">Смешанная</option></>}</select>:
 <input aria-label={`${playerId}: ${operationLabels[field]}`} title={field==="place"&&eliminated?"Определяется порядком выбытия при предварительном расчёте":undefined} disabled={locked||field==="place"&&eliminated} type="number" min={field==="place"?1:0} step="1" value={values[field]??""} className="w-20 rounded border border-zinc-600 bg-zinc-900 p-1" onChange={e=>{const value=e.target.value===""?null:Number(e.target.value);setValues(v=>({...v,[field]:value}));dirty.current.add(field);setMessages(m=>({...m,[field]:"Не сохранено"}));}} onBlur={()=>save(field,values[field]??null)}/>}
 <span className="block max-w-48 text-xs text-amber-200" aria-live="polite">{messages[field]}</span>
 {messages[field]?.startsWith("Не сохранено:")&&<button className="text-xs underline" onClick={()=>void retry(field)}>Проверить и повторить</button>}
 </td>)}</>;
}

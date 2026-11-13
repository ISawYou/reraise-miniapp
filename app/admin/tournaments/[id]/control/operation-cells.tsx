"use client";
import {Fragment,useEffect,useRef,useState} from "react";
import {fetchAdminJson} from "@/lib/client-request";
import {operationFieldsFor,type OperationFields} from "@/lib/tournament-operation-fields";
import type {TournamentType} from "@/types/domain";
export type Operations=Partial<OperationFields>&{version:number;playerId:string};
export const operationLabels:Record<keyof OperationFields,string>={paid:"Оплачен",paymentMethod:"Способ оплаты (архив)",comment:"Комментарий",freeReentries:"Беспл. re-entry",knockouts:"KO",bossKnockouts:"Boss KO",mysteryEnvelopesWon:"Конверты",mysteryPoints:"Mystery очки",place:"Место"};
export const operationGroup=(field:keyof OperationFields)=>field==="paid"||field==="freeReentries"?"Оплата":field==="place"?"Результат":field==="comment"?"Заметки":"Счёт";
export const consoleFieldsFor=(type:TournamentType):(keyof OperationFields)[]=>[...operationFieldsFor(type).filter(f=>f!=="place"&&f!=="comment"),...(operationFieldsFor(type).includes("place")?["place" as const]:[]),"comment"];
export function OperationCells({id,playerId,type,locked,initial,eliminated,rating,onSaved}:{id:string;playerId:string;type:TournamentType;locked:boolean;initial?:Operations;eliminated?:boolean;rating?:number;onSaved?:(row:Operations)=>void}){
 const [values,setValues]=useState<Partial<OperationFields>>(initial??{}),[messages,setMessages]=useState<Partial<Record<keyof OperationFields,string>>>({});
 const persisted=useRef<Operations>(initial??{version:0,playerId}),dirty=useRef(new Set<keyof OperationFields>()),queue=useRef(Promise.resolve()),pending=useRef(new Set<string>()),blocked=useRef(false);
 const latest=useRef(values);latest.current=values;
 const fields=consoleFieldsFor(type);
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
   try{const {row}=await fetchAdminJson<{row:Operations}>(`/api/admin/tournaments/${id}/operations`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId,expectedVersion:persisted.current.version,patch:{[field]:value}})},{retries:0});persisted.current=row;onSaved?.(row);const clean=(latest.current[field]??null)===value;if(clean)dirty.current.delete(field);setMessages(m=>({...m,[field]:clean?"Сохранено":"Не сохранено"}));}
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
 return <>{fields.map((field,index)=><Fragment key={field}><td data-group-start={index===0||operationGroup(field)!==operationGroup(fields[index-1])||undefined} data-comment={field==="comment"||undefined}>
 {field==="paid"?<><input ref={node=>{if(node)node.indeterminate=values.paid==null;}} aria-label={`${playerId}: ${operationLabels[field]}`} type="checkbox" checked={values.paid===true} title={values.paid==null?"Оплата неизвестна":values.paid?"Оплачен":"Не оплачен"} disabled={locked} onChange={e=>{const value=e.target.checked;setValues(v=>({...v,paid:value}));dirty.current.add(field);save(field,value);}}/>{values.paid==null&&<span data-unknown>Неизвестно</span>}</>:field==="comment"?<details><summary aria-label={`${playerId}: Открыть комментарий`}><span>{values.comment|| (locked?"Нет комментария":"Добавить комментарий")}</span></summary><textarea aria-label={`${playerId}: Комментарий`} maxLength={1000} rows={3} disabled={locked} value={values.comment??""} placeholder="До 1000 символов" onChange={e=>{const value=e.target.value;setValues(v=>({...v,comment:value}));dirty.current.add(field);setMessages(m=>({...m,[field]:"Не сохранено"}));}} onBlur={()=>save(field,values.comment??null)}/><span data-unknown>{(values.comment??"").length} / 1000 · сохранение при выходе из поля</span></details>:
 <input aria-label={`${playerId}: ${operationLabels[field]}`} title={field==="place"&&eliminated?"Определяется порядком выбытия при предварительном расчёте":undefined} disabled={locked||field==="place"&&eliminated} type="number" min={field==="place"?1:0} step="1" value={values[field]??""} className="w-20 rounded border border-zinc-600 bg-zinc-900 p-1" onChange={e=>{const value=e.target.value===""?null:Number(e.target.value);setValues(v=>({...v,[field]:value}));dirty.current.add(field);setMessages(m=>({...m,[field]:"Не сохранено"}));}} onBlur={()=>save(field,values[field]??null)}/>}
 <span data-save={messages[field]?.startsWith("Не сохранено:")?"error":messages[field]==="Не сохранено"?"unsaved":"saved"} aria-live="polite">{messages[field]}</span>
 {messages[field]?.startsWith("Не сохранено:")&&<button data-retry onClick={()=>void retry(field)}>Проверить и повторить</button>}
 </td>{field==="place"&&<td title="Предварительный рейтинг последней проверки завершения; перед сохранением проверяется свежесть">{rating??"—"}</td>}</Fragment>)}</>;
}

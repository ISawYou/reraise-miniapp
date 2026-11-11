"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import type {NativeSupportHistory,NativeSupportMessage} from "@/lib/native-support";
import {supportRequest,SupportClientError} from "./support-client";
type Model=NativeSupportHistory&{viewerId:string;blocked?:boolean};
type Draft={clientId:string;text:string;state:"pending"|"failed"|"saved"};
const button="min-h-11 rounded-xl border border-[#d5b867]/40 px-4 py-2 text-sm text-[#f0d38a] disabled:opacity-40";
const time=(s:string)=>new Date(s).toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
export function SupportChat({threadId}:{threadId?:string}){
 const staff=!!threadId,base=staff?`/api/admin/support/${threadId}`:"/api/support";
 const [model,setModel]=useState<Model|null>(null),[text,setText]=useState(""),[draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),[sending,setSending]=useState(false),[older,setOlder]=useState(false);
 const busy=useRef(false),fetching=useRef(false),modelRef=useRef<Model|null>(null),draftRef=useRef<Draft|null>(null),key=useRef(""),bottom=useRef<HTMLDivElement>(null);
 const store=useCallback((d:Draft|null)=>{draftRef.current=d;setDraft(d);try{if(d)sessionStorage.setItem(key.current,JSON.stringify(d));else sessionStorage.removeItem(key.current);}catch{}},[]);
 const load=useCallback(async(mode:"initial"|"poll"|"older"="initial")=>{
  if(fetching.current)return;fetching.current=true;
  try{const current=modelRef.current;const cursor=mode==="poll"&&current?.messages.length?`?after=${current.messages.at(-1)!.id}`:mode==="older"&&current?.messages.length?`?before=${current.messages[0].id}`:"";
   const data=await supportRequest<Model>(base+cursor);const storageKey=`reraise.support.${data.viewerId}.${threadId??"own"}`;
   if(key.current!==storageKey){key.current=storageKey;modelRef.current=null;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??"null")as Draft|null;if(saved&&typeof saved.clientId==="string"&&typeof saved.text==="string")store({...saved,state:"failed"});else store(null);}catch{store(null);}}
   const previous=modelRef.current;const merge=mode!=="initial"&&previous&&previous.viewerId===data.viewerId;
   const messages=merge?[...new Map([...previous.messages,...data.messages].map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id):data.messages;
   const next={...data,messages,hasOlder:mode==="poll"&&previous?previous.hasOlder:data.hasOlder};modelRef.current=next;setModel(next);setOlder(next.hasOlder);
   if(draftRef.current&&messages.some(m=>m.clientId===draftRef.current!.clientId))store(null);
   if(staff&&document.visibilityState==="visible"&&messages.length){const throughId=messages.at(-1)!.id;void supportRequest(`${base}/read`,{throughId}).catch(()=>{});}
   setError(null);
  }catch(e){if(e instanceof SupportClientError&&(e.status===401||e.status===403)){modelRef.current=null;setModel(null);setDraft(null);draftRef.current=null;key.current="";}setError(e instanceof Error?e.message:"Не удалось загрузить чат");}finally{fetching.current=false;setLoading(false);}
 },[base,staff,store,threadId]);
 useEffect(()=>{modelRef.current=null;key.current="";setModel(null);setLoading(true);void load();const timer=setInterval(()=>{if(document.visibilityState==="visible")void load("poll");},4000);return()=>clearInterval(timer);},[load]);
 async function send(retry=false){if(busy.current||!modelRef.current)return;const value=retry?draftRef.current:null;if(!value&&!text.trim())return;const d:Draft=value??{clientId:crypto.randomUUID(),text:text.trim(),state:"pending"};busy.current=true;setSending(true);setError(null);store({...d,state:"pending"});
  try{await supportRequest(staff?`${base}/messages`:base,{text:d.text,clientId:d.clientId});store({...d,state:"saved"});setText("");await load();bottom.current?.scrollIntoView?.({block:"nearest"});}catch(e){store({...d,state:"failed"});setError(e instanceof Error?e.message:"Не удалось подтвердить сохранение. Повторите с тем же сообщением");}finally{busy.current=false;setSending(false);}
 }
 async function state(action:"close"|"reopen"){if(busy.current)return;busy.current=true;setSending(true);try{await supportRequest(base,{action},"PATCH");await load();}catch(e){setError(e instanceof Error?e.message:"Не удалось изменить статус");}finally{busy.current=false;setSending(false);}}
 return <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-5 pb-32 text-white">
  <Link className="inline-flex min-h-11 items-center text-sm text-white/70" href={staff?"/admin/support":"/"}>← {staff?"Все обращения":"Главная"}</Link>
  <header><h1 className="break-words text-2xl font-bold">{staff?model?.thread?.playerName??"Обращение":"Поддержка ReRaise"}</h1><p className="mt-2 text-sm text-white/65">Переписка сохраняется в ReRaise. Время МСК.</p>{model?.blocked?<p className="mt-2 text-sm text-amber-200">Вы можете обратиться в поддержку, даже если доступ к клубу заблокирован.</p>:null}</header>
  {error?<div role="alert" className="rounded-xl border border-red-400/30 p-3 text-sm text-red-200">{error}{!model?<Link className="ml-2 underline" href="/">На главную / вход</Link>:null}<button className={button+" mt-2 block"} onClick={()=>void load()}>Обновить</button></div>:null}
  {loading?<p role="status" className="text-sm text-white/65">Загружаем переписку…</p>:null}
  {model?<><div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-white/10 px-3 py-1">{model.thread?.status==="closed"?"Закрыто":"Открыто"}</span>{staff&&model.thread?.unanswered?<span className="text-amber-200">Ожидает ответа</span>:null}{model.thread?.status==="closed"?<button disabled={sending} className={button} onClick={()=>void state("reopen")}>Возобновить</button>:staff&&model.thread?<button disabled={sending||model.thread.unanswered} className={button} onClick={()=>void state("close")}>Закрыть обращение</button>:null}</div>
  {older?<button disabled={sending} className={button+" w-full"} onClick={()=>void load("older")}>Загрузить предыдущие сообщения</button>:null}
  <section aria-label="История переписки" aria-live="polite" className="min-w-0 space-y-3">
   {!model.messages.length?<p className="rounded-2xl border border-white/10 p-4 text-sm text-white/65">{staff?"Сообщений пока нет":"Напишите вопрос — администратор ответит здесь."}</p>:null}
   {model.messages.map((m:NativeSupportMessage)=><article key={m.id} className={`max-w-[94%] rounded-2xl border p-3 ${m.senderKind==="staff"?"mr-auto border-[#d5b867]/25 bg-[#18291d]":"ml-auto border-white/10 bg-[#151b17]"}`}><p className="break-words text-xs font-medium text-[#e1c883]">{m.senderKind==="staff"?"Поддержка · ":""}{m.senderName}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{m.body??"Сообщение удалено по сроку хранения"}</p><p className="mt-2 text-[11px] text-white/60">{time(m.createdAt)} · Сохранено</p></article>)}
   {draft?<article className="ml-auto max-w-[94%] rounded-2xl border border-amber-400/30 p-3"><p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{draft.text}</p><p role="status" className="mt-2 text-xs text-amber-200">{draft.state==="pending"?"Сохраняем…":draft.state==="saved"?"Сохранено":"Сохранение не подтверждено"}</p>{draft.state==="failed"?<div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={sending} onClick={()=>void send(true)}>Повторить отправку</button><button className={button} disabled={sending} onClick={()=>{store(null);setText("");}}>Убрать черновик</button></div>:null}</article>:null}
   <div ref={bottom}/>
  </section>
  <form className="space-y-2 rounded-2xl border border-white/15 bg-[#0e1711] p-3" onSubmit={e=>{e.preventDefault();void send();}}><label className="block text-sm" htmlFor="support-message">Сообщение<textarea id="support-message" rows={3} maxLength={4000} disabled={sending||!!draft} value={text} onChange={e=>setText(e.target.value)} className="mt-2 min-h-24 w-full min-w-0 resize-y rounded-xl border border-white/15 bg-black/30 p-3 text-base text-white" placeholder="Только текст, до 4000 символов"/></label><div className="flex items-center justify-between gap-2"><span className="text-xs text-white/60">{text.length}/4000 · Без вложений</span><button className={button} disabled={sending||!!draft||!text.trim()}>Отправить</button></div></form>
  </>:null}
 </main>;
}
